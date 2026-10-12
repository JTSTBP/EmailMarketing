import { randomBytes, createHash } from "node:crypto";
import { config } from "./config";
import { assert, id, seal, unseal, normalizeEmail } from "./security";
import type { Store } from "./store";
import type { Enrollment, Job, Mailbox, Incoming } from "./types";
import { receive } from "./domain";
export class ProviderError extends Error {
  constructor(
    message: string,
    public retryMs = 0,
    public uncertain = false,
    public reconnect = false,
  ) {
    super(message);
  }
}
export interface EmailProvider {
  prepare(
    e: Enrollment,
    j: Job,
    m: Mailbox,
  ): Promise<{
    id: string;
    conversationId?: string;
    internetMessageId?: string;
    subject?: string;
  }>;
  send(providerId: string, m: Mailbox): Promise<void>;
  inspect(
    providerId: string,
    m: Mailbox,
  ): Promise<{
    submitted: boolean;
    conversationId?: string;
    internetMessageId?: string;
  }>;
  sync(m: Mailbox): Promise<void>;
}
export class MockEmail implements EmailProvider {
  submitted = new Set<string>();
  constructor(private store: Store) {}
  async prepare(e: Enrollment, j: Job, _m: Mailbox) {
    return {
      id: `mock-${j.id}`,
      conversationId:
        e.conversationId || `conversation-${e.id}-${e.generation}`,
      internetMessageId: `<${j.id}@mock.example>`,
      subject:e.conversationId?e.drafts[0].subject:e.drafts[j.step].subject,
    };
  }
  async send(providerId: string, _m: Mailbox) {
    this.submitted.add(providerId);
  }
  async inspect(providerId: string, _m: Mailbox) {
    return { submitted: this.submitted.has(providerId) };
  }
  async sync(m: Mailbox) {
    await this.store.change((s) => {
      const x = s.mailboxes.find((x) => x.id === m.id)!;
      if (x.health === "healthy") x.lastSyncAt = new Date().toISOString();
    });
  }
}
const scopes = "offline_access User.Read Mail.ReadWrite Mail.Send";
const graphRoot = "https://graph.microsoft.com/v1.0";
const tokenEndpoint = () =>
  `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`;
