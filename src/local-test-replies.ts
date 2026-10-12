import { config } from "./config";
import { GraphEmail } from "./graph";
import { assert, normalizeEmail } from "./security";
import type { Store } from "./store";
import type { Incoming } from "./types";
import { stop } from "./domain";

export async function syncLocalTestReplies(store: Store, mailboxIds: string[]) {
  assert(config.localMicrosoftTest && config.mode === "mock" && !config.liveSending, "Local test sync is disabled");
  const tests = await store.manualSendHistory?.(mailboxIds) || [];
  const state = await store.read();
  const graph = new GraphEmail(store);
  const matches = new Map<string, Incoming>();
  for (const test of tests.filter(t => t.state === "accepted" && t.providerId)) {
    const mailbox = state.mailboxes.find(m => m.id === test.mailboxId && m.provider === "graph");
    if (!mailbox) continue;
    const sent = await graph.request(mailbox, `/me/messages/${encodeURIComponent(test.providerId!)}?$select=conversationId,internetMessageId`);
    if (!sent.conversationId) continue;
    const query = new URLSearchParams({
      "$filter": `conversationId eq '${String(sent.conversationId).replaceAll("'", "''")}'`,
      "$select": "id,conversationId,from,subject,body,receivedDateTime,internetMessageHeaders",
      "$top": "100",
    });
    let next: string | undefined = `/me/messages?${query}`;
    for (let page = 0; next && page < 5; page++) {
      const result = await graph.request(mailbox, next);
      for (const message of result.value || []) {
        const from = normalizeEmail(message.from?.emailAddress?.address || "");
        if (from !== normalizeEmail(test.recipient)) continue;
        const headers = message.internetMessageHeaders || [];
        const header = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name)?.value;
        const content = String(message.body?.content || "");
        const body = message.body?.contentType?.toLowerCase() === "html"
          ? content.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?\s*>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
          : content;
        const auto = header("auto-submitted");
        const id = `manual-reply-${mailbox.id}-${message.id}`;
        matches.set(id, { id, mailboxId: mailbox.id, providerId: message.id, conversationId: message.conversationId, manualTestId: test.id, from, subject: message.subject || "", body, kind: auto && auto.toLowerCase() !== "no" ? "automatic" : "reply", receivedAt: message.receivedDateTime, inReplyTo: header("in-reply-to") });
      }
      next = result["@odata.nextLink"];
    }
  }
  return store.change(s => {
    let imported = 0;
    for (const message of matches.values()) {
      const test = tests.find(t => t.id === message.manualTestId);
      const enrollment = test?.enrollmentId && s.enrollments.find(e => e.id === test.enrollmentId && e.mailboxId === message.mailboxId && e.normalizedEmail === message.from);
      const existing = s.incoming.find(m => m.id === message.id);
      if (existing?.enrollmentId && enrollment && existing.enrollmentId === enrollment.id) continue;
      if (enrollment) {
        message.enrollmentId = enrollment.id;
        if (existing) existing.enrollmentId = enrollment.id;
        enrollment.replyId = message.id;
        stop(s, enrollment, message.kind === "automatic" ? "automatic_reply" : "reply", "inbox", message.receivedAt, "Replied");
      }
      if (existing) continue;
      s.incoming.push(message); imported++;
    }
    return { imported, matched: matches.size };
  });
}
