# Reliability and security contract

The API and worker are separate Node processes. MongoDB must support transactions (replica set or sharded cluster). Each collection has a unique `id` index; active email reservations have a partial unique normalized-email index. Enrollment uniqueness is `(leadId,pocId,sequenceId)`; jobs are unique per enrollment, generation and step. Notifications deduplicate on mailbox and provider message ID.

State changes are serializable through a transaction revision document. Transition callbacks contain no network calls and can safely retry. Each entity has its own collection; the worker persists claims, leases, provider draft identifiers, dispatch fences, daily reservations and CRM outbox events before external effects. This first version reads the workspace collections within each transition: appropriate for a small pilot, but a material throughput limitation at large CRM scale. Partition repositories and move to targeted queries/transactions before high-volume deployment. Do not horizontally scale this as a bulk-mail service without load testing.

## Send and stop race

1. Atomically claim a pending job and lease one mailbox. Multiple workers cannot claim the same job or send concurrently through that mailbox.
2. Recheck contact access and the current authoritative CRM email. Create a provider draft (which does not send).
3. In one transaction, persist draft ID, recheck status/generation, campaign, suppression, emergency stop, approval and inbox health, then record `dispatching` and reserve a daily slot.
4. Submit the draft to Microsoft outside the transaction, then record acceptance.

Step 3 is the dispatch fence. A Stop committed before it prevents sending. A Stop after it prevents subsequent jobs but cannot recall a request already in flight. A reply can likewise race with an already-started submission. The UI states this limitation. Never promise exactly-once delivery.

Expired `claimed` leases are reclaimable; expired `dispatching` leases become `uncertain`. Network loss or Microsoft 5xx during send is uncertain. Such jobs are never automatically resent. Their draft immutable IDs are queried for sent-state evidence. Confirmed acceptance is recorded; the sequence remains Paused for explicit review/resume. Missing or still-draft messages remain flagged for operator investigation. An unresolved uncertain job holds its address and mailbox against further automated submissions.

Retries are bounded to five send attempts and honor Microsoft Retry-After. CRM delivery uses exponential backoff and ten attempts, then remains visibly Failed until an administrator retries/reconciles. CRM state updates are monotonically versioned, so duplicates or out-of-order events do not roll status backward. The app's acknowledged Stop decision is authoritative; CRM event synchronization is eventually consistent.

Day offsets are anchored to the original sequence start and adjusted to the selected zone/window and optional weekends. When the next nominal step is already overdue at the time of the preceding submission, it is moved forward by that step's original interval. The worker submits at most one step for a recipient in a cycle. Mailbox quotas use Asia/Kolkata calendar days consistently across campaigns; accepted and uncertain reservations count. Returned acceptance is not confirmed delivery.

## Identity and secrets

Live sign-in forwards CRM login server-to-server, validates the user through the CRM adapter, and issues an opaque HttpOnly Secure SameSite cookie. Every authenticated request refreshes active user role/team scope from the CRM. Every contact mutation and dispatch performs a fresh contact ownership lookup. The existing CRM JWT secret is not shared with this app. The dedicated HMAC credential can access only the new outreach service routes; it cannot call other CRM administrative APIs.

Service signatures bind method, exact path/query, timestamp, nonce and body. The actor header has an additional signature. CRM receipts reject replay for the five-minute freshness window; stop receipts persist with the decision. Outgoing state events have durable IDs and revisions. Graph notifications validate subscription ID and encrypted clientState, enqueue identifiers durably and retrieve the actual message through Graph; untrusted webhook content cannot directly mark a reply. OAuth uses state bound to the session, one-time consumption and PKCE. Tokens and OAuth verifiers use AES-256-GCM. Rate limits and body limits apply to the API. Logs omit raw provider errors, tokens and message bodies.

Drafts are plain text. HTML is generated only by escaping that text, then shown in a sandboxed iframe. Source excerpts, CRM descriptions and profiles enter the model as untrusted JSON data beneath fixed server-side instructions. All model output is structurally validated and cited evidence IDs must exist and be eligible. Human review remains required: structural validation cannot prove every natural-language claim true.

## Inbox and suppression

Any matched response stops the sequence, including automatic replies. Matching uses conversation IDs or references to stored internet message IDs; sender address alone is insufficient. Microsoft mailbox-wide notifications supplement periodic delta reconciliation across all non-hidden folders, including nested folders. Cursor progress is persisted page by page; a failed or stale inbox makes dispatch visibly wait. Removed/missed subscriptions trigger reconciliation/renewal. Delta expiry clears the affected cursor and re-baselines on the next cycle. First-time scans may be slow for large mailboxes; only matching messages are retained in the app.

Identifiable delivery-status messages stop with reason `bounce`; unsubscribe responses can be explicitly marked in the reply viewer and immediately suppress the normalized address across campaigns. Any ordinary matched unsubscribe request already stops as a reply before that classification. Automatic identification of arbitrary free-form unsubscribe wording is intentionally not used for stop decisions. Bounces without usable original identifiers need manual review; never match them solely by sender. Retain suppression entries when applying retention policies.

## Monitoring and retention

Monitor worker availability, stale inbox times, reconnect mailboxes, uncertain jobs, failed CRM events, Mongo transaction retries and queue lag. Alert on failures rather than exposing provider responses containing personal data. Apply a documented retention policy to message bodies, audits, usage and inactive snapshots before production use. Backup Mongo and the encryption key separately. No database cleanup or production migration was executed in this task.
