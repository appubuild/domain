# Webhooks vs APIs: How Websites Communicate and Automate Tasks

An API lets one application request data or an action from another. A webhook sends a notification when an event occurs, so the receiver does not have to ask repeatedly whether anything changed. Many integrations use both: an API creates or retrieves a resource, while a webhook reports that a later event happened. The design should account for authentication, delivery failures, duplicates, and the possibility that a notification arrives out of order.

> **Quick answer:** With ordinary polling, a client calls an API on a schedule to look for updates. With a webhook, the provider sends an HTTP request to a URL you control when an event occurs. Webhooks reduce repeated checks but require a reachable endpoint, signature verification, durable event handling, retries, deduplication, and monitoring. Never treat an incoming webhook as trusted solely because it reached your server.

## Polling and event delivery

Polling is straightforward: a service asks “has anything changed?” at regular intervals. It can be suitable when changes are infrequent, the API has a reliable `updated_since` cursor, and the required freshness is known. Too-frequent polling may waste quota and resources; too-infrequent polling can delay an update. Use conditional requests or cursors where the provider supports them, and observe its rate limits.

A webhook is event-driven. The provider sends a request to a registered endpoint, often with an event identifier, event type, timestamp, and resource reference. The receiver verifies the sender according to the provider’s scheme, accepts the message, and processes it. The provider may retry if it does not receive the expected response. A timeout or lost response can cause the same event to arrive again even if the first attempt was processed.

```text
Polling:   Your app ── “anything new?” ──→ Provider API (repeated on a timer)
Webhook:   Provider ── “event occurred” ─→ Your endpoint (when it happens)
```

The choice is not always exclusive. A webhook can wake a worker, which then calls the API to fetch the full current resource. A scheduled reconciliation can periodically compare local state with the provider to detect missed events.

## Verify webhook requests

The endpoint should verify authenticity before acting on the event. Providers commonly sign a request body using a secret or another cryptographic scheme. Follow the provider’s current documentation precisely. Verify the signature over the exact bytes and required timestamp, use a constant-time comparison where appropriate, and keep the signing secret out of source control and browser code.

A timestamp check can reduce replay risk, but it is not a replacement for idempotency. An attacker might replay a valid event within an allowed window. Store processed event IDs or use another deduplication key. Protect the signing secret, rotate it according to the provider’s procedure, and support overlapping keys during a planned rotation if the provider allows it.

The endpoint should also limit request size, parse content types safely, reject malformed payloads, and avoid trusting a claimed account or resource ID without verifying it. If the provider publishes source IP guidance, network filtering can be an additional layer, not a substitute for signature verification.

## Acknowledge quickly, process durably

Do not keep the webhook connection open while performing a long workflow. Verify the request, persist the event or enqueue a durable job, and return the expected success response within the provider’s timeout. Process the job in a worker with retry and error handling. If the event cannot be stored safely, return an error so the provider can retry rather than silently dropping it.

A durable queue helps absorb bursts and separates request acceptance from downstream work. It also introduces another dependency: monitor queue depth, oldest-message age, dead-letter events, and worker failures. Make processing idempotent so a retry after a crash does not send duplicate emails, create repeated records, or issue multiple payments.

Events may arrive late or out of order. A “payment succeeded” event could arrive after a later correction event, or a resource update could be delivered more than once. Use the provider’s event version, creation time, or API retrieval to determine the current state. Do not assume arrival order equals event order unless the provider explicitly guarantees it.

## Retries, duplicates, and failure handling

Webhook providers often retry after network errors or non-success responses, but retry schedules and maximum attempts vary. Read the current delivery policy. Your handler should respond predictably to a duplicate event, return a transient error when it truly needs another delivery, and avoid returning success before durable acceptance.

Maintain a delivery log that includes event ID, event type, receipt time, verification outcome, processing state, and a correlation ID. Do not log full secrets or sensitive payloads unless the data is necessary and protected. Provide a way to inspect failed events and replay them safely after correcting a bug. Replays should go through the same deduplication and authorization checks as normal delivery.

A webhook failure can be due to DNS, TLS, a firewall, an invalid signature, a timeout, an application error, or a downstream dependency. Separate these reasons in operational records. Alert on sustained delivery failures or growing queue depth, not every transient retry. Document how an operator can pause processing if a malformed event threatens data integrity.

## Domain registration and payment examples

Imagine a fictional registrar sends an event when a domain registration request changes state. A website could accept the signed event, store an event ID, and enqueue a status update. Before displaying “registered,” it should check that the event corresponds to the correct account and resource, understand whether the provider’s event means request accepted or registration completed, and retrieve current details if needed. This is an architecture example, not a claim that a specific registrar exposes such a webhook.

A payment confirmation illustrates why state changes need careful handling. The browser’s return URL is not proof that payment succeeded. The server should verify a provider-signed event or query the provider through an authenticated API, then update the order idempotently. The user should not be charged again because a webhook was delivered twice. The event should be tied to the expected amount, currency, account, and order according to the provider’s documentation.

## API polling versus webhook comparison

| Question | Polling API | Webhook |
|---|---|---|
| Who initiates contact? | Your application | Provider or event source |
| Freshness | Depends on polling interval and API | Often prompt, but delivery can be delayed |
| Main operational need | Cursor, interval, quota, backoff | Public endpoint, signature, queue, retries |
| Failure recovery | Retry a query or reconcile state | Provider retry plus local replay/reconciliation |
| Duplicate work | Repeated queries are expected | Duplicate event delivery must be handled |
| Best fit | Simple, periodic, or low-volume updates | Event-driven updates with a supported provider |

