import type {
  State,
  User,
  Enrollment,
  Incoming,
  Contact,
  Campaign,
  Draft,
  Research,
  Timing,
} from "./types";
import { assert, id, normalizeEmail } from "./security";
import { defaultTiming, nextTime } from "./schedule";
export const nowISO = () => new Date().toISOString();
export function canAccess(u: User, c: Contact) {
  return u.role === "Admin" || c.owners.some((x) => u.scope.includes(x));
}
export function authorize(u: User, c: Contact) {
  assert(
    canAccess(u, c),
    "This contact is outside your CRM ownership scope",
    403,
  );
}
export function audit(
  s: State,
  u: string,
  action: string,
  entityId: string,
  at = nowISO(),
  detail?: string,
) {
  s.audits.push({ id: id(), actor: u, action, entityId, at, detail });
}
export function event(s: State, e: Enrollment, type: string, at = nowISO()) {
  e.revision++;
  s.events.push({
    id: id(),
    enrollmentId: e.id,
    leadId: e.leadId,
    pocId: e.pocId,
    type,
    status: e.status,
    stopReason: e.stopReason,
    sent: e.sent,
    lastSentAt: e.lastSentAt,
    nextAt: e.nextAt,
    replyId: e.replyId,
    revision: e.revision,
    at,
    state: "pending",
    attempts: 0,
    nextAttemptAt: at,
  });
}
export function createCampaign(
  s: State,
  u: User,
  name: string,
  mailboxId: string,
  timing: Timing = defaultTiming,
) {
  const m = s.mailboxes.find((x) => x.id === mailboxId);
  assert(
    m && (u.role === "Admin" || m.ownerId === u.id),
    "Choose an accessible mailbox",
  );
  const c: Campaign = {
    id: id(),
    name,
    ownerId: u.id,
    status: "Draft",
    mailboxId,
    timing,
    createdAt: nowISO(),
  };
  s.campaigns.push(c);
  audit(s, u.id, "campaign.create", c.id);
  return c;
}
export function enroll(s: State, u: User, c: Contact, campaignId: string) {
  authorize(u, c);
  const campaign = s.campaigns.find((x) => x.id === campaignId);
  assert(
    campaign && (u.role === "Admin" || campaign.ownerId === u.id),
    "Campaign not found",
    404,
  );
  assert(
    campaign.status !== "Stopped",
    "A stopped campaign cannot enroll contacts",
  );
  const email = normalizeEmail(c.email);
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'CRM contact needs a valid email address');
  assert(
    !s.suppressions.some((x) => x.id === email),
    "This address is suppressed",
  );
  assert(
    !s.enrollments.some(
      (e) =>
        e.leadId === c.leadId &&
        e.pocId === c.pocId &&
        e.sequenceId === campaignId,
    ),
    "Contact already enrolled in this campaign",
    409,
  );
  assert(
    !s.enrollments.some((e) => e.normalizedEmail === email && e.holdEmail),
    "This email already has an active sequence",
    409,
  );
  const research = s.research.find((x) => x.contactId === c.id) || {
    id: id(),
    contactId: c.id,
    company: c.company,
    evidence: [],
    hypotheses: [],
    limitations: [
      "Current employment and hiring have not been independently verified.",
      "LinkedIn login-restricted information is not accessed.",
    ],
    updatedAt: nowISO(),
  };
  const e: Enrollment = {
    id: id(),
    leadId: c.leadId,
    pocId: c.pocId,
    sequenceId: campaign.id,
    ownerId: u.id,
    contact: structuredClone(c),
    mailboxId: campaign.mailboxId,
    timing: structuredClone(campaign.timing),
    status: "Draft",
    stopReason: null,
    holdEmail: false,
    normalizedEmail: email,
    drafts: [],
    research: structuredClone(research),
    sent: 0,
    generation: 0,
    revision: 0,
    createdAt: nowISO(),
  };
  s.enrollments.push(e);
  audit(s, u.id, "enroll", e.id);
  return e;
}
export function getEnrollment(s: State, u: User, uid: string) {
  const e = s.enrollments.find((x) => x.id === uid);
  assert(e, "Sequence not found", 404);
  authorize(u, e.contact);
  return e;
}
export function saveDrafts(
  s: State,
  u: User,
  e: Enrollment,
  drafts: Draft[],
  single?: number,
) {
  assert(
    ["Draft", "Ready", "Paused"].includes(e.status),
    "Pause the sequence before editing",
  );
  if (single !== undefined)
    assert(single >= e.sent, "Submitted drafts cannot be edited");
  for (const draft of drafts) {
    if (draft.step < e.sent || (single !== undefined && draft.step !== single))
      continue;
    const old = e.drafts.find((x) => x.step === draft.step);
    draft.history = old
      ? [
          ...old.history,
          {
            subject: old.subject,
            body: old.body,
            version: old.version,
            at: nowISO(),
          },
        ]
      : [];
    draft.version = (old?.version || 0) + 1;
    draft.approved = false;
    const i = e.drafts.findIndex((x) => x.step === draft.step);
    if (i >= 0) e.drafts[i] = draft;
    else e.drafts.push(draft);
  }
  e.drafts.sort((a, b) => a.step - b.step);
  if (e.status !== "Paused") e.status = "Draft";
  audit(s, u.id, single === undefined ? "generate" : "regenerate", e.id);
}
export function queueNext(s: State, e: Enrollment) {
  if (e.sent >= 5) return;
  const dueAt = nextTime(e.startAt!, e.sent, e.timing, e.lastSentAt);
  e.nextAt = dueAt;
  const key = `${e.id}:${e.generation}:${e.sent}`;
  if (!s.jobs.some((j) => j.id === key))
    s.jobs.push({
      id: key,
      enrollmentId: e.id,
      step: e.sent,
      generation: e.generation,
      dueAt,
      state: "pending",
      attempts: 0,
    });
}
export function start(
  s: State,
  u: User,
  e: Enrollment,
  current: Contact,
  at = nowISO(),
  restart = false,
) {
  authorize(u, current);
  assert(
    [
      "Ready",
      "Paused",
      ...(restart ? ["Stopped", "Replied", "Failed"] : []),
    ].includes(e.status),
    "Review and approve all drafts before starting",
  );
  assert(!s.settings[0].emergencyStop, "Global emergency stop is active");
  assert(
    !s.suppressions.some((x) => x.id === e.normalizedEmail),
    "Address is suppressed",
  );
  assert(
    normalizeEmail(current.email) === e.normalizedEmail,
    "CRM email changed. Review recipient before starting",
  );
  assert(
    e.drafts.length === 5 && e.drafts.every((d) => d.approved),
    "All five drafts need approval",
  );
  assert(e.sent < 5, "All five emails have already been submitted");
  assert(
    !s.jobs.some(
      (j) =>
        j.enrollmentId === e.id &&
        ["uncertain", "dispatching", "claimed"].includes(j.state),
    ),
    "An outstanding send requires reconciliation",
  );
  assert(
    !s.enrollments.some(
      (x) =>
        x.id !== e.id && x.normalizedEmail === e.normalizedEmail && x.holdEmail,
    ),
    "This email already has an active sequence",
    409,
  );
  const campaign = s.campaigns.find((x) => x.id === e.sequenceId)!;
  assert(
    campaign.status !== "Stopped" && campaign.status !== "Paused",
    "Activate the campaign first",
  );
  const m = s.mailboxes.find((x) => x.id === e.mailboxId);
  assert(m?.health === "healthy", "Mailbox synchronization must be healthy");
  assert(u.role==='Admin'||m.ownerId===u.id, 'Only the mailbox owner or an administrator can start sending',403);
  assert(e.drafts.filter(d=>d.step>=e.sent).every(d=>!d.caseStudyId||s.cases.some(c=>c.id===d.caseStudyId&&c.permission)), 'An approved case study has been withdrawn; revise those drafts');
  e.contact = structuredClone(current);
  e.status = "Active";
  e.stopReason = null;
  e.blockedReason = undefined;
  e.holdEmail = true;
  e.generation++;
  e.startAt = e.startAt || at;
  if (restart) {
    e.replyId = undefined;
    e.conversationId = undefined;
  }
  campaign.status = "Active";
  queueNext(s, e);
  event(s, e, restart ? "sequence.restarted" : "sequence.started", at);
  audit(s, u.id, restart ? "restart" : "start", e.id, at);
}
export function stop(
  s: State,
  e: Enrollment,
  reason: string,
  actor: string,
  at = nowISO(),
  status: "Stopped" | "Replied" = "Stopped",
) {
  if (
    (e.status === "Stopped" || e.status === "Replied") &&
    e.stopReason === reason
  )
    return;
  e.status = status;
  e.stopReason = reason;
  e.nextAt = undefined;
  e.blockedReason = undefined;
  e.generation++;
  for (const j of s.jobs.filter(
    (j) => j.enrollmentId === e.id && ["pending", "claimed"].includes(j.state),
  ))
    j.state = "cancelled";
  e.holdEmail = s.jobs.some(
    (j) =>
      j.enrollmentId === e.id && ["dispatching", "uncertain"].includes(j.state),
  );
  event(s, e, status === "Replied" ? "reply.received" : "contact.stopped", at);
  audit(s, actor, "stop", e.id, at, reason);
}
export function pause(s: State, e: Enrollment, actor: string) {
  assert(e.status === "Active", "Only active sequences can be paused");
  e.status = "Paused";
  e.generation++;
  e.nextAt = undefined;
  for (const j of s.jobs.filter(
    (j) => j.enrollmentId === e.id && ["pending", "claimed"].includes(j.state),
  ))
    j.state = "cancelled";
  event(s, e, "sequence.paused");
  audit(s, actor, "pause", e.id);
}
export function receive(s: State, message: Incoming) {
  if (
    s.incoming.some(
      (x) =>
        x.mailboxId === message.mailboxId &&
        x.providerId === message.providerId,
    )
  )
    return false;
  const refs = [
    message.inReplyTo,
    message.originalMessageId,
    ...(message.references || []),
  ].filter(Boolean);
  const matching = s.enrollments.filter(
    (e) =>
      e.mailboxId === message.mailboxId &&
      s.jobs.some(
        (j) =>
          j.enrollmentId === e.id &&
          ["submitted", "dispatching", "uncertain"].includes(j.state) &&
          ((message.conversationId &&
            j.conversationId === message.conversationId) ||
            (j.internetMessageId && refs.includes(j.internetMessageId))),
      ),
  );
  if (matching.length === 1) {
    const e = matching[0];
    message.enrollmentId = e.id;
    e.replyId = message.id;
    const reason =
      message.kind === "bounce"
        ? "bounce"
        : message.kind === "unsubscribe"
          ? "unsubscribe"
          : message.kind === "automatic"
            ? "automatic_reply"
            : "reply";
    if (
      ["bounce", "unsubscribe"].includes(message.kind) &&
      !s.suppressions.some((x) => x.id === e.normalizedEmail)
    )
      s.suppressions.push({
        id: e.normalizedEmail,
        reason,
        at: message.receivedAt,
      });
    stop(
      s,
      e,
      reason,
      "inbox",
      message.receivedAt,
      ["reply", "automatic"].includes(message.kind) ? "Replied" : "Stopped",
    );
  }
  s.incoming.push(message);
  return !!message.enrollmentId;
}
