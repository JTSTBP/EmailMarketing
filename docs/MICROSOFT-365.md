# Microsoft 365 connection and live acceptance checklist

Implementation references checked against official documentation on 11 October 2026:

- [Authorization code flow, state and PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Immutable IDs for drafts, sent messages, notifications and delta](https://learn.microsoft.com/en-us/graph/outlook-immutable-id)
- [Create a reply draft: Mail.ReadWrite](https://learn.microsoft.com/en-us/graph/api/message-createreply?view=graph-rest-1.0)
- [Send a draft: Mail.Send and 202 acceptance](https://learn.microsoft.com/en-us/graph/api/message-send?view=graph-rest-1.0)
- [Webhook validation and clientState](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks)
- [Subscription lifetime](https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0)
- [Message delta synchronization](https://learn.microsoft.com/en-us/graph/delta-query-messages)
- [Throttling and Retry-After](https://learn.microsoft.com/en-us/graph/throttling)

Register a confidential web application in the intended Microsoft business tenant. Configure its exact HTTPS callback URL. Delegated scopes are `User.Read`, `Mail.ReadWrite`, `Mail.Send` and `offline_access`. Mail.ReadWrite is necessary to create/update drafts and monitor messages; it does not itself grant sending. Follow tenant consent policy; admin consent may be required. Application-wide mailbox permissions are not requested. Shared/delegated mailbox sending is not supported in this version.

Set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REDIRECT_URI and MS_WEBHOOK_URL only on the server. Connect the mailbox from Mailboxes. The email address is obtained from Graph `/me`; a browser cannot substitute it. Token refresh and reconnect states are implemented. Do not log OAuth callbacks or query strings at your reverse proxy.

The webhook is a public HTTPS POST route. Validation returns the decoded query token as plain text. Basic notifications carry no rich message data. A secret clientState and the subscription ID are checked, and IDs are queued before returning 202. Subscriptions request three days, renew when less than one day remains, and include a lifecycle notification URL. Polling runs independently of webhook delivery. Microsoft message subscriptions have a maximum under seven days; the app requests less than that.

Initial messages are created as drafts with immutable IDs, then sent. Follow-ups use createReply on the stored sent message, replace recipients/body, preserve the provider subject, and check the returned conversation ID. **Real Outlook conversation threading has not been tested.** `GRAPH_THREADING_VERIFIED=false` blocks live follow-ups. Set it only after explicit authorization for tenant testing and a successful acceptance test. Mock tests do not establish Microsoft threading or deliverability.

Before enabling real sending, obtain explicit authorization for the named test recipients and test:

1. OAuth consent, state rejection, encrypted storage, token refresh, revoked consent and reconnect.
2. Webhook validation, correct/wrong clientState, duplicate notifications, renewal and lifecycle events.
3. Initial draft/send acceptance and immutable ID lookup in Sent Items; inspect internetMessageId.
4. Follow-up recipient correctness and real Outlook/Gmail conversation presentation. Check actual subject/thread.
5. Human reply, out-of-office, bounce and unsubscribe; verify no later sequence step submits.
6. Inbox rules moving mail into nested folders; notification downtime and delta reconciliation.
7. Microsoft throttling, token expiry and network loss after submission. Confirm uncertain jobs do not resend.
8. CRM contact/company Stop racing with dispatch; verify the documented in-flight limitation.

Microsoft's actual mailbox/service limits still apply. The configurable application quota is an additional restriction. Acceptance does not establish delivery, reading or inbox placement. Local sign-in, two individually authorised test sends and retrieval of a matching reply have been exercised. This does not verify automated live sequences, webhook delivery or follow-up threading.
