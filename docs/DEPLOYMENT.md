# Deployment guide

Production deployment and real sending were not authorized or performed. All local work uses fictional records. Keep the following preparation separate from permission to use live contacts or send emails.

## Exact remaining inputs

1. CRM frontend repository URL/access and intended base branch, to replace the portable UI handoff with native components.
2. An authorized staging CRM HTTPS URL with the backend patch applied, staging test accounts/role assignments and fabricated staging contacts.
3. A dedicated shared CRM integration HMAC secret (32+ random characters), restricted to the outreach integration endpoints.
4. A Microsoft 365 business tenant, confidential web application client ID/secret, permitted test mailbox, consent and exact callback/webhook HTTPS URLs.
5. Explicit authorization for named real test recipients before live sending. Real Outlook threading and reply monitoring must be tested before general use.
6. Gemini API key and chosen current model. Optional verified input/output USD-per-million-token pricing; no cost is invented when unavailable.
7. Approved Jobs Territory client testimonials/case studies, result wording and permission to use. Until supplied, the proof library stays empty.
8. Authorized deployment host/domain, HTTPS termination, persistent replica-set MongoDB, backup/retention policy and a 32-byte token encryption key.

## Staging preparation

Use Node 24, `npm ci`, `npm run build`, and an authenticated MongoDB replica set with majority writes. API and worker must share the same database and encryption key. Run `npm run migrate` to create the additive indexes. The local Docker compose file intentionally has no production credentials, no Mongo host port and no live sending. Make a separate deployment configuration for staging/production; never publish the local mock auth mode.

Build the Dockerfile once and run the same image as API and worker:

- API command: `node --import tsx src/server.ts` (serves `dist` and `/api`).
- Worker command: `node --import tsx src/worker-main.ts`.
- Internal API port: 4100; put an HTTPS reverse proxy in front. Set HOST=0.0.0.0 inside a container only.
- Set APP_MODE=live and APP_ORIGIN to the exact HTTPS origin. Set all server secrets from a secret manager, not the image or frontend.
- Set ENABLE_LIVE_SENDING=false and GRAPH_THREADING_VERIFIED=false initially.
- Use the .env.example as a variable inventory. An empty pricing field means unavailable.

Generate the encryption key locally with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and save it securely. Do not paste it into chat, commit it, or log it. For key rotation, decrypt/re-encrypt stored mailbox tokens and OAuth verifier values with both keys available during a controlled migration; blindly replacing the key makes credentials unreadable.

Configure the CRM's matching secret and HTTPS email-app URL, then connect an authorized staging mailbox through the UI. A publicly reachable HTTPS callback/webhook must route to this instance. The tenant is explicit; national-cloud endpoints and shared mailboxes are not implemented. Verify the checklist in MICROSOFT-365.md before changing send flags. Enable production flags only after the required explicit authorization and tests.

## Operational checks

`GET /api/health` exposes mode and send flag, not secrets. It is liveness, not a proof that Mongo, CRM or Microsoft is healthy. Use authenticated mailbox/CRM status and queue metrics for readiness. Run the worker under a supervisor with restart-on-failure. Graceful shutdown waits for the current worker cycle; abrupt termination recovers through leases and uncertain outcomes. Back up Mongo and encryption keys separately.

Use TLS and database authentication outside the local compose network. Restrict database/network access to API/worker. Terminate HTTPS before the API, keep credentials server-side and preserve same-origin requests. Configure reverse-proxy logs to omit OAuth code/state query parameters. The default in-process request rate limiter is per API process; use an ingress/shared limiter if adding replicas. Audit records and queue state are durable.

## Boundaries before production scale

The transition store serializes changes and reads the workspace across collections for correctness. This is suitable for a small reviewed pilot, not a load-tested large CRM rollout. Partition by tenant/mailbox and use targeted repository queries before large volumes. The contact adapter caps at 100 pages of 100 leads from each collection, and folder baseline scans at 500 pages each; limits fail explicitly. Initial mailbox sync can take time.

Retention/archiving is not scheduled automatically. Establish a policy for snapshots, matched reply previews, audit logs and old events. Suppression entries must survive archival. Database records are independent collections, avoiding a single-document size ceiling, but all-state reads still consume memory. Docker runtime, live CRM auth/ownership, tenant OAuth, consent policies, deliverability and actual follow-up threading remain verification items.

The existing CRM has its own package/dependency state. This project does not update it wholesale. Its tracked node_modules and environment file are excluded from the separate application and container build.
