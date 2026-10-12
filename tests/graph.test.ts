import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/store";
import {
  GraphEmail,
  ProviderError,
  beginOAuth,
  finishOAuth,
  retryAfter,
} from "../src/graph";
import { seed } from "../src/seed";
import { seal, unseal } from "../src/security";
import { config } from "../src/config";
async function graphFixture(fetcher: typeof fetch) {
  config.encryptionKey = Buffer.alloc(32, 9).toString("base64");
  const store = new MemoryStore();
  await seed(store);
  await store.change((s) => {
    Object.assign(s.mailboxes[0], {
      provider: "graph",
      tokens: seal(
        JSON.stringify({
          access_token: "mock-access",
          refresh_token: "mock-refresh",
        }),
      ),
      expiresAt: Date.now() + 3600000,
      clientState: seal("only-test-client-state"),
    });
  });
  return {
    store,
    m: (await store.read()).mailboxes[0],
    graph: new GraphEmail(store, fetcher),
  };
}
test("Graph request uses immutable IDs and honors throttling without replaying send", async () => {
  let count = 0;
  const f = await graphFixture(async (_url, init) => {
    count++;
    assert.equal((init!.headers as any).Prefer, 'IdType="ImmutableId"');
    return new Response("{}", {
      status: 429,
      headers: { "Retry-After": "90" },
    });
  });
  await assert.rejects(
    f.graph.request(f.m, "/me/messages/id/send", "POST", undefined, true),
    (e: ProviderError) => e.retryMs === 90000 && !e.uncertain,
  );
  assert.equal(count, 1);
});
test("Graph treats network loss and 5xx send results as uncertain", async () => {
  const f = await graphFixture(async () => {
    throw new Error("network");
  });
  await assert.rejects(
    f.graph.request(f.m, "/me/messages/id/send", "POST", undefined, true),
    (e: ProviderError) => e.uncertain,
  );
  const g = await graphFixture(async () => new Response("{}", { status: 503 }));
  await assert.rejects(
    g.graph.request(g.m, "/me/messages/id/send", "POST", undefined, true),
    (e: ProviderError) => e.uncertain,
  );
});
test("Graph refreshes expired OAuth token and persists encrypted rotation", async () => {
  const originalFetch = globalThis.fetch;
  const f = await graphFixture(async (_url, init) => {
    assert.equal(
      (init!.headers as any).Authorization,
      "Bearer refreshed-access",
    );
    return new Response('{"id":"me"}', { status: 200 });
  });
  await f.store.change((s) => {
    s.mailboxes[0].expiresAt = 0;
  });
  globalThis.fetch = (async (url, init) => {
    assert(String(url).includes("/token"));
    assert(String(init!.body).includes("grant_type=refresh_token"));
    return new Response(
      JSON.stringify({
        access_token: "refreshed-access",
        refresh_token: "rotated-refresh",
        expires_in: 3600,
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    await f.graph.request(f.m, "/me");
    const saved = (await f.store.read()).mailboxes[0];
    assert.equal(
      JSON.parse(unseal(saved.tokens!)).refresh_token,
      "rotated-refresh",
    );
    assert(!saved.tokens!.includes("rotated-refresh"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("Graph 401 refresh occurs once; second 401 requires reconnect", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  const f = await graphFixture(async () => {
    attempts++;
    return new Response("{}", { status: 401 });
  });
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        access_token: "fresh",
        refresh_token: "r",
        expires_in: 3600,
      }),
      { status: 200 },
    )) as typeof fetch;
  try {
    await assert.rejects(
      f.graph.request(f.m, "/me"),
      (e: ProviderError) => e.reconnect,
    );
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("Graph sync visits nested folders, persists delta cursors and renews subscription", async () => {
  const oldHook = config.webhookUrl;
  config.webhookUrl = "https://outreach.example/api/graph/notifications";
  const requested: string[] = [];
  const f = await graphFixture(async (url, init) => {
    const path = String(url).replace("https://graph.microsoft.com/v1.0", "");
    requested.push(path);
    if (path === "/subscriptions") {
      const body = JSON.parse(String(init!.body));
      assert.equal(body.clientState, "only-test-client-state");
      assert.equal(body.resource, "me/messages");
      assert(Date.parse(body.expirationDateTime) < Date.now() + 7 * 86400000);
      return Response.json({
        id: "sub-1",
        expirationDateTime: body.expirationDateTime,
      });
    }
    if (path === "/me/mailFolders?$top=100")
      return Response.json({ value: [{ id: "inbox", childFolderCount: 1 }] });
    if (path.includes("/childFolders"))
      return Response.json({
        value: [{ id: "rule-folder", childFolderCount: 0 }],
      });
    if (path.includes("/messages/delta"))
      return Response.json({
        value: [],
        "@odata.deltaLink": `https://graph.microsoft.com/v1.0/me/mailFolders/${path.includes("rule-folder") ? "rule-folder" : "inbox"}/messages/delta?token=test`,
      });
    throw new Error(`Unexpected route ${path}`);
  });
  try {
    await f.graph.sync(f.m);
    const m = (await f.store.read()).mailboxes[0];
    assert.equal(m.health, "healthy");
    assert.equal(m.subscriptionId, "sub-1");
    assert.equal(Object.keys(m.deltaLinks!).length, 2);
    assert(requested.some((x) => x.includes("rule-folder")));
  } finally {
    config.webhookUrl = oldHook;
  }
});
test("failed Graph reconciliation leaves mailbox visibly unhealthy", async () => {
  const f = await graphFixture(async () => new Response("{}", { status: 503 }));
  await assert.rejects(f.graph.sync(f.m));
  const m = (await f.store.read()).mailboxes[0];
  assert.equal(m.health, "unhealthy");
  assert(m.retryAt);
});
test("OAuth callback state is one-use and bound to the original browser session", async () => {
  const old = {
    mode: config.mode,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tenant: config.tenant,
  };
  Object.assign(config, {
    mode: "live",
    clientId: "test-client",
    clientSecret: "test-secret",
    tenant: "test-tenant",
  });
  const f = await graphFixture(fetch);
  try {
    const url = new URL(await beginOAuth(f.store, "demo-admin", "session-a"));
    const state = url.searchParams.get("state")!;
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    await assert.rejects(
      finishOAuth(f.store, state, "code", "session-b"),
      /state/,
    );
    assert.equal((await f.store.read()).oauth.length, 1);
  } finally {
    Object.assign(config, old);
  }
});
