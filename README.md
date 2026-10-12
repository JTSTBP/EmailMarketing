# Jobs Territory Outreach

A separate TypeScript email outreach application with a React review studio, MongoDB-backed sequence worker, CRM adapter and Microsoft Graph integration. Real sending is disabled by default.

## Run locally

Node.js 24 LTS is recommended. No credentials or Docker are needed for the mock workspace:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The first run downloads the official MongoDB binary through mongodb-memory-server (about 600 MB on Windows). It starts a single-node replica set on port 27019 and stores data in `.local/mongo`; stopping/restarting the app preserves it. API: 4100. The default contacts and mailbox are fictional. If a package manager blocks install scripts, approve only the published esbuild/mongodb-memory-server installation steps or use Docker instead.

Try **CRM contacts → select a contact → Add to campaign → Generate five emails → review/edit → Mark all reviewed → Start sequence**. In Draft studio, **Run next mock step** advances the worker to the actual scheduled time. Simulate a reply, out-of-office, bounce, unsubscribe or unrelated email. Inspect history and the audit trail. No real email is sent. For live integration, use a fresh database so demo and real records never mix.

## Docker local setup

```sh
docker compose up --build
```

Open **http://localhost:4100**. Compose runs the built UI/API, a separate worker and persistent replica-set MongoDB. Mongo is not published to the host; the app is bound to host loopback. Compose deliberately hardcodes mock mode and disables real sending. `docker compose down` keeps data; deleting the volume removes it. Docker was unavailable on the development machine, so container execution still needs verification.

## Validate

```sh
npm run check
npm test
npm run build
npm audit --omit=dev
```

Tests use mock providers plus an isolated real Mongo replica set. They never use live CRM data or Microsoft credentials. See [test results and limitations](docs/TEST-RESULTS.md).

## Deployment and integration

- [Repository assessment](docs/ASSESSMENT.md)
- [Architecture, failure handling and stop race](docs/ARCHITECTURE.md)
- [Deployment and exact remaining inputs](docs/DEPLOYMENT.md)
- [CRM backend and frontend handoff](docs/CRM-INTEGRATION.md)
- [Microsoft 365 setup and live acceptance tests](docs/MICROSOFT-365.md)

The source CRM checkout is in `crm-backend/` on `codex/outreach-integration`. It is excluded from this application's Git history. The reviewable integration patch is in `integrations/crm-backend.patch`; apply it to the documented base revision. Existing CRM generation/sending routes are preserved. CRM integration changes have not been deployed.

This is a functioning local pilot with implemented live adapters, not a production-verification claim. Microsoft sign-in and explicitly authorised individual test sends have been exercised locally. Automated live sequence sending, threading, deliverability and deployed CRM integration still require acceptance testing. See the deployment guide before configuring live mode.

## Optional local Microsoft connection test

Use `http://localhost:5173` and register the Web callback `http://localhost:4100/api/oauth/callback`. In a private `.env`, set `LOCAL_MICROSOFT_TEST=true`, the `MS_*` credentials, and a persistent `TOKEN_ENCRYPTION_KEY` containing 32 random bytes encoded as base64. Keep `APP_MODE=mock` and `ENABLE_LIVE_SENDING=false`. Local connection testing does not enable real sequence sending. The local worker checks replies to recorded manual tests every 60 seconds; Replies also provides a manual check. Manual test records are shown in Email history. A test can explicitly reference an enrollment to stop that sequence on a reply. Private development scripts, credentials, contacts and database files are excluded from Git.
