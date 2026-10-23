# REST APIs Explained: HTTP Methods, Status Codes, JSON and API Design

An API is a defined way for software to request information or operations from another system. REST is an architectural style for networked systems, not a synonym for every HTTP endpoint. Many APIs use HTTP and JSON while only following some REST principles. For a client developer, the practical questions are: what resource is addressed, which method applies, what data is accepted, what response means success, and how an error can be handled safely?

> **Quick answer:** A REST-oriented API typically exposes resources through URLs and uses HTTP methods such as GET, POST, PUT, PATCH, and DELETE to express operations. JSON is a common request and response format, while HTTP status codes communicate broad outcomes. Good API design also defines authentication, validation, pagination, filtering, rate limits, versioning, and error details.

## What REST means in practice

REST stands for Representational State Transfer. It describes constraints for networked applications, including a client-server separation, stateless requests, cacheability where appropriate, a uniform interface, and layered components. A REST-style API usually models resources such as domains, users, or saved searches and exposes representations of those resources over HTTP.

A simple resource might be addressed as `/v1/saved-searches/abc123`. A client requests a representation or asks for a change using an HTTP method. The server processes the request and returns a status code, headers, and sometimes a JSON body. The client should not need to know the server’s internal database tables or file paths.

Not every service that uses JSON over HTTP is RESTful. Some expose action-oriented routes such as `/runLookup` or `/createReport`. That may still be a useful API, but describing it accurately helps set expectations. A design should be judged by its clarity, consistency, security, and compatibility—not by whether every route is named after a noun.

## HTTP methods and their intent

The method communicates what the client is asking the server to do. Method semantics matter for caching, retries, proxies, and safe client behavior.

| Method | Common intent | Example resource operation |
|---|---|---|
| GET | Retrieve a representation without intentionally changing state | Read `/v1/saved-searches/abc123` |
| POST | Submit data or ask the server to process/create something | Create a saved search or run a lookup |
| PUT | Replace a resource representation at a known URL | Replace settings for a specific saved search |
| PATCH | Apply a partial update | Change one notification preference |
| DELETE | Remove a resource | Delete a saved search owned by the caller |

The method alone does not make an operation safe. A `GET` endpoint that triggers a purchase or deletes data is surprising and can be called by crawlers, prefetchers, or retries. Use methods consistently and require authorization for state changes. `PUT` is generally designed to be idempotent: repeating the same request should produce the same intended resource state. `POST` is not automatically idempotent; use an idempotency key when a client might retry an operation that creates a charge, sends a notice, or starts a job.

`PATCH` formats can vary. Document whether omitted fields remain unchanged, whether `null` clears a value, and how conflicting updates are handled. For destructive operations, communicate what will be removed and whether recovery is available.

## JSON requests and responses

JSON is a text format for structured data. A client might send:

```http
POST /v1/domain-searches HTTP/1.1
Content-Type: application/json
Authorization: Bearer [redacted]

{"query":"river","extensions":["com","net"],"limit":20}
```

A response could include a request identifier, normalized suggestions, and a clear statement about the source:

```json
{
  "requestId": "req_example_123",
  "results": [{"name":"river-example.com","source":"generator"}],
  "availabilityChecked": false
}
```

These are illustrative values, not a live service response. The field `availabilityChecked: false` is important if the endpoint only creates names. A client should not infer a stronger result than the server actually checked.

Validate JSON at the server boundary. Enforce required fields, types, allowed enum values, string lengths, array sizes, and safe character rules. Reject extra or ambiguous values where they could alter behavior. Return stable errors that identify the field or condition without revealing stack traces, internal hostnames, or secrets. Document whether field names are case-sensitive and how unknown properties are treated.

## Status codes and error handling

HTTP status codes summarize what happened, but they do not replace a useful response body. Common categories include success, redirection, client error, and server error. For example, `200` commonly means a request succeeded; `201` often indicates creation; `204` indicates success without a response body; `400` can indicate malformed input; `401` means authentication is required or failed; `403` means the request is understood but not permitted; `404` indicates that a resource was not found or is not exposed; `409` can signal a conflict; `429` indicates a rate limit; and `5xx` signals a server-side failure.

The exact choice should fit the API contract. Do not use `200` for every outcome and force clients to parse a private text message. Do not return `404` for a valid lookup that produced no record if the endpoint itself succeeded; model the result separately, for example `200` with a clear `status: "unknown"` when that is the intended domain meaning. A provider timeout is not the same as “available.”

Use a consistent error format such as:

```json
{
  "error": {
    "code": "invalid_extension",
    "message": "One requested extension is not supported.",
    "requestId": "req_example_123"
  }
}
```

Clients should handle status codes they do not recognize, timeouts, malformed responses, and network failures. A useful error does not disclose private implementation details; it gives the user a next step and a reference identifier.

## Pagination and filtering

An endpoint that returns many resources should support pagination rather than sending an unbounded response. Offset pagination can be straightforward for a stable small collection, but results can shift while a client is paging. Cursor pagination uses a continuation token tied to a stable sort or snapshot. Document the maximum page size, sorting behavior, and whether the next cursor can expire.

Filtering should use a small, documented set of parameters. For example, a saved-search endpoint might accept `?status=active&limit=25`. Validate filter values and define how multiple filters combine. Never concatenate user-supplied filter text directly into a database query. Use parameterized statements or a query builder.

