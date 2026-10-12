# Repository assessment and implementation decisions

Inspected on 11 October 2026. CRM backend: `JTSTBP/newcrm-backend`, base commit `331b1f8` (`ugu`). No AGENTS.md or README instructions were found. No third-party starter repository was adopted. The supplied repository declares ISC; the integration does not redistribute its dependencies, uploads, environment or built frontend.

Verified from current source:

| Capability | Evidence |
|---|---|
| Node / Express 5, MongoDB / Mongoose | package.json, index.js |
| JWT, `x-auth-token`, active users, Admin / Manager / BD Executive | middleware/authMiddleware.js, routes/authRoutes.js, models/User.js |
| Lead ownership includes assignedBy, createdBy and assignedTo; managers include direct reports | routes/emailLeadRoutes.js |
| Company leads and multiple points of contact | models/Lead.js; separate EmailLead schema in routes/emailLeadRoutes.js |
| Gemini generation at `/api/email-leads/generate-ai-email` | routes/emailLeadRoutes.js, utils/aiEmailService.js, services/aiEmail/emailGenerator.js |
| SMTP and Resend | routes/emailLeadRoutes.js |
| Daily slot reservations and send history | services/emailDailyLimitService.js, models/EmailSendLog.js |

The current AI route is a single-email generator with its own formatting and CRM concerns. Calling it for each follow-up would repeat work and would not supply an immutable five-draft review workflow. The separate application reuses the existing provider choice, data mappings, role policy, source-based prompt principles and daily-slot reservation approach. It implements a separate structured Gemini adapter rather than copying the CRM prompt wholesale: the new instructions require five concise emails and prohibit several assumptions permitted by the older prompt. Existing CRM email routes remain intact.

The CRM has hiring-needs strings but no structured publication dates or complete source-evidence model. Optional `outreach_hiring_sources` arrays are added to both lead schemas. Legacy data does not become verified hiring evidence automatically. Contact snapshots retain CRM IDs, company/role context and source links needed for approved sequences.

Implementation order completed: isolated branches; separate TypeScript application; transactional Mongo storage and worker; mock CRM/AI/mail provider; React review interface; signed CRM APIs; Graph OAuth and monitoring; safety and API tests; Docker and deployment documentation.

React 19 + Vite is a provisional independent UI choice. The actual CRM frontend repository was not provided, so its source architecture has not been assessed. The backend repository's compiled dist is not treated as a substitute for frontend source. A mock CRM contact screen and a portable React stop-control example are included for the handoff.

Branches: application `codex/email-outreach`; CRM `codex/outreach-integration`. No push, production deployment, live CRM queries or real email sends were performed. The CRM repository's environment file was not loaded or used.
