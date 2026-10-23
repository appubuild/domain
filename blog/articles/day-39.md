# API Gateways, Reverse Proxies and Load Balancers: How Web Traffic Reaches Your App

A browser rarely talks directly to every application component. A request may pass through a reverse proxy, an API gateway, a load balancer, and one or more backend services before a response returns. Those names are sometimes used interchangeably in product marketing, but they describe different roles. Understanding the responsibilities helps a team avoid placing authentication in the wrong layer or retrying a request that may already have changed data.

> **Quick answer:** A reverse proxy accepts requests on behalf of backend servers and forwards them. A load balancer distributes requests across healthy backends. An API gateway commonly adds API-focused policies such as authentication, quotas, request validation, and route management. One product can perform several roles, but the architecture should make each responsibility and failure mode clear.

## What each component does

A **reverse proxy** sits between a client and one or more servers. It can route requests by hostname or path, terminate TLS, forward selected headers, compress responses, and hide backend addresses. The proxy must handle forwarded identity and client IP headers carefully; a backend should trust those headers only when they came from a known proxy that overwrites untrusted values.

A **load balancer** distributes traffic across a pool of backends. It can use health checks and routing policies to avoid sending new requests to an unhealthy instance. Some load balancers operate at the transport layer, while others understand HTTP paths and headers. The correct choice depends on protocols, availability needs, and the provider’s features.

An **API gateway** manages API entry points and policies. It may validate authentication, apply per-client quotas, normalize requests, enforce size limits, select versions, or aggregate endpoints. A gateway does not replace authorization in the application. The backend should still verify that the authenticated user can access the specific account, domain, or record in the request.

| Component | Main question it answers | Typical responsibilities |
|---|---|---|
| Reverse proxy | Where should this request go? | TLS termination, host/path routing, header forwarding |
| Load balancer | Which healthy instance should receive it? | Distribution, health checks, connection handling |
| API gateway | Which API policy applies? | Authentication, quotas, validation, version routing |
| Application service | Is this operation allowed and correct? | Business rules, resource authorization, data access |

A vendor’s “gateway” may also be a reverse proxy or load balancer. Read the product’s actual behavior, not only the label, and avoid duplicating controls without knowing which layer is authoritative.

## A request path for a domain-search API

Consider a fictional service with endpoints for suggestions, public registration lookups, and saved user lists. A simplified architecture is:

```text
Browser
  │ HTTPS
  ▼
Edge / reverse proxy ── TLS, host routing, request size limits
  │
  ▼
API gateway ─────────── authentication, quota, API version
  │
  ├── /v1/suggestions → generator service
  ├── /v1/lookup      → lookup service → authorized data provider
  └── /v1/saved       → account service → database
```

The route map does not imply that all endpoints have the same risk. A public suggestions endpoint may be anonymous but rate-limited. A saved-list endpoint requires authentication and per-user authorization. A lookup endpoint may require a provider credential kept server-side and could have usage limits. The gateway can reject a missing token, but the account service must check that the requested saved list belongs to that identity.

TLS termination at the edge protects a browser-to-proxy connection. The proxy-to-backend link also needs a defined security model. Depending on the network and threat model, use encrypted service-to-service connections, identity verification, and restricted network access. Do not assume that a private subnet alone makes every internal request trustworthy.

## Routing, TLS, and rate limiting

Routing rules map a hostname, path, method, or header to a backend. Keep rules explicit and test overlapping paths, encoded characters, trailing slashes, and version prefixes. A path-based rule should not accidentally send an administrative endpoint to a public service. Define which component owns redirects and canonical host behavior so a request does not loop between layers.

TLS termination simplifies certificate management at a proxy or gateway, but it also makes that component a security boundary. Restrict access to private keys, renew certificates, disable obsolete protocol configurations according to current policy, and verify the identity of upstream services where needed. Use current security guidance rather than copying a cipher list from an old example.

Rate limiting can protect an API from accidental bursts or abuse. A gateway can count requests by key, account, IP, or another identifier, but the choice affects fairness and privacy. Behind a proxy, client IP is useful only when the forwarding chain is configured correctly. For distributed systems, a per-instance counter may not enforce a global quota unless the implementation shares state. Document whether a quota is approximate, local, or centrally enforced.

Return an appropriate response when a limit is reached, include a retry hint when supported, and do not expose private quota details. Rate limiting is not a substitute for authorization or fraud detection. A user may have permission to call an endpoint but still exceed a safe usage policy.

## Health checks and failure handling

A load balancer’s health check should tell whether an instance can safely receive traffic. It may use a simple process-level endpoint or a deeper readiness check. If the check depends on every downstream service, a brief database issue could mark all instances unhealthy at once. Define liveness and readiness separately when the platform supports them, and avoid making a check itself expensive.

Timeouts should be set at each layer with a clear budget. If the gateway waits longer than the browser, a user may retry while the original operation continues. Retries can improve resilience for transient failures, but they can also multiply load or repeat a side effect. Retry only operations that are safe to repeat, use idempotency keys for state-changing actions, and cap the number of attempts.

When a backend fails, the gateway should return a clear error and a request identifier. It should not expose stack traces, internal hostnames, tokens, or customer data. Logs across proxy, gateway, and service should carry a consistent correlation or trace identifier so an operator can follow one request without logging the complete payload.

