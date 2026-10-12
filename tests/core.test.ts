import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/store";
import { seed, demoUser } from "../src/seed";
import {
  enroll,
  start,
  stop,
  pause,
  receive,
  saveDrafts,
  getEnrollment,
  createCampaign,
} from "../src/domain";
import { generate, validateDrafts, currentEvidence } from "../src/ai";
import { MockCRM } from "../src/crm";
import { MockEmail, ProviderError, retryAfter, GraphEmail } from "../src/graph";
import { Worker } from "../src/worker";
import {
  defaultTiming,
  businessTime,
  planned,
  timingSchema,
} from "../src/schedule";
import { id, seal, unseal, htmlPreview } from "../src/security";
import { publicIPv4 } from "../src/research";
import type { Incoming } from "../src/types";
import { config } from "../src/config";
const monday = "2026-10-12T04:30:00.000Z";
async function fixture() {
  const store = new MemoryStore();
  await seed(store);
  const e = await store.change((s) =>
    enroll(s, demoUser, s.contacts[0], "demo-campaign"),
  );
  const generated = await generate(e, [], "Alex");
  await store.change((s) => {
    const row = s.enrollments[0];
    saveDrafts(s, demoUser, row, generated.drafts);
    row.drafts.forEach((d) => (d.approved = true));
    row.status = "Ready";
    start(s, demoUser, row, s.contacts[0], monday);
  });
  const crm = new MockCRM(() => store.read()),
    provider = new MockEmail(store);
  let clock = new Date(monday);
  const worker = new Worker(store, crm, provider, () => clock);
  return {
    store,
    crm,
    provider,
    worker,
    e,
    at: (time: string) => {
      clock = new Date(time);
    },
  };
}
function incoming(
  conversationId: string,
  kind: Incoming["kind"] = "reply",
): Incoming {
  return {
    id: id(),
    mailboxId: "demo-mailbox",
    providerId: id(),
    conversationId,
    from: "maya@asterlabs.example",
    subject: "Re: Recruitment support",
    body: "Thank you",
    kind,
    receivedAt: monday,
  };
}
test("five emails submit once, in order, with durable scheduled spacing", async () => {
  const f = await fixture();
  for (let step = 0; step < 5; step++) {
    const s = await f.store.read();
    f.at(s.enrollments[0].nextAt!);
    await f.worker.tick();
    assert.equal((await f.store.read()).enrollments[0].sent, step + 1);
  }
  const s = await f.store.read();
  assert.equal(s.enrollments[0].status, "Completed");
  assert.equal(f.provider.submitted.size, 5);
  assert.deepEqual(
    s.jobs.map((j) => j.step),
    [0, 1, 2, 3, 4],
  );
  await f.worker.tick();
  assert.equal(f.provider.submitted.size, 5);
});
test("CRM stop committed before dispatch prevents submission and is idempotent", async () => {
  const f = await fixture();
  const j = await f.worker.claim();
  assert(j);
  await f.store.change((s) => {
    stop(s, s.enrollments[0], "crm_stop", demoUser.id);
    stop(s, s.enrollments[0], "crm_stop", demoUser.id);
  });
  await f.worker.dispatch(j);
  assert.equal(f.provider.submitted.size, 0);
  assert.equal(
    (await f.store.read()).audits.filter((a) => a.action === "stop").length,
    1,
  );
});
for (const kind of ["reply", "automatic", "bounce", "unsubscribe"] as const)
  test(`${kind} stops remaining emails; duplicate notification is idempotent`, async () => {
    const f = await fixture();
    await f.worker.tick();
    const s = await f.store.read();
    const message = incoming(s.enrollments[0].conversationId!, kind);
    await f.store.change((s) => {
      receive(s, message);
      receive(s, message);
    });
    f.at("2026-11-20T04:30:00.000Z");
    await f.worker.tick();
    const after = await f.store.read();
    assert.equal(f.provider.submitted.size, 1);
    assert.equal(after.incoming.length, 1);
    assert.equal(
      after.enrollments[0].status,
      ["reply", "automatic"].includes(kind) ? "Replied" : "Stopped",
    );
    assert.equal(
      after.suppressions.length,
      ["bounce", "unsubscribe"].includes(kind) ? 1 : 0,
    );
  });
