import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import path from "node:path";
import type { Store } from "./store";
import type { CRM } from "./crm";
import { crmRequest } from "./crm";
import type { User, Contact, Enrollment, Evidence } from "./types";
import { config } from "./config";
import {
  AppError,
  assert,
  id,
  equal,
  sign,
  seal,
  normalizeEmail,
  htmlPreview,
  unseal,
} from "./security";
import {
  audit,
  canAccess,
  createCampaign,
  enroll,
  event,
  getEnrollment,
  pause,
  receive,
  saveDrafts,
  start,
  stop,
} from "./domain";
import { generate, draftSchema, currentEvidence } from "./ai";
import { timingSchema, planned } from "./schedule";
import { collectSource } from "./research";
import { analyzeResearch } from "./research-ai";
import { beginOAuth, finishOAuth } from "./graph";
import { syncLocalTestReplies } from "./local-test-replies";
import { demoUser } from "./seed";
import type { Worker } from "./worker";
const str = z.string().trim().min(1).max(500);
const safeURL = z.url().refine((v) => /^https?:\/\//.test(v));
const evidenceSchema = z
  .object({
    url: safeURL,
    publishedAt: z.iso.datetime().optional(),
    summary: z.string().trim().min(15).max(3500),
    kind: z.enum([
      "company",
      "employment",
      "hiring",
      "post",
      "market",
      "competitor",
    ]),
    verified: z.boolean(),
  })
  .strict();
function cookie(req: express.Request) {
  return (
    /(?:^|;\s*)jt_session=([^;]+)/.exec(req.headers.cookie || "")?.[1] || ""
  );
}
export function createApp(store: Store, crm: CRM, worker: Worker) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:"],
          "frame-src": ["'self'"],
        },
      },
    }),
  );
  app.use(
    express.json({
      limit: "128kb",
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString();
      },
    }),
  );
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, mode: config.mode, liveSending: config.liveSending }),
  );
  app.post("/api/graph/notifications", async (req, res) => {
    if (typeof req.query.validationToken === "string") {
      res.type("text/plain").send(req.query.validationToken);
      return;
    }
    const data = z
      .object({
        value: z
          .array(
            z
              .object({
                subscriptionId: str,
                clientState: str,
                resourceData: z.object({ id: str }).optional(),
                lifecycleEvent: z.string().optional(),
              })
              .passthrough(),
          )
          .max(1000),
      })
      .parse(req.body);
    await store.change((s) => {
      for (const n of data.value) {
        const m = s.mailboxes.find(
          (x) => x.subscriptionId === n.subscriptionId,
        );
        assert(
          m?.clientState && equal(n.clientState, unseal(m.clientState)),
          "Invalid Graph client state",
          403,
        );
        if (n.resourceData) {
          m.pendingMessageIds = Array.from(
            new Set([...(m.pendingMessageIds || []), n.resourceData.id]),
          );
        }
        if (n.lifecycleEvent) {
          m.health = "unhealthy";
          m.error = "Microsoft subscription lifecycle requires reconciliation";
          if (n.lifecycleEvent === "subscriptionRemoved") {
            m.subscriptionId = undefined;
            m.subscriptionExpiresAt = undefined;
          } else m.subscriptionExpiresAt = new Date().toISOString();
        }
        m.syncRequested = true;
      }
    });
    res.sendStatus(202);
  });
  app.post("/api/integration/stop", async (req, res) => {
    assert(
      config.mode === "live" && config.crmSecret.length >= 32,
      "Integration is not enabled",
      403,
    );
    const timestamp = String(req.headers["x-outreach-timestamp"] || ""),
      nonce = String(req.headers["x-outreach-nonce"] || ""),
      signature = String(req.headers["x-outreach-signature"] || "");
    assert(
      Math.abs(Date.now() - Number(timestamp)) < 300000 && nonce.length >= 16,
      "Expired integration request",
      401,
    );
    assert(
      equal(
        signature,
        sign(
          "POST",
          "/api/integration/stop",
          timestamp,
          nonce,
          (req as any).rawBody || "",
        ),
      ),
      "Invalid integration signature",
      401,
    );
    const input = z
      .object({
        actorId: str,
        leadId: str,
        pocId: str.optional(),
        reason: str.default("crm_stop"),
      })
      .strict()
      .parse(req.body);
    const u = (await crmRequest(
      "/api/outreach/actor",
      "GET",
      undefined,
      input.actorId,
    )) as User;
    const contacts = (await crm.contacts(u)).filter(
      (c) =>
        c.leadId === input.leadId && (!input.pocId || c.pocId === input.pocId),
    );
    assert(contacts.length, "Contact is outside your CRM scope", 403);
    const result = await store.change((s) => {
      if (s.receipts.some((x) => x.id === nonce)) return { duplicate: true };
      s.receipts.push({ id: nonce, at: new Date().toISOString() });
      const rows = s.enrollments.filter((e) =>
        contacts.some((c) => c.leadId === e.leadId && c.pocId === e.pocId),
      );
      for (const e of rows) stop(s, e, input.reason, u.id);
      return {
        status: "Stopped",
        sequences: rows.map((e) => ({
          id: e.id,
          status: e.status,
          sent: e.sent,
          stopReason: e.stopReason,
        })),
        notice: "An email already submitted to Microsoft cannot be recalled.",
      };
    });
    res.json(result);
  });
  app.post(
    "/api/login",
    rateLimit({ windowMs: 900000, limit: 10 }),
    async (req, res) => {
      assert(config.mode === "live", "Use the local demo session");
      const input = z
        .object({
          email: z.email(),
          password: z.string().min(1).max(500),
          loginType: z.enum(["admin", "agent"]),
        })
        .strict()
        .parse(req.body);
      const response = await fetch(`${config.crmUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15000),
      });
      assert(response.ok, "CRM login failed", 401);
      const auth: any = await response.json();
      const profileResponse = await fetch(`${config.crmUrl}/api/outreach/me`, {
        headers: { "x-auth-token": auth.token },
        signal: AbortSignal.timeout(15000),
      });
      assert(
        profileResponse.ok,
        "CRM outreach integration is unavailable",
        401,
      );
      const user = (await profileResponse.json()) as User;
      const sessionId = id();
      await store.change((s) => {
        s.sessions.push({
          id: sessionId,
          user,
          expiresAt: new Date(Date.now() + 8 * 3600000).toISOString(),
          crmToken: seal(auth.token),
        });
      });
      res
        .cookie("jt_session", sessionId, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          maxAge: 8 * 3600000,
          path: "/",
        })
        .json({ ok: true });
    },
  );
  app.get("/api/oauth/callback", async (req, res) => {
    assert(
      typeof req.query.state === "string" && typeof req.query.code === "string",
      "Microsoft connection was not completed",
    );
    await finishOAuth(store, req.query.state, req.query.code, cookie(req));
    res.redirect(`${config.origin}/?connected=1`);
  });
  app.use("/api", async (req, res, next) => {
    if (!["GET", "HEAD"].includes(req.method)) {
      assert(
        req.headers["x-jt-request"] === "1",
        "Missing request protection header",
        403,
      );
      const origin = req.headers.origin;
      assert(
        !origin ||
          origin === config.origin ||
          (config.mode === "mock" &&
            [
              "http://127.0.0.1:4100",
              "http://localhost:4100",
              "http://localhost:5173",
              "http://127.0.0.1:5173",
            ].includes(origin)),
        "Origin is not allowed",
        403,
      );
    }
    if (config.mode === "mock") {
      res.locals.user = demoUser;
      res.locals.sessionId = "demo";
    } else {
      const session = (await store.read()).sessions.find(
        (x) => x.id === cookie(req) && Date.parse(x.expiresAt) > Date.now(),
      );
      assert(session, "Sign in with your CRM account", 401);
      res.locals.user = await crmRequest(
        "/api/outreach/actor",
        "GET",
        undefined,
        session.user.id,
      );
      res.locals.sessionId = session.id;
    }
    next();
  });
  const user = (res: express.Response) => res.locals.user as User;
  const admin = (res: express.Response) =>
    assert(user(res).role === "Admin", "Administrator access required", 403);
  const owned = async (res: express.Response, uid: string) => {
    const e = (await store.read()).enrollments.find(x=>x.id===uid);
    assert(e, "Sequence not found", 404);
    const c = await crm.contact(user(res).id, e.leadId, e.pocId);
    assert(canAccess(user(res), c), "Contact is outside your current CRM scope", 403);
    // Refresh ownership only. Recipient and approved personalization remain snapshots.
    await store.change(s=>{const row=s.enrollments.find(x=>x.id===uid)!;row.contact.owners=c.owners;});
    e.contact.owners=c.owners;
    return { e, c };
  };
  app.post("/api/logout", async (req, res) => {
    await store.change((s) => {
      s.sessions = s.sessions.filter((x) => x.id !== cookie(req));
    });
    res.clearCookie("jt_session").json({ ok: true });
  });
  app.get("/api/state", async (_req, res) => {
    const s = await store.read(),
      u = user(res);
    const contacts = await crm.contacts(u);
    const allowed = new Set(contacts.map((c) => `${c.leadId}:${c.pocId}`));
    const enrollments = s.enrollments.filter((e) =>
      allowed.has(`${e.leadId}:${e.pocId}`),
    );
    const ids = new Set(enrollments.map((e) => e.id));
    const mailboxIds = new Set(
      s.mailboxes
        .filter((m) => u.role === "Admin" || m.ownerId === u.id)
        .map((m) => m.id),
    );
    res.json({
      user: u,
      mode: config.mode,
      localMicrosoftTest: config.localMicrosoftTest,
      liveSending: config.liveSending,
      threadingVerified: config.threadingVerified,
      emergencyStop: s.settings[0].emergencyStop,
      contacts,
      enrollments: enrollments.map((e) => ({
        ...e,
        drafts: e.drafts.map((d) => ({
          ...d,
          html: htmlPreview(d.body),
          plannedAt: e.startAt
            ? planned(e.startAt, d.step, e.timing)
            : planned(new Date().toISOString(), d.step, e.timing),
        })),
      })),
      campaigns: s.campaigns.filter(
        (c) => u.role === "Admin" || c.ownerId === u.id,
      ),
      mailboxes: s.mailboxes
        .filter((m) => mailboxIds.has(m.id))
        .map(
          ({ tokens, clientState, deltaLinks, pendingMessageIds, ...m }) => m,
        ),
      incoming: s.incoming.filter(
        (m) => (m.enrollmentId && ids.has(m.enrollmentId)) || (m.manualTestId && mailboxIds.has(m.mailboxId)),
      ),
      jobs: s.jobs.filter((j) => ids.has(j.enrollmentId)),
      manualSends: store.manualSendHistory ? await store.manualSendHistory([...mailboxIds]) : [],
      events: s.events.filter((e) => ids.has(e.enrollmentId)),
      cases: s.cases,
      usage: s.usage.filter((x) => u.role === "Admin" || x.ownerId === u.id),
      audits: s.audits
        .filter(
          (a) => u.role === "Admin" || a.actor === u.id || ids.has(a.entityId),
        )
        .slice(-200)
        .reverse(),
      suppressions: u.role === "Admin" ? s.suppressions : [],
    });
  });
  app.post("/api/campaigns", async (req, res) => {
    const p = z
      .object({ name: str, mailboxId: str, timing: timingSchema })
      .strict()
      .parse(req.body);
    res.json(
      await store.change((s) =>
        createCampaign(s, user(res), p.name, p.mailboxId, p.timing),
      ),
    );
  });
  app.patch("/api/campaigns/:id", async (req, res) => {
    const p = z
      .object({
        name: str.optional(),
        mailboxId: str.optional(),
        timing: timingSchema.optional(),
        action: z.enum(["pause", "activate", "stop"]).optional(),
      })
      .strict()
      .parse(req.body);
    await store.change((s) => {
      const c = s.campaigns.find((c) => c.id === req.params.id);
      assert(
        c && (user(res).role === "Admin" || c.ownerId === user(res).id),
        "Campaign not found",
        404,
      );
      if (p.name) c.name = p.name;
      if (p.timing) c.timing = p.timing;
      if (p.mailboxId) {
        const m = s.mailboxes.find((m) => m.id === p.mailboxId);
        assert(
          m && (user(res).role === "Admin" || m.ownerId === user(res).id),
          "Mailbox unavailable",
        );
        c.mailboxId = p.mailboxId;
      }
      if (p.action) {
        assert(
          c.status !== "Stopped" || p.action === "stop",
          "Stopped campaigns do not restart; create a new campaign",
        );
        c.status =
          p.action === "activate"
            ? "Active"
            : p.action === "pause"
              ? "Paused"
              : "Stopped";
        for (const e of s.enrollments.filter((e) => e.sequenceId === c.id)) {
          if (p.action === "stop") stop(s, e, "campaign_stop", user(res).id);
          else if (p.action === "pause" && e.status === "Active")
            pause(s, e, user(res).id);
        }
      }
      audit(s, user(res).id, `campaign.${p.action || "edit"}`, c.id);
    });
    res.json({ ok: true });
  });
  app.post("/api/enroll", async (req, res) => {
    const p = z
      .object({
        campaignId: str,
        contacts: z
          .array(z.object({ leadId: str, pocId: str }).strict())
          .min(1)
          .max(50),
      })
      .strict()
      .parse(req.body);
    const contacts: Contact[] = [];
    for (const c of p.contacts)
      contacts.push(await crm.contact(user(res).id, c.leadId, c.pocId));
    const result = await store.change((s) =>
      contacts.map((c) => enroll(s, user(res), c, p.campaignId)),
    );
    res.json(result);
  });
  app.post(
    "/api/enrollments/:id/generate",
    rateLimit({ windowMs: 60000, limit: 10 }),
    async (req, res) => {
      const p = z
        .object({ step: z.number().int().min(0).max(4).optional() })
        .strict()
        .parse(req.body);
      const { e } = await owned(res, String(req.params.id));
      assert(
        ["Draft", "Ready", "Paused"].includes(e.status),
        "Pause before generating drafts",
      );
      const s = await store.read();
      const mailbox = s.mailboxes.find((m) => m.id === e.mailboxId)!;
      try {
        const result = await generate(e, s.cases, mailbox.name);
        await store.change(s=>{s.usage.push(result.usage);});
        await store.change((s) => {
          const latest = getEnrollment(s, user(res), e.id);
          assert(
            latest.revision === e.revision &&
              latest.research.updatedAt === e.research.updatedAt &&
              JSON.stringify(latest.drafts) === JSON.stringify(e.drafts),
            "Draft changed during generation; retry",
            409,
          );
          saveDrafts(s, user(res), latest, result.drafts, p.step);
        });
      } catch (error) {
        await store.change(s=>audit(s,user(res).id,'generate.failed',e.id));
        if ((error as any).usage)
          await store.change((s) => {
            s.usage.push((error as any).usage);
          });
        throw error;
      }
      res.json({ ok: true });
    },
  );
  app.patch("/api/enrollments/:id/drafts/:step", async (req, res) => {
    const p = z
      .object({
        subject: z.string(),
        body: z.string(),
        approve: z.boolean().default(false),
        version: z.number().int(),
      })
      .strict()
      .parse(req.body);
    const { e } = await owned(res, String(req.params.id));
    const step = Number(req.params.step);
    await store.change((s) => {
      const row = getEnrollment(s, user(res), e.id);
      assert(
        ["Draft", "Ready", "Paused"].includes(row.status) && step >= row.sent,
        "Pause before editing an unsent draft",
      );
      const d = row.drafts.find((d) => d.step === step);
      assert(d, "Draft not found");
      assert(
        d.version === p.version,
        "Draft changed. Refresh before editing.",
        409,
      );
      draftSchema.parse({
        step: d.step,
        subject: p.subject,
        body: p.body,
        evidenceIds: d.evidenceIds,
        personalization: d.personalization,
        caseStudyId: d.caseStudyId,
        limitations: d.limitations,
      });
    });
    await store.change((s) => {
      const row = getEnrollment(s, user(res), e.id);
      assert(
        ["Draft", "Ready", "Paused"].includes(row.status) && step >= row.sent,
        "Pause before editing",
      );
      const d = row.drafts.find((d) => d.step === step)!;
      assert(d.version === p.version, "Draft changed", 409);
      assert(
        p.body.includes("Jobs Territory"),
        "Use Jobs Territory consistently",
      );
      if (d.body !== p.body || d.subject !== p.subject) {
        d.history.push({
          subject: d.subject,
          body: d.body,
          version: d.version,
          at: new Date().toISOString(),
        });
        d.version++;
      }
      d.body = p.body;
      d.subject = p.subject;
      d.approved = p.approve;
      if (row.status !== "Paused")
        row.status =
          row.drafts.length === 5 && row.drafts.every((d) => d.approved)
            ? "Ready"
            : "Draft";
      audit(
        s,
        user(res).id,
        p.approve ? "draft.approve" : "draft.edit",
        row.id,
      );
    });
    res.json({ ok: true });
  });
  app.post("/api/enrollments/:id/action", async (req, res) => {
    const p = z
      .object({
        action: z.enum([
          "start",
          "restart",
          "pause",
          "stop",
          "approve",
          "reviewRecipient",
          "unsubscribe",
        ]),
        reason: z.string().max(500).optional(),
      })
      .strict()
      .parse(req.body);
    const { e, c } = await owned(res, String(req.params.id));
    await store.change((s) => {
      const row = getEnrollment(s, user(res), e.id);
      if (p.action === "start" || p.action === "restart")
        start(s, user(res), row, c, undefined, p.action === "restart");
      else if (p.action === "pause") pause(s, row, user(res).id);
      else if (p.action === "stop")
        stop(s, row, p.reason || "manual_stop", user(res).id);
      else if (p.action === "unsubscribe") {
        if (!s.suppressions.some((x) => x.id === row.normalizedEmail))
          s.suppressions.push({
            id: row.normalizedEmail,
            reason: "unsubscribe",
            at: new Date().toISOString(),
          });
        for (const target of s.enrollments.filter(
          (x) => x.normalizedEmail === row.normalizedEmail,
        ))
          stop(s, target, "unsubscribe", user(res).id);
      } else if (p.action === "approve") {
        assert(
          ["Draft", "Ready", "Paused"].includes(row.status) &&
            row.drafts.length === 5,
          "Generate all five drafts first",
        );
        for (const d of row.drafts) d.approved = true;
        if (row.status !== "Paused") row.status = "Ready";
        audit(s, user(res).id, "draft.approve_all", row.id);
      } else {
        assert(
          !["Active"].includes(row.status) &&
            !s.jobs.some(
              (j) =>
                j.enrollmentId === row.id &&
                ["claimed", "dispatching", "uncertain"].includes(j.state),
            ),
          "Stop and reconcile outstanding sends first",
        );
        assert(
          !s.suppressions.some((x) => x.id === normalizeEmail(c.email)),
          "New recipient is suppressed",
        );
        assert(
          row.sent === 0,
          "Create a new campaign to use a changed address after a submission",
        );
        row.contact = c;
        row.normalizedEmail = normalizeEmail(c.email);
        row.drafts.filter(d=>d.step>=row.sent).forEach((d) => (d.approved = false));
        if(row.status!=="Paused")row.status = "Draft";
        row.stopReason = null;
        row.holdEmail = false;
        row.generation++;
        audit(s, user(res).id, "recipient.review", row.id);
      }
    });
    res.json({
      ok: true,
      notice: "Emails already submitted to Microsoft cannot be recalled.",
    });
  });
  app.post("/api/company/:id/stop", async (req, res) => {
    const contacts = (await crm.contacts(user(res))).filter(
      (c) => c.leadId === req.params.id,
    );
    assert(contacts.length, "Company is outside your CRM scope", 403);
    await store.change((s) => {
      for (const e of s.enrollments.filter((e) =>
        contacts.some((c) => c.leadId === e.leadId && c.pocId === e.pocId),
      ))
        stop(s, e, "company_stop", user(res).id);
    });
    res.json({ status: "Stopped" });
  });
  app.post("/api/enrollments/:id/research", async (req, res) => {
    const p = z
      .object({
        url: safeURL.optional(),
        evidence: evidenceSchema.optional(),
        refresh: z.boolean().optional(),
        hypotheses: z.array(z.string().max(500)).max(10).optional(),
      })
      .strict()
      .parse(req.body);
    const { e } = await owned(res, String(req.params.id));
    assert(
      ["Draft", "Ready", "Paused"].includes(e.status),
      "Pause before changing research",
    );
    let evidence: Evidence | undefined = p.evidence
      ? { ...p.evidence, id: id(), researchedAt: new Date().toISOString() }
      : undefined;
    if (p.url) {
      const cached = (await store.read()).research
        .filter((r) => r.contactId === e.contact.id)
        .flatMap((r) => r.evidence)
        .find(
          (v) =>
            v.url === p.url &&
            Date.parse(v.researchedAt) > Date.now() - 7 * 86400000,
        );
      evidence =
        cached && !p.refresh ? cached : await collectSource(p.url, "company");
    }
    await store.change((s) => {
      const row = getEnrollment(s, user(res), e.id);
      assert(
        ["Draft", "Ready", "Paused"].includes(row.status),
        "Sequence changed during research",
        409,
      );
      if (evidence) {
        row.research.evidence = row.research.evidence.filter(
          (x) => x.url !== evidence!.url,
        );
        row.research.evidence.push(evidence);
      }
      if (p.hypotheses) row.research.hypotheses = p.hypotheses;
      row.research.updatedAt = new Date().toISOString();
      row.research.limitations = currentEvidence(row.research).some(
        (e) => e.kind === "hiring",
      )
        ? [
            "Review source accuracy and current employment before approving drafts.",
          ]
        : [
            "No verified hiring publication in the last 30 days; use general partnership outreach.",
            "LinkedIn restricted pages are not accessed; pasted information needs verification.",
          ];
      row.drafts.filter(d=>d.step>=row.sent).forEach((d) => (d.approved = false));
      if(row.status!=="Paused")row.status = "Draft";
      s.research = s.research.filter((r) => r.contactId !== row.contact.id);
      s.research.push(structuredClone(row.research));
      audit(s, user(res).id, "research.update", row.id);
    });
    res.json({ ok: true });
  });
  app.post(
    "/api/enrollments/:id/research/analyze",
    rateLimit({ windowMs: 60000, limit: 10 }),
    async (req, res) => {
      const { e } = await owned(res, String(req.params.id));
      assert(
        ["Draft", "Ready", "Paused"].includes(e.status),
        "Pause before analyzing research",
      );
      try {
        const { result, usage } = await analyzeResearch(e);
        await store.change(s=>{s.usage.push(usage);});
        await store.change((s) => {
          const row = getEnrollment(s, user(res), e.id);
          assert(
            ["Draft", "Ready", "Paused"].includes(row.status) &&
              row.research.updatedAt === e.research.updatedAt,
            "Research changed during analysis; retry",
            409,
          );
          const observations = result.observations.map((x) => ({
            ...e.research.evidence.find((ev) => ev.id === x.sourceId)!,
            id: id(),
            kind: x.kind,
            summary: x.summary,
            verified: false,
          }));
          row.research.evidence = observations;
          row.research.hypotheses = result.hypotheses;
          row.research.limitations = result.limitations;
          row.research.updatedAt = new Date().toISOString();
          row.drafts.filter(d=>d.step>=row.sent).forEach((d) => (d.approved = false));
          if(row.status!=="Paused")row.status = "Draft";
          s.research = s.research.filter((r) => r.contactId !== row.contact.id);
          s.research.push(structuredClone(row.research));
          audit(s, user(res).id, "research.analyze", row.id);
        });
      } catch (error) {
        if ((error as any).usage)
          await store.change((s) => {
            s.usage.push((error as any).usage);
          });
        throw error;
      }
      res.json({ ok: true });
    },
  );
  app.post(
    "/api/enrollments/:id/research/:evidenceId/verify",
    async (req, res) => {
      await owned(res, String(req.params.id));
      const p = z.object({ verified: z.boolean() }).strict().parse(req.body);
      await store.change((s) => {
        const e = getEnrollment(s, user(res), String(req.params.id));
        assert(
          ["Draft", "Ready", "Paused"].includes(e.status),
          "Pause before verifying research",
        );
        const ev = e.research.evidence.find(
          (x) => x.id === req.params.evidenceId,
        );
        assert(ev, "Source not found", 404);
        ev.verified = p.verified;
        e.drafts.filter(d=>d.step>=e.sent).forEach((d) => (d.approved = false));
        if(e.status!=="Paused")e.status = "Draft";
        e.research.updatedAt = new Date().toISOString();
        audit(s, user(res).id, "research.verify", e.id);
      });
      res.json({ ok: true });
    },
  );
  app.post("/api/emergency", async (req, res) => {
    admin(res);
    const p = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    await store.change((s) => {
      s.settings[0].emergencyStop = p.enabled;
      if (p.enabled)
        for (const e of s.enrollments.filter((e) => e.status === "Active"))
          pause(s, e, user(res).id);
      audit(
        s,
        user(res).id,
        "global.emergency_stop",
        "global",
        undefined,
        String(p.enabled),
      );
    });
    res.json({ ok: true });
  });
  app.post("/api/local-test/sync-replies", async (_req, res) => {
    const u = user(res);
    const ids = (await store.read()).mailboxes.filter(m => u.role === "Admin" || m.ownerId === u.id).map(m => m.id);
    res.json(await syncLocalTestReplies(store, ids));
  });
  app.post("/api/mailboxes/connect", async (_req, res) => {
    const sessionId = config.localMicrosoftTest ? id() : res.locals.sessionId;
    const url = await beginOAuth(store, user(res).id, sessionId);
    if (config.localMicrosoftTest) res.cookie("jt_session", sessionId, {
      httpOnly: true, secure: false, sameSite: "lax", maxAge: 600000, path: "/",
    });
    res.json({ url });
  });
  app.patch("/api/mailboxes/:id", async (req, res) => {
    const p = z
      .object({
        dailyLimit: z.number().int().min(1).max(500).optional(),
        sync: z.boolean().optional(),
        health: z.enum(["healthy", "unhealthy"]).optional(),
      })
      .strict()
      .parse(req.body);
    await store.change((s) => {
      const m = s.mailboxes.find((m) => m.id === req.params.id);
      assert(
        m && (user(res).role === "Admin" || m.ownerId === user(res).id),
        "Mailbox unavailable",
        404,
      );
      if (p.dailyLimit) m.dailyLimit = p.dailyLimit;
      if (p.sync) {
        m.syncRequested = true;
        m.retryAt = undefined;
      }
      if (p.health) {
        assert(
          config.mode === "mock",
          "Health simulation is only available in mock mode",
        );
        m.health = p.health;
        m.lastSyncAt = new Date().toISOString();
      }
      audit(s, user(res).id, "mailbox.update", m.id);
    });
    res.json({ ok: true });
  });
  app.post("/api/cases", async (req, res) => {
    admin(res);
    const p = z
      .object({
        id: str.optional(),
        client: str,
        industry: str,
        roles: str,
        result: str,
        permission: z.boolean(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await store.change((s) => {
        const row = { ...p, id: p.id || id() };
        const existing = s.cases.find((x) => x.id === row.id);
        if (existing) Object.assign(existing, row);
        else s.cases.push(row);
        if(!row.permission) for(const e of s.enrollments){
          if(e.drafts.some(d=>d.step>=e.sent&&d.caseStudyId===row.id)){
            if(e.status==='Active')pause(s,e,user(res).id);
            for(const d of e.drafts.filter(d=>d.step>=e.sent&&d.caseStudyId===row.id))d.approved=false;
            if(e.status==='Ready')e.status='Draft';
            e.blockedReason='Case study permission was revoked; revise the affected drafts.';
          }
        }
        audit(s, user(res).id, "case_study.save", row.id);
        return row;
      }),
    );
  });
  app.post("/api/sync/retry", async (_req, res) => {
    admin(res);
    await store.change((s) => {
      for (const e of s.events.filter((e) => e.state === "failed")) {
        e.state = "pending";
        e.attempts = 0;
        e.nextAttemptAt = new Date().toISOString();
      }
      for (const e of s.enrollments) event(s, e, "status.reconciliation");
      audit(s, user(res).id, "crm.reconcile", "global");
    });
    res.json({ ok: true });
  });
  app.post("/api/mock/incoming", async (req, res) => {
    assert(config.mode === "mock", "Mock endpoint disabled", 404);
    const p = z
      .object({
        enrollmentId: str,
        kind: z.enum([
          "reply",
          "automatic",
          "bounce",
          "unsubscribe",
          "unrelated",
        ]),
      })
      .strict()
      .parse(req.body);
    await store.change((s) => {
      const e = getEnrollment(s, user(res), p.enrollmentId);
      assert(e.conversationId, "Submit a mock email first");
      receive(s, {
        id: id(),
        providerId: id(),
        mailboxId: e.mailboxId,
        conversationId: p.kind === "unrelated" ? id() : e.conversationId,
        from: e.normalizedEmail,
        subject:
          p.kind === "automatic"
            ? "Automatic reply"
            : p.kind === "bounce"
              ? "Delivery status notification"
              : "Re: Recruitment support",
        body:
          p.kind === "automatic"
            ? "I am out of the office."
            : p.kind === "unsubscribe"
              ? "Please remove me from this outreach."
              : p.kind === "bounce"
                ? "This mailbox is unavailable."
                : "Thank you for reaching out. Let’s discuss next steps.",
        kind: p.kind === "unrelated" ? "reply" : p.kind,
        receivedAt: new Date().toISOString(),
      });
    });
    res.json({ ok: true });
  });
  app.post("/api/mock/run", async (req, res) => {
    assert(config.mode === "mock", "Mock endpoint disabled", 404);
    const p = z
      .object({ enrollmentId: str.optional() })
      .strict()
      .parse(req.body);
    if (p.enrollmentId) await worker.mockAdvance(p.enrollmentId);
    else await worker.tick();
    res.json({ ok: true });
  });
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: error.issues.map((x) => x.message).join("; ") });
        return;
      }
      res
        .status(error instanceof AppError ? error.status : 500)
        .json({
          error:
            error instanceof AppError
              ? error.message
              : "The operation failed. Check configuration or retry. No success was recorded.",
        });
    },
  );
  return app;
}