## Versioning and endpoint ownership

A gateway can route `/v1/` and `/v2/` to different services during a migration, but versioning is a product decision. Define how long clients are supported, how deprecation is announced, and how old requests fail. Do not route based on an undocumented header that clients cannot discover. Maintain an API contract and test it at the edge and backend.

Choose one source of truth for each policy. For example, the gateway may enforce a coarse request quota, while the application enforces a per-account business limit. Document that split so an incident is not investigated in the wrong service. Duplicate policy implementations can drift: one may reject traffic while another allows it, or the displayed quota may not match the enforced one.

## A practical architecture checklist

- Draw the path from client to public endpoint to backend and data store.
- Name the component responsible for each hostname and path route.
- Decide where TLS terminates and how internal connections are protected.
- Verify forwarded headers are overwritten or trusted only from known proxies.
- Keep authentication and resource authorization distinct.
- Add request-size limits, quotas, timeouts, and safe error responses.
- Define health checks, readiness, and safe failover behavior.
- Make retries bounded and safe for the method and operation.
- Add a request ID or trace context across layers without logging secrets.
- Test unavailable backends, malformed requests, and configuration rollback.

## Forwarded headers and client identity

A proxy often adds headers describing the original protocol, hostname, and client address. Those values can be useful for redirects, secure-cookie behavior, audit logs, and rate limiting. They are also easy to misuse. If a public client can send a header such as `X-Forwarded-For` and the proxy simply appends or forwards it, the backend may mistake attacker-controlled text for the real client address.

Configure a trusted proxy chain. At the first boundary, remove untrusted forwarded headers and write the values the proxy has actually observed. Each downstream service should trust only the known proxy addresses or service identities. Test the behavior with a forged header and confirm that authorization and rate limits do not rely on it as a secret or identity credential. For IPv6, ensure parsing and storage can handle the full address format.

## Avoid retry and timeout conflicts

Choose a total request deadline and allocate it across layers. If the browser abandons a request quickly while a gateway continues waiting, work may continue after the user retries. If the gateway retries an upstream call and the application also retries, attempts can multiply. Write a timeout table for client, gateway, service, database, and external provider; make each inner timeout fit within the outer budget.

For read-only operations, a limited retry may be reasonable after a transient network failure. For an update, payment, or notification, retry only when the operation is idempotent or uses a deduplication mechanism. When the result is uncertain because a connection ended after submission, check the operation status before sending it again. Return a request ID so support can follow the path without asking the user to disclose private input.

## Configuration and failure tests

Test route changes in a staging environment with the same proxy and TLS rules as production. Exercise an unknown path, a malformed method, a large body, an expired credential, a slow backend, and a backend that returns an invalid response. Check that health checks remove only the intended instance, that error pages do not expose internal names, and that a rollback restores the previous route map. Keep gateway configuration versioned and review it like application code.

## TLS and proxy trust are security boundaries

At the public edge, TLS settings determine how browsers authenticate the site and protect traffic in transit. Certificate renewal should be monitored, and the application should not accept an untrusted certificate from an upstream service merely to avoid a deployment problem. If TLS terminates at a proxy, define how the backend knows the original request was secure. Set secure-cookie behavior from trusted proxy information, not from a client-controlled header.

The proxy should remove or replace hop-by-hop headers and avoid forwarding credentials to a backend that does not need them. Restrict management interfaces and configuration APIs to authorized operators. Keep a record of certificate ownership and emergency renewal contacts. If several proxies are chained, document which one is allowed to assert client identity and how the next one verifies that assertion.

A staging environment should reproduce these trust boundaries. Testing only the backend directly can miss an edge rule that strips an authentication header, changes the path, or forwards a spoofed client address. Test both the public route and the service-to-service route, while keeping test credentials separate from production.

## Match the load-balancing strategy to the state

If a service stores session state only in process memory, sending the next request to another instance may appear as a logout. Prefer stateless sessions or a shared session store with an explicit security and availability design. Database writes should not depend on a specific backend instance unless the architecture intentionally uses sticky sessions and the failure implications are understood.

For long-running requests, streaming, or websocket connections, verify that the proxy and load balancer support the required connection lifetime and protocol. A health check can stop new requests from reaching an instance, but it may not immediately terminate existing connections. Make deployments graceful and define how unfinished work is resumed.

## Frequently asked questions

**Is an API gateway a reverse proxy?** Many gateways act as reverse proxies, but they may add API-specific policies. Product roles overlap; verify the features and boundaries in the actual architecture.

**Does TLS at the gateway secure the backend?** It secures the client connection to that gateway. The gateway-to-backend connection has its own security requirements.

**Should a gateway perform all authorization?** It can check identity and coarse policy, but the application should verify access to the specific resource and enforce business rules.

**Can a load balancer retry a failed request?** Some can, but retrying a state-changing request may duplicate work. Configure retries based on method semantics and idempotency.

**Do small websites need all these layers?** No. A static site or small application may need only a hosting platform or one proxy. Add layers when they solve a defined routing, availability, or policy problem.

## Conclusion

Reverse proxies, gateways, and load balancers can make a web system easier to route, protect, and scale, but they do not remove the need for correct application logic. Draw the request path, assign policy ownership, protect headers and credentials, and test what happens when a backend fails. Add only the layers your service needs, and make their behavior observable enough to diagnose a real request.