Pagination tokens should not reveal secrets or grant access on their own. Re-check authorization on every page request. If the dataset changes between pages, make the consistency behavior explicit; a cursor is a navigation aid, not necessarily a permanent snapshot.

## A sample domain research API

A fictional versioned API might use these routes:

| Endpoint | Method | Purpose | Key safeguards |
|---|---|---|---|
| `/v1/suggestions` | POST | Generate or retrieve naming ideas | Bound input, rate limit, state source clearly |
| `/v1/lookup` | POST | Query an authorized data provider | Keep credentials server-side, return checked time and `unknown` on failure |
| `/v1/saved-searches` | GET | List the caller’s saved searches | Authenticate and scope to current account |
| `/v1/saved-searches` | POST | Create a saved search | Validate, authorize, handle duplicate submissions |
| `/v1/saved-searches/{id}` | PATCH | Update selected settings | Check ownership and allowed fields |
| `/v1/saved-searches/{id}` | DELETE | Remove a saved search | Confirm semantics, check ownership, consider recovery |

The domain lookup example does not imply that any particular provider offers a public API or that its response guarantees registrability. A production endpoint should identify its source, coverage, timestamp, and limitations. The application should also respect provider terms and data protection requirements.

## Authentication, versioning, and documentation

Use an established authentication method rather than inventing a password scheme. Keep API credentials out of browser bundles and source control. Authorization must be checked against the resource on every operation; a valid token does not mean the user owns every requested ID. Use scopes, rate limits, and audit events appropriate to the operation.

Versioning helps clients adapt to incompatible changes. A route prefix such as `/v1/` is one option. Document deprecation windows and avoid silently changing a field’s meaning. Provide an OpenAPI description or similarly precise contract when suitable, including examples that are explicitly fictional, schemas, authentication, status codes, and limits.

## Idempotency, concurrency, and safe changes

Clients retry because a network can fail after the server has accepted a request but before the client sees the response. For operations that create a resource or trigger an external side effect, accept an idempotency key or provide a way to query the operation status. The server should scope the key to the caller and operation, store the result for an appropriate period, and reject reuse with a different request body. Do not treat an arbitrary client-supplied identifier as permission.

Concurrent updates need an explicit policy. Two clients might edit the same saved search at once. The API can use an entity version, modification timestamp, or conditional request to detect that the resource changed since it was read. Return a conflict response with a clear next step instead of silently overwriting a newer update. For a destructive operation, consider whether a soft-delete or recovery period is appropriate.

## Document and test the contract

An API description should include examples for success, validation error, unauthorized access, rate limiting, and upstream failure. State which fields are required, which values are accepted, whether a result is cached, and how dates and time zones are represented. Include pagination behavior and maximum request sizes. Mark every sample as illustrative; do not present fake response data as a live check.

Contract tests can verify that the server and client agree on field names and status codes. Security tests should try accessing another account’s resource, sending an oversized body, using an unsupported method, and repeating a side-effecting request. Test the deployed gateway as well as the application because proxy rules can alter paths, headers, and body limits. Publish deprecation notices before removing a route that clients depend on.

## CORS and browser-facing API clients

Cross-Origin Resource Sharing (CORS) is a browser policy that controls whether a page from one origin can read a response from another origin. It is not API authentication. A permissive CORS response does not make an endpoint public in a safe way, and a restrictive response does not stop a script outside the browser from calling the server. Configure allowed origins deliberately and keep authorization checks on the API.

Avoid reflecting any incoming `Origin` value without validation. If credentials such as cookies are used, the allowed-origin and credential settings need particular care. Test preflight requests and error responses through the actual gateway. Do not place a long-lived API secret in a JavaScript bundle to make a browser request work; a visitor can inspect it. Use a backend proxy or an appropriately designed public API key with limited scope and abuse controls.

## Versioning and backward compatibility

An API contract may be used by a browser, mobile app, partner, or internal job that cannot all be updated at once. Avoid changing a field’s meaning without changing the contract. Add optional fields in a way older clients can ignore, and define how long deprecated routes remain supported. If a breaking change is necessary, publish a migration path and test both versions during the transition.

A version prefix such as `/v1/` is easy to understand but can lead to long-lived versions that the team must maintain. Other approaches include compatible schema evolution or explicit media types. Choose one policy and document it. Keep release notes precise: tell client developers what changed, when it takes effect, and how to test the new behavior. Never imply that an endpoint is stable if it is still experimental.

### Frequently asked questions

**Is every JSON API a REST API?** No. JSON describes a data format; REST describes architectural constraints. A JSON-over-HTTP service may be useful without being strictly RESTful.

**Should a GET request change data?** Generally avoid it. GET is expected to retrieve information and can be cached or repeated by clients and intermediaries.

**Is a `404` the right response when a domain appears unregistered?** Not necessarily. The API route may have succeeded while the upstream status remains uncertain. Model lookup status separately and explain the source.

**How should an API handle a repeated POST?** Define whether duplicates are safe. For consequential actions, support an idempotency mechanism and ensure retries cannot create unintended duplicate work.

**Do I need an API gateway?** Not always. A small API may use a reverse proxy or platform routing. Add a gateway when it solves a defined policy or operations need.

## Conclusion

A dependable API has a clear contract: resource paths, method semantics, validation rules, status codes, pagination, authentication, and errors. Build it around the client’s task, then test both success and failure cases. Use HTTP conventions consistently and describe what a result actually means. A documented endpoint is easier to integrate, but the service still needs security, monitoring, and careful operation.