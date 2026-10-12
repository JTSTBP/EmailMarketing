import type { Store } from "./store";
import type { CRM } from "./crm";
import { ProviderError, type EmailProvider } from "./graph";
import type { Enrollment, Job, State } from "./types";
import { id, normalizeEmail } from "./security";
import { businessTime, dayKey } from "./schedule";
import { event, queueNext, stop, pause } from "./domain";
import { currentEvidence } from './ai';
import { config } from "./config";
import { syncLocalTestReplies } from "./local-test-replies";
export class Worker {
  private localReplyCheckAt = 0;
  constructor(
    private store: Store,
    private crm: CRM,
    private provider: EmailProvider,
    private clock = () => new Date(),
    private concurrency = 4,
  ) {}
  now() {
    return this.clock().toISOString();
  }
  async mockAdvance(enrollmentId: string) {
    if (config.mode !== "mock") throw new Error("Mock clock is disabled");
    const s = await this.store.read();
    const e = s.enrollments.find((e) => e.id === enrollmentId);
    if (!e?.nextAt) throw new Error("No next step is scheduled");
    const at = e.nextAt;
    await new Worker(
      this.store,
      this.crm,
      this.provider,
      () => new Date(at),
      this.concurrency,
    ).tick();
  }
  async tick() {
    if (config.localMicrosoftTest && Date.now() - this.localReplyCheckAt >= 60000) {
      this.localReplyCheckAt = Date.now();
      const mailboxes = (await this.store.read()).mailboxes.filter(m => m.provider === "graph");
      try { await syncLocalTestReplies(this.store, mailboxes.map(m => m.id)); }
      catch {
        // Keep the worker running, but make failed local polling visible.
        await this.store.change(s => { for (const m of s.mailboxes.filter(m => mailboxes.some(x => x.id === m.id))) m.error = "Local reply check failed. Reconnect or retry Check test replies."; });
      }
    }
    await this.recover();
    await this.syncOutbox();
    const s = await this.store.read();
    for (const m of s.mailboxes) {
      if (m.health === "reconnect") continue;
      if (
        m.syncRequested ||
        !m.lastSyncAt ||
        Date.parse(m.lastSyncAt) < this.clock().getTime() - 60000
      )
        try {
          await this.provider.sync(m);
        } catch {
          /* visible health is stored by provider */
        }
    }
    for (let i = 0; i < this.concurrency; i++) {
      const job = await this.claim();
      if (!job) break;
      await this.dispatch(job);
    }
  }
  async claim() {
    const now = this.now();
    return this.store.change((s) => {
      if (s.settings[0].emergencyStop) return null;
      if (
        s.jobs.filter(
          (j) =>
            ["claimed", "dispatching"].includes(j.state) && j.leaseUntil! > now,
        ).length >= this.concurrency
      )
        return null;
      for (const j of s.jobs
        .filter((j) => j.state === "pending" && j.dueAt <= now)
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt))) {
        const e = s.enrollments.find((e) => e.id === j.enrollmentId)!;
        const campaign = s.campaigns.find((c) => c.id === e.sequenceId)!;
        const m = s.mailboxes.find((m) => m.id === e.mailboxId)!;
        if (
          e.generation !== j.generation ||
          ["Stopped", "Replied", "Completed", "Failed"].includes(e.status)
        ) {
          j.state = "cancelled";
          continue;
        }
        if (e.status !== "Active" || campaign.status !== "Active") continue;
        if (m.provider === "graph" && !config.liveSending) {
          e.blockedReason = "Production sending is disabled";
          continue;
        }
        if (m.provider === "graph" && j.step > 0 && !config.threadingVerified) {
          e.blockedReason =
            "Tenant conversation threading has not been verified";
          continue;
        }
        if (
          m.health !== "healthy" ||
          (m.provider === "graph" &&
            (!m.lastSyncAt ||
              Date.parse(m.lastSyncAt) < this.clock().getTime() - 120000))
        ) {
          e.blockedReason =
            "Follow-ups paused: inbox synchronization is unhealthy or stale";
          continue;
        }
        if (s.suppressions.some((x) => x.id === e.normalizedEmail)) {
          stop(s, e, "suppressed", "worker", now);
          continue;
        }
        const adjusted = businessTime(now, e.timing);
        if (adjusted > now) {
          j.dueAt = adjusted;
          e.nextAt = adjusted;
          continue;
        }
        if (
          s.jobs.some(
            (x) =>
              x.id !== j.id &&
              ["claimed", "dispatching", "uncertain"].includes(x.state) &&
              s.enrollments.find((y) => y.id === x.enrollmentId)?.mailboxId ===
                m.id,
          )
        )
          continue;
        const day = dayKey(now, "Asia/Kolkata");
        const count = s.jobs.filter(
          (x) =>
            x.slotReserved &&
            x.dayKey === day &&
            s.enrollments.find((y) => y.id === x.enrollmentId)?.mailboxId ===
              m.id,
        ).length;
        if (count >= m.dailyLimit) {
          const tomorrow = new Date(
            this.clock().getTime() + 86400000,
          ).toISOString();
          j.dueAt = businessTime(tomorrow, e.timing);
          e.nextAt = j.dueAt;
          e.blockedReason = "Mailbox daily limit reached";
          continue;
        }
        e.blockedReason = undefined;
        j.state = "claimed";
        j.attempts++;
        j.leaseId = id();
        j.leaseUntil = new Date(this.clock().getTime() + 120000).toISOString();
        return structuredClone(j);
      }
      return null;
    });
  }
  async dispatch(job: Job) {
    let phase: "prepare" | "send" = "prepare";
    try {
      let state = await this.store.read();
      let e = state.enrollments.find((e) => e.id === job.enrollmentId)!;
      let m = state.mailboxes.find((m) => m.id === e.mailboxId)!;
      const contact = await this.crm.contact(e.ownerId, e.leadId, e.pocId);
      if (normalizeEmail(contact.email) !== e.normalizedEmail) {
        await this.store.change((s) => {
          const row = s.enrollments.find((x) => x.id === e.id)!;
          stop(
            s,
            row,
            "recipient_changed_review_required",
            "worker",
            this.now(),
          );
        });
        return;
      }
      const prepared = job.providerId
        ? {
            id: job.providerId,
            conversationId: job.conversationId,
            internetMessageId: job.internetMessageId,
          }
        : await this.provider.prepare(e, job, m);
      const freshContact=await this.crm.contact(e.ownerId,e.leadId,e.pocId);
      if(normalizeEmail(freshContact.email)!==e.normalizedEmail){await this.store.change(s=>stop(s,s.enrollments.find(x=>x.id===e.id)!,'recipient_changed_review_required','worker',this.now()));return;}
      // Provider draft identity is durable before the dispatch fence. This transaction is the
      // stop/send linearization point. A stop committed afterwards cannot recall this request.
      const allowed = await this.store.change((s) => {
        const j = s.jobs.find((x) => x.id === job.id)!;
        const row = s.enrollments.find((x) => x.id === job.enrollmentId)!;
        const box = s.mailboxes.find((x) => x.id === row.mailboxId)!;
        const campaign = s.campaigns.find((x) => x.id === row.sequenceId)!;
        if (
          j.state !== "claimed" ||
          j.leaseId !== job.leaseId ||
          j.leaseUntil! <= this.now()
        )
          return false;
        j.providerId = prepared.id;
        j.conversationId = prepared.conversationId;
        j.internetMessageId = prepared.internetMessageId;
        if (
          row.status !== "Active" ||
          row.generation !== j.generation ||
          campaign.status !== "Active" ||
          s.settings[0].emergencyStop ||
          s.suppressions.some((x) => x.id === row.normalizedEmail)
        ) {
          j.state = "cancelled";
          return false;
        }
        if (
          box.health !== "healthy" ||
          (box.provider === "graph" &&
            (!box.lastSyncAt ||
              Date.parse(box.lastSyncAt) < this.clock().getTime() - 120000))
        ) {
          j.state = "pending";
          row.blockedReason =
            "Inbox synchronization must succeed before dispatch";
          return false;
        }
        if (j.step !== row.sent || !row.drafts[j.step]?.approved) {
          j.state = "failed";
          row.status = "Failed";
          row.stopReason = "draft_not_approved";
          event(s, row, "sequence.failed", this.now());
          return false;
        }
        const proofId=row.drafts[j.step].caseStudyId;
        if(proofId&&!s.cases.some(c=>c.id===proofId&&c.permission)){j.state='pending';row.blockedReason='Case study permission is no longer valid';return false;}
        const eligible=currentEvidence(row.research,this.clock());
        if(row.drafts[j.step].evidenceIds.some(sourceId=>!eligible.some(ev=>ev.id===sourceId))){
          pause(s,row,'worker');row.blockedReason='Supporting evidence expired or changed. Refresh research and re-review the remaining drafts.';return false;
        }
        const day = dayKey(this.now(), "Asia/Kolkata");
        const used = s.jobs.filter(
          (x) =>
            x.slotReserved &&
            x.dayKey === day &&
            s.enrollments.find((y) => y.id === x.enrollmentId)?.mailboxId ===
              box.id,
        ).length;
        if (used >= box.dailyLimit) {
          j.state = "pending";
          j.dueAt = businessTime(
            new Date(this.clock().getTime() + 86400000).toISOString(),
            row.timing,
          );
          row.nextAt = j.dueAt;
          return false;
        }
        j.state = "dispatching";
        j.content={subject:('subject' in prepared&&typeof prepared.subject==='string')?prepared.subject:row.drafts[j.step].subject,body:row.drafts[j.step].body,evidence:structuredClone(row.research.evidence.filter(ev=>row.drafts[j.step].evidenceIds.includes(ev.id))),caseStudy:structuredClone(s.cases.find(c=>c.id===proofId))};
        j.slotReserved = true;
        j.dayKey = day;
        j.leaseUntil = new Date(this.clock().getTime() + 120000).toISOString();
        return true;
      });
      if (!allowed) return;
      phase = "send";
      await this.provider.send(prepared.id, m);
      await this.submitted(job.id, prepared);
    } catch (error) {
      const p = error as ProviderError;
      await this.store.change((s) => {
        const j = s.jobs.find((x) => x.id === job.id)!;
        const e = s.enrollments.find((x) => x.id === job.enrollmentId)!;
        if (j.state === "submitted" || j.leaseId !== job.leaseId) return;
        if (j.state === "cancelled") return;
        const uncertain =
          p.uncertain ||
          (phase === "send" && !(error instanceof ProviderError));
        j.error = uncertain
          ? "Provider acceptance is uncertain; reconciliation required"
          : p.reconnect
            ? "Reconnect mailbox"
            : p.retryMs
              ? "Provider request deferred"
              : "Dispatch failed; review required";
        if (uncertain) {
          j.state = "uncertain";
          e.holdEmail = true;
          if (e.status === "Active") {
            e.status = "Failed";
            e.stopReason = "uncertain_send";
          }
          e.nextAt = undefined;
          event(s, e, "send.uncertain", this.now());
          return;
        }
        j.slotReserved = false;
        if (p.reconnect) {
          const box = s.mailboxes.find((m) => m.id === e.mailboxId)!;
          box.health = "reconnect";
        }
        if (
          j.attempts < 5 &&
          e.status === "Active" &&
          e.generation === j.generation &&
          (p.retryMs || phase === "prepare")
        ) {
          j.state = "pending";
          j.dueAt = businessTime(
            new Date(
              this.clock().getTime() +
                Math.max(p.retryMs || 0, 1000 * 2 ** j.attempts),
            ).toISOString(),
            e.timing,
          );
          e.nextAt = j.dueAt;
        } else {
          j.state = "failed";
          if (e.status === "Active") {
            e.status = "Failed";
            e.stopReason = "provider_failure";
            e.nextAt = undefined;
          }
          event(s, e, "sequence.failed", this.now());
        }
      });
    }
  }
  async submitted(
    jobId: string,
    ids?: { conversationId?: string; internetMessageId?: string },
  ) {
    await this.store.change((s) => {
      const j = s.jobs.find((x) => x.id === jobId)!;
      if (j.state === "submitted") return;
      const e = s.enrollments.find((x) => x.id === j.enrollmentId)!;
      j.state = "submitted";
      j.submittedAt = this.now();
      j.conversationId = ids?.conversationId || j.conversationId;
      j.internetMessageId = ids?.internetMessageId || j.internetMessageId;
      e.sent = Math.max(e.sent, j.step + 1);
      e.lastSentAt = this.now();
      e.conversationId = j.conversationId;
      if (e.status === "Failed" && e.stopReason === "uncertain_send") {
        e.status = "Paused";
        e.stopReason = "reconciled_send_requires_resume";
      }
      if (["Stopped", "Replied"].includes(e.status)) e.holdEmail = false;
      if (e.status === "Active") {
        if (e.sent === 5) {
          e.status = "Completed";
          e.nextAt = undefined;
          e.holdEmail = false;
        } else queueNext(s, e);
      }
      event(s, e, "email.submitted", this.now());
      if (e.status === "Completed")
        event(s, e, "sequence.completed", this.now());
    });
  }
  async recover() {
    const now = this.now();
    await this.store.change((s) => {
      for (const j of s.jobs) {
        if (j.leaseUntil && j.leaseUntil <= now) {
          if (j.state === "claimed") {
            const e = s.enrollments.find((x) => x.id === j.enrollmentId)!;
            j.state =
              e.status === "Active" && e.generation === j.generation
                ? "pending"
                : "cancelled";
          } else if (j.state === "dispatching") {
            j.state = "uncertain";
            const e = s.enrollments.find((x) => x.id === j.enrollmentId)!;
            e.holdEmail = true;
            if (e.status === "Active") {
              e.status = "Failed";
              e.stopReason = "uncertain_send";
              e.nextAt = undefined;
            }
            event(s, e, "send.uncertain", now);
          }
        }
      }
    });
    const s = await this.store.read();
    for (const j of s.jobs.filter(
      (j) => j.state === "uncertain" && j.providerId,
    )) {
      const e = s.enrollments.find((x) => x.id === j.enrollmentId)!;
      const m = s.mailboxes.find((x) => x.id === e.mailboxId)!;
      try {
        const observed = await this.provider.inspect(j.providerId!, m);
        if (observed.submitted) await this.submitted(j.id, observed);
      } catch {
        /* Never blindly resend an uncertain message. */
      }
    }
  }
  async syncOutbox() {
    const s = await this.store.read();
    for (const evt of s.events
      .filter((e) => e.state === "pending" && e.nextAttemptAt <= this.now())
      .slice(0, 100)) {
      try {
        await this.crm.sync(evt);
        await this.store.change((s) => {
          const row = s.events.find((e) => e.id === evt.id)!;
          row.state = "synced";
          row.error = undefined;
        });
      } catch {
        await this.store.change((s) => {
          const row = s.events.find((e) => e.id === evt.id)!;
          row.attempts++;
          row.error = "CRM status update failed";
          row.state = row.attempts >= 10 ? "failed" : "pending";
          row.nextAttemptAt = new Date(
            this.clock().getTime() +
              Math.min(3600000, 1000 * 2 ** row.attempts),
          ).toISOString();
        });
      }
    }
  }
}
