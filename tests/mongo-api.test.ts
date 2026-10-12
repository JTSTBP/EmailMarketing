import { test } from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoStore } from "../src/store";
import { seed, demoUser } from "../src/seed";
import { createApp } from "../src/app";
import { MockCRM } from "../src/crm";
import { MockEmail } from "../src/graph";
import { Worker } from "../src/worker";
import { enroll } from "../src/domain";
test("real Mongo transactions, indexes, restart persistence and complete HTTP review workflow", async () => {
  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    binary: { version: "7.0.14" },
  });
  const uri = mongo.getUri("outreach_test");
  let store = await MongoStore.connect(uri);
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  try {
    await seed(store);
    // Retry concurrent transactions without losing writes.
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        store.change((s) => {
          s.audits.push({
            id: `concurrent-${i}`,
            action: "test",
            actor: "test",
            entityId: "test",
            at: new Date().toISOString(),
          });
        }),
      ),
    );
    assert.equal((await store.read()).audits.length, 8);
    const crm = new MockCRM(() => store.read()),
      provider = new MockEmail(store),
      worker = new Worker(store, crm, provider);
    server = createApp(store, crm, worker).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server!.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const req = async (url: string, body?: any, method?: string) => {
      const res = await fetch(`${base}/api${url}`, {
        method: method || (body ? "POST" : "GET"),
        headers: { "content-type": "application/json", "x-jt-request": "1" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, data: (await res.json()) as any };
    };
    const response = await req("/enroll", {
      campaignId: "demo-campaign",
      contacts: [{ leadId: "lead-0", pocId: "poc-0" }],
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const eid = response.data[0].id;
    assert.equal(
      (await req(`/enrollments/${eid}/action`, { action: "start" })).status,
      400,
    );
    assert.equal((await req(`/enrollments/${eid}/generate`, {})).status, 200);
    let state = (await req("/state")).data;
    assert.equal(state.enrollments[0].drafts.length, 5);
    assert.equal(state.jobs.length, 0);
    const d = state.enrollments[0].drafts[0];
    const edit = await req(
      `/enrollments/${eid}/drafts/0`,
      { subject: d.subject, body: d.body, version: d.version, approve: true },
      "PATCH",
    );
    assert.equal(edit.status, 200, JSON.stringify(edit.data));
    assert.equal(
      (await req(`/enrollments/${eid}/action`, { action: "approve" })).status,
      200,
    );
    assert.equal(
      (await req(`/enrollments/${eid}/action`, { action: "start" })).status,
      200,
    );
    assert.equal((await req("/mock/run", { enrollmentId: eid })).status, 200);
    state = (await req("/state")).data;
    assert.equal(state.enrollments[0].sent, 1);
    assert.equal(
      (await req("/mock/incoming", { enrollmentId: eid, kind: "automatic" }))
        .status,
      200,
    );
    state = (await req("/state")).data;
    assert.equal(state.enrollments[0].status, "Replied");
    assert(!state.jobs.some((j: any) => j.state === "pending"));
    assert(!JSON.stringify(state.mailboxes).includes("tokens"));
    assert(!JSON.stringify(state).includes("crmToken"));
    // Untrusted browser requests cannot mutate state without request protection.
    const denied = await fetch(`${base}/api/emergency`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"enabled":true}',
    });
    assert.equal(denied.status, 403);
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    await store.close();
    store = await MongoStore.connect(uri);
    assert.equal((await store.read()).enrollments[0].status, "Replied");
    await assert.rejects(
      store.change((s) => enroll(s, demoUser, s.contacts[0], "demo-campaign")),
      /already enrolled/,
    );
    const indexes = await store.client.db().collection("enrollments").indexes();
    assert(
      indexes.some(
        (i) => i.unique && i.partialFilterExpression?.holdEmail === true,
      ),
    );
  } finally {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    await store.close();
    await mongo.stop();
  }
});