export async function tokenRequest(params: Record<string, string>) {
  const response = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: scopes,
      ...params,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new ProviderError(
      `Microsoft authorization failed (${response.status})`,
      0,
      false,
      true,
    );
  return response.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }>;
}
export async function beginOAuth(
  store: Store,
  userId: string,
  sessionId: string,
) {
  assert(
    (config.mode === "live" || config.localMicrosoftTest) &&
      config.clientId &&
      config.tenant &&
      config.clientSecret,
    "Microsoft OAuth is not configured",
  );
  const state = id(),
    verifier = randomBytes(32).toString("base64url");
  await store.change((s) => {
    s.oauth = s.oauth.filter((x) => Date.parse(x.expiresAt) > Date.now());
    s.oauth.push({
      id: state,
      userId,
      sessionId,
      verifier: seal(verifier),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    });
  });
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    response_mode: "query",
    scope: scopes,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/authorize?${params}`;
}
export async function finishOAuth(
  store: Store,
  state: string,
  code: string,
  sessionId: string,
) {
  const flow = await store.change((s) => {
    const f = s.oauth.find((x) => x.id === state);
    assert(
      f && f.sessionId === sessionId && Date.parse(f.expiresAt) > Date.now(),
      "OAuth state is invalid or expired",
      403,
    );
    s.oauth = s.oauth.filter((x) => x.id !== state);
    return f;
  });
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: unseal(flow.verifier),
  });
  const response = await fetch(
    `${graphRoot}/me?$select=id,mail,userPrincipalName,displayName`,
    {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  assert(response.ok, "Could not read Microsoft mailbox identity");
  const user: any = await response.json();
  assert(tokens.refresh_token, "Offline access was not granted");
  const mailboxId = `graph-${user.id}`;
  await store.change((s) => {
    const existing = s.mailboxes.find((x) => x.id === mailboxId);
    assert(
      !existing || existing.ownerId === flow.userId,
      "Mailbox is already connected by another user",
      409,
    );
    const m: Mailbox = {
      ...existing,
      id: mailboxId,
      ownerId: flow.userId,
      email: normalizeEmail(user.mail || user.userPrincipalName),
      name: user.displayName,
      provider: "graph",
      dailyLimit: existing?.dailyLimit || 50,
      health: "syncing",
      tokens: seal(JSON.stringify(tokens)),
      expiresAt: Date.now() + tokens.expires_in * 1000,
      clientState:
        existing?.clientState || seal(randomBytes(32).toString("hex")),
      syncRequested: true,
    };
    if (existing) Object.assign(existing, m);
    else s.mailboxes.push(m);
  });
}
export function retryAfter(value: string | null, now = Date.now()) {
  if (!value) return 60000;
  const seconds = Number(value);
  return Math.max(
    1000,
    Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(value) - now || 60000,
  );
}
export class GraphEmail implements EmailProvider {
  constructor(
    private store: Store,
    private fetcher: typeof fetch = fetch,
  ) {}
  async access(m: Mailbox, force = false) {
    const latest = (await this.store.read()).mailboxes.find(
      (x) => x.id === m.id,
    )!;
    assert(latest.tokens, "Reconnect Microsoft mailbox");
    const token = JSON.parse(unseal(latest.tokens));
    if (!force && latest.expiresAt! > Date.now() + 60000)
      return token.access_token as string;
    try {
      const refreshed = await tokenRequest({
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
      });
      await this.store.change((s) => {
        const row = s.mailboxes.find((x) => x.id === m.id)!;
        if (row.tokens === latest.tokens) {
          row.tokens = seal(
            JSON.stringify({
              ...refreshed,
              refresh_token: refreshed.refresh_token || token.refresh_token,
            }),
          );
          row.expiresAt = Date.now() + refreshed.expires_in * 1000;
        }
      });
      const current = (await this.store.read()).mailboxes.find(
        (x) => x.id === m.id,
      )!;
      return JSON.parse(unseal(current.tokens!)).access_token as string;
    } catch (e) {
      await this.store.change((s) => {
        const row = s.mailboxes.find((x) => x.id === m.id)!;
        row.health = "reconnect";
        row.error = "Microsoft token refresh failed. Reconnect mailbox.";
      });
      throw e;
    }
  }
  async request(
    m: Mailbox,
    path: string,
    method = "GET",
    body?: unknown,
    isSend = false,
    refreshed = false,
  ): Promise<any> {
    const url = path.startsWith("https:") ? path : `${graphRoot}${path}`;
    assert(
      url.startsWith(`${graphRoot}/`) &&
        new URL(url).origin === "https://graph.microsoft.com",
      "Invalid Graph URL",
    );
    const access = await this.access(m);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        headers: {
          Authorization: `Bearer ${access}`,
          "content-type": "application/json",
          Prefer: 'IdType="ImmutableId"',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new ProviderError("Microsoft response was lost", 0, isSend);
    }
    if (response.status === 401 && !refreshed) {
      await this.access(m, true);
      return this.request(m, path, method, body, isSend, true);
    }
    if (response.status === 429)
      throw new ProviderError(
        "Microsoft throttled the request",
        retryAfter(response.headers.get("retry-after")),
      );
    if (!response.ok)
      throw new ProviderError(
        `Microsoft request failed (${response.status})`,
        response.status >= 500 ? 60000 : 0,
        isSend && response.status >= 500,
        response.status === 401,
      );
    if (response.status === 204 || response.status === 202) return undefined;
    if(path.endsWith('/$value')){
      assert(response.body, 'Microsoft returned no MIME body');
      const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
      try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;assert(size<=2_000_000,'Delivery report exceeds safe inspection size');chunks.push(value);}}finally{await reader.cancel();}
      return Buffer.concat(chunks).toString('utf8');
    }
    return response.json();
  }
  async prepare(e: Enrollment, j: Job, m: Mailbox) {
    assert(config.liveSending, "Production sending is disabled");
    const draft = e.drafts[j.step];
    let data: any;
    if (j.step > 0 && e.conversationId) {
      assert(
        config.threadingVerified,
        "Live follow-ups require tenant threading verification",
      );
      const sent = (await this.store.read()).jobs
        .filter((x) => x.enrollmentId === e.id && x.state === "submitted")
        .sort((a, b) => b.step - a.step)[0];
      assert(sent?.providerId, "Original provider message is unavailable");
      data = await this.request(
        m,
        `/me/messages/${encodeURIComponent(sent.providerId)}/createReply`,
        "POST",
        {},
      );
      await this.request(
        m,
        `/me/messages/${encodeURIComponent(data.id)}`,
        "PATCH",
        {
          body: { contentType: "Text", content: draft.body },
          toRecipients: [{ emailAddress: { address: e.normalizedEmail } }],
          ccRecipients: [],
          bccRecipients: [],
        },
      );
      assert(
        data.conversationId === e.conversationId,
        "Microsoft reply draft did not preserve the conversation",
      );
    } else
      data = await this.request(m, "/me/messages", "POST", {
        subject: draft.subject,
        body: { contentType: "Text", content: draft.body },
        toRecipients: [{ emailAddress: { address: e.normalizedEmail } }],
        internetMessageHeaders: [{ name: "x-jt-sequence-job", value: j.id }],
      });
    return {
      id: data.id,
      conversationId: data.conversationId,
      internetMessageId: data.internetMessageId,
      subject:data.subject||draft.subject,
    };
  }
  async send(providerId: string, m: Mailbox) {
    assert(config.liveSending, "Production sending is disabled");
    await this.request(
      m,
      `/me/messages/${encodeURIComponent(providerId)}/send`,
      "POST",
      undefined,
      true,
    );
  }
  async inspect(providerId: string, m: Mailbox) {
    const data = await this.request(
      m,
      `/me/messages/${encodeURIComponent(providerId)}?$select=id,isDraft,sentDateTime,conversationId,internetMessageId`,
    );
    return {
      submitted: data.isDraft === false && !!data.sentDateTime,
      conversationId: data.conversationId,
      internetMessageId: data.internetMessageId,
    };
  }
  async sync(m: Mailbox) {
    const lease = id();
    const acquired = await this.store.change((s) => {
      const box = s.mailboxes.find((x) => x.id === m.id)!;
      if (
        (box.syncLeaseUntil && Date.parse(box.syncLeaseUntil) > Date.now()) ||
        (box.retryAt && Date.parse(box.retryAt) > Date.now())
      )
        return false;
      box.syncLeaseId = lease;
      box.syncLeaseUntil = new Date(Date.now() + 180000).toISOString();
      box.health = "syncing";
      return true;
    });
    if (!acquired) return;
    try {
      let current = (await this.store.read()).mailboxes.find(
        (x) => x.id === m.id,
      )!;
      // Renew below the seven-day maximum; notifications contain IDs only, no rich data.
      if (
        config.webhookUrl &&
        (!current.subscriptionExpiresAt ||
          Date.parse(current.subscriptionExpiresAt) < Date.now() + 86400000)
      ) {
        const expirationDateTime = new Date(
          Date.now() + 3 * 86400000,
        ).toISOString();
        let sub: any;
        if (current.subscriptionId) {
          try {
            sub = await this.request(
              current,
              `/subscriptions/${encodeURIComponent(current.subscriptionId)}`,
              "PATCH",
              { expirationDateTime },
            );
          } catch (error) {
            if ((error as Error).message.includes("(404)"))
              current.subscriptionId = undefined;
            else throw error;
          }
        }
        if (!current.subscriptionId)
          sub = await this.request(current, "/subscriptions", "POST", {
            changeType: "created",
            resource: "me/messages",
            notificationUrl: config.webhookUrl,
            lifecycleNotificationUrl: config.webhookUrl,
            expirationDateTime,
            clientState: unseal(current.clientState!),
          });
        await this.store.change((s) => {
          const row = s.mailboxes.find((x) => x.id === m.id)!;
          row.subscriptionId = sub.id;
          row.subscriptionExpiresAt = sub.expirationDateTime;
        });
      }
      for (const providerId of current.pendingMessageIds || []) {
        try {
          await this.importMessage(m, providerId);
        } catch (error) {
          if (!(error as Error).message.includes("(404)")) throw error;
        }
        await this.store.change((s) => {
          const row = s.mailboxes.find((x) => x.id === m.id)!;
          row.pendingMessageIds = (row.pendingMessageIds || []).filter(
            (x) => x !== providerId,
          );
        });
      }
      // Reconcile every non-hidden folder, including nested folders, to cover inbox rules.
      const folderIds: string[] = [];
      const folders = async (path: string) => {
        let next: string | undefined = path;
        while (next) {
          const data = await this.request(m, next);
          for (const folder of data.value) {
            folderIds.push(folder.id);
            if (folder.childFolderCount)
              await folders(
                `/me/mailFolders/${encodeURIComponent(folder.id)}/childFolders?$top=100`,
              );
          }
          next = data["@odata.nextLink"];
        }
      };
      await folders("/me/mailFolders?$top=100");
      for (const folderId of folderIds) {
        let next: string | undefined =
          current.deltaLinks?.[folderId] ||
          `/me/mailFolders/${encodeURIComponent(folderId)}/messages/delta?$select=id,from,conversationId,isDraft&$top=100`;
        let pages = 0;
        while (next) {
          assert(
            ++pages <= 500,
            "Mailbox synchronization needs operator review: folder exceeds pilot page limit",
          );
          let data: any;
          try {
            data = await this.request(m, next);
          } catch (error) {
            if ((error as Error).message.includes("(410)")) {
              await this.store.change((s) => {
                delete s.mailboxes.find((x) => x.id === m.id)!.deltaLinks?.[
                  folderId
                ];
              });
            }
            throw error;
          }
          for (const message of data.value) {
            if (
              !message["@removed"] &&
              !message.isDraft &&
              normalizeEmail(message.from?.emailAddress?.address || "") !==
                normalizeEmail(m.email)
            )
              await this.importMessage(m, message.id);
          }
          next = data["@odata.nextLink"];
          await this.store.change((s) => {
            const row = s.mailboxes.find((x) => x.id === m.id)!;
            assert(row.syncLeaseId === lease, "Sync lease lost");
            row.syncLeaseUntil = new Date(Date.now() + 180000).toISOString();
            row.deltaLinks ||= {};
            row.deltaLinks[folderId] =
              data["@odata.nextLink"] || data["@odata.deltaLink"];
          });
        }
      }
      await this.store.change((s) => {
        const row = s.mailboxes.find((x) => x.id === m.id)!;
        if (row.syncLeaseId !== lease) return;
        row.health = "healthy";
        row.lastSyncAt = new Date().toISOString();
        row.syncRequested = false;
        row.syncLeaseUntil = undefined;
        row.error = undefined;
        row.retryAt = undefined;
      });
    } catch (error) {
      await this.store.change((s) => {
        const row = s.mailboxes.find((x) => x.id === m.id)!;
        if (row.syncLeaseId !== lease) return;
        row.health = (error as ProviderError).reconnect
          ? "reconnect"
          : "unhealthy";
        row.error = "Inbox synchronization failed; follow-ups are blocked.";
        row.syncLeaseUntil = undefined;
        row.retryAt = new Date(
          Date.now() + ((error as ProviderError).retryMs || 60000),
        ).toISOString();
      });
      throw error;
    }
  }
  async importMessage(m: Mailbox, providerId: string) {
    const data = await this.request(
      m,
      `/me/messages/${encodeURIComponent(providerId)}?$select=id,conversationId,internetMessageId,internetMessageHeaders,from,subject,bodyPreview,receivedDateTime,isDraft`,
    );
    if (
      data.isDraft ||
      normalizeEmail(data.from?.emailAddress?.address || "") ===
        normalizeEmail(m.email)
    )
      return;
    const headers = Object.fromEntries(
      (data.internetMessageHeaders || []).map((h: any) => [
        h.name.toLowerCase(),
        h.value,
      ]),
    );
    const refs = (headers.references || "").match(/<[^>]+>/g) || [];
    const automatic =
      headers["auto-submitted"] && headers["auto-submitted"] !== "no";
    const bounce =
      /multipart\/report.*delivery-status/i.test(
        headers["content-type"] || "",
      ) || !!headers["x-failed-recipients"];
    if(bounce){
      const mime=await this.request(m,`/me/messages/${encodeURIComponent(providerId)}/$value`);
      // Original IDs in a DSN or attached RFC822 headers identify the actual message.
      // A recipient address or mailer-daemon sender alone is never sufficient.
      for(const match of String(mime).matchAll(/(?:^|\r?\n)(?:Original-Message-ID|Message-ID):\s*(<[^>\r\n]+>)/gi))refs.push(match[1]);
    }
    const message: Incoming = {
      id: id(),
      mailboxId: m.id,
      providerId: data.id,
      conversationId: data.conversationId,
      inReplyTo: headers["in-reply-to"],
      references: refs,
      originalMessageId: headers["original-message-id"],
      from: data.from?.emailAddress?.address || "",
      subject: data.subject || "",
      body: data.bodyPreview || "",
      receivedAt: data.receivedDateTime || new Date().toISOString(),
      kind: bounce ? "bounce" : automatic ? "automatic" : "reply",
    };
    await this.store.change((s) => {
      const linked = s.jobs.some(
        (j) =>
          s.enrollments.some(
            (e) => e.id === j.enrollmentId && e.mailboxId === m.id,
          ) &&
          ((j.conversationId && j.conversationId === message.conversationId) ||
            (j.internetMessageId &&
              [message.inReplyTo, message.originalMessageId, ...refs].includes(
                j.internetMessageId,
              ))),
      );
      if (linked) receive(s, message);
    });
  }
}