A webhook is not automatically more reliable. It reduces repeated queries but adds delivery infrastructure. If a provider does not offer a documented webhook, do not invent one; use its supported API and a safe polling schedule.

## Implementation checklist

- Register an HTTPS endpoint with a stable, monitored URL.
- Verify the signature and timestamp using current provider documentation.
- Limit payload size and validate event type and required fields.
- Store or enqueue the event durably before acknowledging it.
- Deduplicate by event ID or another stable key.
- Process with bounded retries and safe handling for out-of-order events.
- Keep signing secrets server-side and rotate them safely.
- Record delivery and processing status without exposing sensitive payloads.
- Monitor failures, queue age, and dead-letter events.
- Provide a manual replay path and periodic reconciliation with the provider API.

## Reconcile local state after interruptions

A webhook can be delivered successfully while the worker that processes it crashes later. Store processing state separately from receipt state: accepted, queued, processing, completed, or failed. Keep enough event metadata to retry a failed job without accepting arbitrary replay requests from the public internet. An operator-triggered replay should require authorization and should record who initiated it.

Periodic reconciliation compares the application’s local view with the provider’s current records or event history. This is useful after a prolonged outage, a webhook misconfiguration, or a bug that discarded an event. Reconciliation should use bounded page sizes and backoff so it does not create a second outage. If the provider does not expose event history, document the limitation and decide how a user can report a missing update.

## Version payloads and protect event data

Event schemas change. Record a provider’s event version when supplied, validate required fields for that version, and ignore or safely store unknown optional fields. Do not assume every event contains a complete snapshot; some provide only an identifier that must be fetched through an API. Keep compatibility logic explicit and test a sample from each supported version.

Webhook payloads can contain email addresses, order references, or customer data. Restrict who can inspect delivery logs, redact fields that are not needed, encrypt storage where appropriate, and set a retention period. A shared support screenshot can leak a signed URL or token; provide a redacted diagnostic view. The webhook endpoint should also be protected against request floods and oversized bodies.

Before production, test invalid signatures, stale timestamps, valid duplicates, out-of-order updates, queue failure, provider retries, secret rotation, and replay after a code fix. Confirm that a failed event creates a visible alert and that the recovery procedure does not produce duplicate side effects.

## Combine webhooks with a deliberate polling schedule

A webhook is often the fast notification path, while a periodic API query is the repair path. When a webhook arrives, the application can fetch the provider’s current resource rather than trusting every field in the event body. It can then update local state and record the provider version or update time. A slower reconciliation job can scan recent records or event history to identify changes that were missed during an outage.

Do not poll every resource at the highest frequency “just in case.” Use provider-supported cursors, conditional requests, and rate limits. Spread scheduled checks over time and pause or slow them when the provider reports a service issue. If the provider does not offer a webhook or event history, document the freshness gap and set a realistic update interval. The application should show when it last confirmed a state rather than implying that it is continuously current.

## Protect endpoints against accidental disclosure

A webhook URL is not a secret by itself. Avoid putting credentials in the path or query string because URLs can appear in logs and monitoring systems. Use the provider’s supported signing scheme, enforce TLS, and keep the handler’s public response small. Return a generic error to the sender while writing safe diagnostic details to restricted logs.

When a webhook triggers an email or notification, confirm the recipient and account from trusted server-side records, not from an arbitrary payload field. Apply per-event limits so a replayed or malformed event cannot send an unlimited number of messages. Provide an internal pause switch for high-impact notifications and alert the owner when it is used.

## Decide whether the event or current state is authoritative

An event tells the receiver that something happened at a point in time. It may not represent the provider’s current state if later changes occurred or delivery was delayed. For an important update, store the event for audit and fetch the current resource through the provider’s API. Compare version numbers or timestamps where supported. If two events arrive out of order, avoid overwriting a newer state with an older one.

For an event that triggers a one-time action, such as sending a receipt, deduplicate using a stable event or business-operation identifier. For an event that updates a status, make the update conditional on version or timestamp where possible. These are different processing patterns; a single generic “mark event processed” flag may not be enough. Document what happens if an event arrives after its resource was deleted or a user has closed the account.

### Frequently asked questions

**Can I trust a webhook because it came from the provider’s IP range?** Network filtering may help, but verify the provider’s cryptographic signature and event semantics as documented.

**Should the endpoint return success before processing finishes?** It can acknowledge after the event is durably accepted, then process asynchronously. Do not acknowledge an event that was neither stored nor safely queued.

**Do webhooks arrive exactly once?** Many delivery systems may retry, so design for duplicates unless the provider explicitly guarantees another model.

**Can I use a webhook without an API?** Sometimes a webhook carries enough information, but many integrations use an API to fetch current resource details or reconcile missed events.

**How do I know if I missed an event?** Use delivery logs and periodic reconciliation with the provider’s supported API or event history, if available.

## Conclusion

APIs and webhooks are complementary ways for systems to communicate. Polling is simple but consumes requests; webhooks are event-driven but need verification, durable acceptance, deduplication, and recovery. Choose a provider-supported design, validate every event, and keep the local state reconcilable. Automation is dependable when it handles delivery failures as carefully as the happy path.