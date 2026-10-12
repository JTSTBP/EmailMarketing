# CRM integration handoff

The CRM source checkout is on `codex/outreach-integration`, based on `331b1f8`. Its changes are packaged in `integrations/crm-backend.patch` and add:

- A standalone `routes/outreachRoutes.js` mounted at `/api/outreach`.
- Raw-body capture only for signed outreach requests.
- Optional `outreach_hiring_sources` arrays on Lead and EmailLead. Existing documents need no backfill and existing send/generation behavior is unchanged.
- Additive OutreachSequence and OutreachReceipt collections. Unique enrollment/nonce indexes; a ten-minute receipt TTL; lead status lookup index.

Apply the patch in an isolated CRM branch at the assessed revision (or review conflicts against a newer version):

```sh
git switch -c codex/outreach-integration
git apply --check /path/to/JTEMAIL/integrations/crm-backend.patch
git apply /path/to/JTEMAIL/integrations/crm-backend.patch
```

Configure only on the CRM server:

```dotenv
OUTREACH_API_URL=https://outreach.example.com
OUTREACH_INTEGRATION_SECRET=<same dedicated random secret as CRM_INTEGRATION_SECRET>
```

Configure `CRM_BASE_URL` on the email server to the CRM HTTPS origin. Use separate CRM staging and outreach staging databases for initial tests. Do not start the cloned CRM with its existing environment: use explicitly supplied staging configuration. The repository's tracked environment and uploads were not accessed for this work.

## API contract

| Endpoint | Authentication | Meaning |
|---|---|---|
| GET `/api/outreach/me` | Existing x-auth-token | Fresh active user and direct-report scope |
| GET `/api/outreach/actor` | Signed service request + signed actor | Worker/API active user scope |
| GET `/api/outreach/contacts?page=1` | Signed + actor | Authorized approved Lead and EmailLead contacts, paginated |
| GET `/api/outreach/contacts/:leadId/:pocId` | Signed + actor | Fresh authoritative recipient and ownership check |
| POST `/api/outreach/events` | Signed service request | Idempotent revision-based status projection |
| GET `/api/outreach/leads/:leadId/status` | Existing x-auth-token | Last acknowledged status snapshots, timestamps and IDs |
| POST `/api/outreach/leads/:leadId/stop` | Existing x-auth-token | `{pocId}` stops contact; `{}` stops all company sequences |
| POST email app `/api/integration/stop` | Signed body with actorId | Durable idempotent stop with fresh CRM permission check |

Service requests use `x-outreach-timestamp`, `x-outreach-nonce`, `x-outreach-signature`. The signature is hex HMAC-SHA256 over `METHOD\nEXACT_PATH_AND_QUERY\nTIMESTAMP_MS\nNONCE\nRAW_BODY`. Service reads also include `x-outreach-actor` and `x-outreach-actor-signature`, calculated with `RAW_BODY + '\n' + ACTOR_ID` in the body position. The stop endpoint binds the actor in the JSON body. Freshness window: five minutes.

CRM status events carry event ID, enrollment ID, lead/POC IDs, revision, status, sent count, last/next timestamps, reply indicator and stop reason. Replayed or older revisions cannot overwrite a newer projection. Retry uses a fresh signed nonce while preserving event ID/revision.

## Frontend source still required

The actual CRM frontend repository was not provided. No claim is made that its UI has been modified. `integrations/StopSequenceControls.tsx` is a portable React integration example, ready to adapt after reviewing that repository's auth/client/component conventions. The separate app's CRM contacts screen already demonstrates contact and company stop controls.

Mount the contact Stop button beside each point of contact. Display separate company Stop All action, per-sequence status, submitted count, last/next times, reply indicator, reason and history link. Do not show Stopped merely because the request was clicked. Only an acknowledged email-app Stop response confirms it; a timeout is Pending/failed and must remain visible. CRM status projections may briefly lag that authoritative acknowledgment. The example marks this distinction explicitly.

Live sign-in uses CRM `loginType` (`admin` or `agent`) and the existing login endpoint. The email application never receives the CRM JWT signing secret. Role rules are verified from active User documents rather than trusting old JWT roles.

Current source-link data is optional. Saved hiring-needs strings are context, not dated proof of current hiring. Use the app research form for dated excerpts/source verification until the frontend supports richer evidence fields.