test("unrelated inbound from same email does not stop the sequence", async () => {
  const f = await fixture();
  await f.worker.tick();
  await f.store.change((s) => receive(s, incoming("unrelated-thread")));
  assert.equal((await f.store.read()).enrollments[0].status, "Active");
});
test("reply headers match even when provider conversation is unavailable", async () => {
  const f = await fixture();
  await f.worker.tick();
  const message = incoming("other");
  message.inReplyTo = (await f.store.read()).jobs[0].internetMessageId;
  await f.store.change((s) => receive(s, message));
  assert.equal((await f.store.read()).enrollments[0].status, "Replied");
});
test("normalized duplicate address across campaigns is blocked", async () => {
  const f = await fixture();
  await assert.rejects(
    f.store.change((s) => {
      const c = createCampaign(s, demoUser, "Second", "demo-mailbox");
      const contact = {
        ...s.contacts[0],
        id: "copy",
        pocId: "copy",
        email: " MAYA@ASTERLABS.EXAMPLE ",
      };
      enroll(s, demoUser, contact, c.id);
    }),
    /active sequence/,
  );
});
test("concurrent worker claims cannot submit the same job twice", async () => {
  const f = await fixture();
  const other = new Worker(f.store, f.crm, f.provider, () => new Date(monday));
  await Promise.all([f.worker.tick(), other.tick(), f.worker.tick()]);
  assert.equal(f.provider.submitted.size, 1);
  assert.equal((await f.store.read()).enrollments[0].sent, 1);
});
test("missed time never bunches overdue steps together", async () => {
  const f = await fixture();
  f.at("2026-11-20T04:30:00.000Z");
  await f.worker.tick();
  const e = (await f.store.read()).enrollments[0];
  assert.equal(e.sent, 1);
  assert(Date.parse(e.nextAt!) >= Date.parse("2026-11-23T04:30:00.000Z"));
});
test("business hours, weekends and DST are applied in the configured zone", () => {
  assert.equal(
    businessTime("2026-10-10T16:00:00Z", defaultTiming),
    "2026-10-12T03:30:00.000Z",
  );
  const t = { ...defaultTiming, timezone: "America/New_York" };
  assert.equal(
    planned("2026-10-30T13:00:00Z", 1, t),
    "2026-11-02T14:00:00.000Z",
  );
  assert.throws(() => timingSchema.parse({ ...t, days: [0, 3, 3, 12, 18] }));
});
test("expired pre-dispatch lease recovers after restart", async () => {
  const f = await fixture();
  await f.worker.claim();
  f.at("2026-10-12T04:33:00.000Z");
  const restarted = new Worker(
    f.store,
    f.crm,
    f.provider,
    () => new Date("2026-10-12T04:33:00.000Z"),
  );
  await restarted.tick();
  assert.equal((await f.store.read()).enrollments[0].sent, 1);
});
test("lost send response is uncertain and never blindly retried", async () => {
  const f = await fixture();
  f.provider.send = async () => {
    throw new ProviderError("timeout", 0, true);
  };
  await f.worker.tick();
  f.at("2026-10-15T04:30:00.000Z");
  await f.worker.tick();
  const s = await f.store.read();
  assert.equal(s.jobs[0].state, "uncertain");
  assert.equal(s.jobs[0].attempts, 1);
  assert.equal(s.enrollments[0].status, "Failed");
  assert.equal(s.enrollments[0].holdEmail, true);
});
test("uncertain accepted send reconciles to Paused and requires explicit resume", async () => {
  const f = await fixture();
  const original = f.provider.send.bind(f.provider);
  f.provider.send = async (p, m) => {
    await original(p, m);
    throw new ProviderError("lost", 0, true);
  };
  await f.worker.tick();
  await f.worker.recover();
  const s = await f.store.read();
  assert.equal(s.jobs[0].state, "submitted");
  assert.equal(s.enrollments[0].status, "Paused");
  assert.equal(s.enrollments[0].sent, 1);
});
test("stop after dispatch fence preserves Stopped while recording accepted send", async () => {
  const f = await fixture();
  f.provider.send = async () => {
    await f.store.change((s) =>
      stop(s, s.enrollments[0], "crm_stop", demoUser.id),
    );
  };
  await f.worker.tick();
  const s = await f.store.read();
  assert.equal(s.enrollments[0].status, "Stopped");
  assert.equal(s.enrollments[0].sent, 1);
  assert.equal(s.jobs.filter((j) => j.state === "pending").length, 0);
});
test("unhealthy inbox blocks follow-ups and recovers only after health restored", async () => {
  const f = await fixture();
  await f.worker.tick();
  const at = (await f.store.read()).enrollments[0].nextAt!;
  await f.store.change((s) => {
    s.mailboxes[0].health = "unhealthy";
  });
  f.at(at);
  await f.worker.tick();
  assert.equal((await f.store.read()).enrollments[0].sent, 1);
  assert.match((await f.store.read()).enrollments[0].blockedReason!, /inbox/i);
  await f.store.change((s) => {
    s.mailboxes[0].health = "healthy";
  });
  await f.worker.tick();
  assert.equal((await f.store.read()).enrollments[0].sent, 2);
});
test("per mailbox limit counts reservations and delays excess mail", async () => {
  const f = await fixture();
  await f.store.change((s) => {
    s.mailboxes[0].dailyLimit = 1;
    const e = enroll(s, demoUser, s.contacts[1], "demo-campaign");
    e.drafts = structuredClone(s.enrollments[0].drafts);
    e.status = "Ready";
    start(s, demoUser, e, s.contacts[1], monday);
  });
  await f.worker.tick();
  assert.equal(f.provider.submitted.size, 1);
  assert(
    (await f.store.read()).enrollments.some((e) =>
      e.blockedReason?.includes("daily limit"),
    ),
  );
});
test("throttling honors Retry-After with a bounded retry count", async () => {
  const f = await fixture();
  f.provider.send = async () => {
    throw new ProviderError("throttle", 180000);
  };
  await f.worker.tick();
  const s = await f.store.read();
  assert.equal(s.jobs[0].state, "pending");
  assert.equal(Date.parse(s.jobs[0].dueAt) - Date.parse(monday), 180000);
  assert.equal(s.jobs[0].slotReserved, false);
  assert.equal(retryAfter("120"), 120000);
});
test("token refresh failure marks reconnect and prevents subsequent sends", async () => {
  const f = await fixture();
  f.provider.prepare = async () => {
    throw new ProviderError("expired", 0, false, true);
  };
  await f.worker.tick();
  assert.equal((await f.store.read()).mailboxes[0].health, "reconnect");
  assert.equal(f.provider.submitted.size, 0);
});
test("unauthorized contact read and stop are denied", async () => {
  const f = await fixture();
  const outsider = {
    id: "outside",
    name: "Outside",
    role: "BD Executive" as const,
    scope: ["outside"],
  };
  assert.throws(() => getEnrollment(f as any, outsider, f.e.id));
  await assert.rejects(
    f.store.change((s) => {
      const e = getEnrollment(s, outsider, f.e.id);
      stop(s, e, "manual", outsider.id);
    }),
    /ownership scope/,
  );
  assert.equal((await f.store.read()).enrollments[0].status, "Active");
});
test("CRM synchronization retries durably and eventually acknowledges", async () => {
  const f = await fixture();
  let failures = 1;
  f.crm.sync = async () => {
    if (failures-- > 0) throw new Error("offline");
  };
  await f.worker.syncOutbox();
  assert.equal((await f.store.read()).events[0].attempts, 1);
  f.at("2026-10-12T04:31:00.000Z");
  await f.worker.syncOutbox();
  assert.equal((await f.store.read()).events[0].state, "synced");
});
test("changed CRM email stops sending until recipient is reviewed", async () => {
  const f = await fixture();
  await f.store.change((s) => {
    s.contacts[0].email = "changed@example.com";
  });
  await f.worker.tick();
  const s = await f.store.read();
  assert.equal(
    s.enrollments[0].stopReason,
    "recipient_changed_review_required",
  );
  assert.equal(f.provider.submitted.size, 0);
});
test("suppression cannot be bypassed by explicit restart", async () => {
  const f = await fixture();
  await f.worker.tick();
  await f.store.change((s) =>
    receive(s, incoming(s.enrollments[0].conversationId!, "unsubscribe")),
  );
  await assert.rejects(
    f.store.change((s) =>
      start(s, demoUser, s.enrollments[0], s.contacts[0], monday, true),
    ),
    /suppressed/,
  );
});
test("pause and global emergency stop gate jobs before submission", async () => {
  const f = await fixture();
  await f.store.change((s) => {
    s.settings[0].emergencyStop = true;
  });
  await f.worker.tick();
  assert.equal(f.provider.submitted.size, 0);
  await f.store.change((s) => {
    s.settings[0].emergencyStop = false;
    pause(s, s.enrollments[0], demoUser.id);
  });
  await f.worker.tick();
  assert.equal(f.provider.submitted.size, 0);
});
test("malformed AI output, hallucinated evidence and unsupported hiring are rejected", async () => {
  const f = await fixture();
  const e = (await f.store.read()).enrollments[0];
  assert.throws(() => validateDrafts({ steps: [] }, e, []));
  const clean = e.drafts.map(({ approved, version, history, ...d }) => d);
  assert.throws(
    () =>
      validateDrafts(
        { steps: clean.map((d) => ({ ...d, evidenceIds: ["invented"] })) },
        e,
        [],
      ),
    /unavailable/,
  );
  assert.throws(
    () =>
      validateDrafts(
        {
          steps: clean.map((d) => ({
            ...d,
            body: "Hi Maya, you are currently hiring. Jobs Territory can help. Would you like to talk?",
          })),
        },
        e,
        [],
      ),
    /Unsupported/,
  );
  assert(e.drafts.every((d) => d.body.split(/\s+/).length < 180));
  assert(e.drafts.every((d) => !d.body.includes("actively hiring")));
});
test("undated and old vacancies cannot support current hiring claims", async () => {
  const f = await fixture();
  const r = (await f.store.read()).enrollments[0].research;
  r.evidence = [
    {
      id: "old",
      url: "https://example.com",
      summary: "A role",
      kind: "hiring",
      verified: true,
      researchedAt: monday,
      publishedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "undated",
      url: "https://example.com",
      summary: "A role",
      kind: "hiring",
      verified: true,
      researchedAt: monday,
    },
  ];
  assert.equal(currentEvidence(r, new Date(monday)).length, 0);
});
test("regenerating one email preserves other approved drafts and records history", async () => {
  const f = await fixture();
  await f.store.change((s) => pause(s, s.enrollments[0], demoUser.id));
  const e = (await f.store.read()).enrollments[0],
    drafts = (await generate(e, [], "Alex")).drafts;
  await f.store.change((s) =>
    saveDrafts(s, demoUser, s.enrollments[0], drafts, 2),
  );
  const after = (await f.store.read()).enrollments[0];
  assert.deepEqual(after.drafts[0], e.drafts[0]);
  assert.equal(after.drafts[2].version, 2);
  assert.equal(after.drafts[2].history.length, 1);
  assert.equal(after.drafts[2].approved, false);
});
test("encrypted credentials authenticate ciphertext and previews escape HTML", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const value = seal("private-refresh-token", key);
  assert(!value.includes("private"));
  assert.equal(unseal(value, key), "private-refresh-token");
  assert.throws(() => unseal(value, Buffer.alloc(32, 8).toString("base64")));
  assert(!htmlPreview("<script>alert(1)</script>").includes("<script>"));
  assert.equal(publicIPv4("127.0.0.1"), false);
  assert.equal(publicIPv4("169.254.169.254"), false);
  assert.equal(publicIPv4("10.0.0.1"), false);
  assert.equal(publicIPv4("::1"), false);
});
