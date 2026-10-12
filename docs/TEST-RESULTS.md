# Local verification — 11 October 2026

`npm run build` passed: TypeScript validation and Vite production build. `npm audit --omit=dev` reported zero vulnerabilities at the time of installation/check.

**Final result: 38 tests passed, 0 failed, 0 skipped.** The automated suite uses deterministic mock AI/CRM/email providers, mocked Microsoft HTTP responses, isolated MongoDB replica sets and actual CRM model/route code. It covers five-step order, schedule windows/weekends/DST, stop/dispatch races, reply and automatic-response stopping, unrelated sender messages, bounces/unsubscribes, suppression, duplicate jobs/notifications, concurrent claims, restart recovery, uncertain outcomes, quotas, OAuth refresh/reconnect, throttling, inbox failures, ownership, signed service requests/replay, monotonic CRM events, draft validation and individual regeneration/version history.

The API integration test performs enrollment, five-draft generation, edit/approval, explicit Start, mock submission and automatic-reply stopping against real Mongo transactions. It verifies restart persistence and indexes. CRM adapter tests use a separate fabricated database and the cloned backend's current Mongoose models; no existing CRM database is used.

The local UI and API returned HTTP 200. Browser inspection verified the responsive dashboard, CRM selection and five generated recipient-specific drafts with source limitations and word counts. A final browser interaction was unavailable after the browser binding disconnected; the complete start/reply workflow is verified through HTTP integration tests rather than claimed as a completed browser test.

Docker was not installed, so Docker execution is unverified. Microsoft 365 tenant OAuth/consent, real threading, subscriptions, deliverability and real CRM synchronization are not live-verified. No real messages were sent, no production deployment was performed, and the supplied MongoDB credentials were not used to connect. See MICROSOFT-365.md for the live acceptance checklist and DEPLOYMENT.md for remaining inputs.

