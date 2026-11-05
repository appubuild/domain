"""L4 — errors: the one place a `Result` becomes an HTTP response.

Inner rings return `Result[T]` and never see a status code; the frontend sees
JSON and never sees a Python exception. This module is the only translation
between the two, and having exactly one is what stops the drift that otherwise
happens within a month: three routers each inventing a body shape, and a
frontend with three error parsers.

**RFC 9457 `application/problem+json`**, because it is a standard the frontend's
generated client can type, and because it separates the two things an error
message always conflates:

* `type` / `code` / `title` — *what kind of thing went wrong*, stable, and the
  key the frontend localises from;
* `detail` / `remedy` / `retryable` / `extensions` — *what happened this time*,
  for the log line and the toast.

The status code comes from `ErrorSeverity`, not from a router's mood: a
`WARNING` is a `409` the UI shows as a toast and then carries on from, a
`CRITICAL` is a blocking banner, and mapping that once means a new error kind
inherits the right treatment instead of inheriting `500`.

Every error the frontend can see takes this shape, including the ones FastAPI
raises on its own — a `404` and a validation `422` are responses from this
application as much as a domain refusal is, and a client that has to handle two
error shapes will eventually handle one of them wrong.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Final

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from nova_studio.api.schemas.problem import ProblemResponse
from nova_studio.core.errors import ErrorDomain, ErrorSeverity, NovaError

if TYPE_CHECKING:
    from collections.abc import Callable

    from nova_studio.core.result import Result

#: The statuses a route documents as failures. Kept here, next to the code that
#: produces the bodies, so that adding an error kind means adding it in one place
#: and the generated contract stays a description of what actually comes back.
ERROR_STATUSES: tuple[int, ...] = (
    401,  # no token, or the wrong one
    403,  # a Host or Origin that is not this session
    404,  # no such route
    409,  # a domain refusal the UI shows as a toast
    416,  # a requested range that has already been evicted
    422,  # the request did not match the schema
    500,  # a bug
)


def error_responses() -> dict[int | str, dict[str, Any]]:
    """The OpenAPI fragment every route shares, describing its failures.

    Built fresh per route rather than shared, because FastAPI merges the mapping
    into each operation, and one mutable dict handed to every route would let a
    change made for one appear in all of them.

    The media type is corrected in :func:`nova_studio.api.openapi.contract`:
    FastAPI documents an extra response as `application/json` whatever the
    handler sends, and a generated client that expects JSON where the service
    sends `problem+json` is the drift this module exists to prevent.
    """
    responses: dict[int | str, dict[str, Any]] = {
        status: {"model": ProblemResponse, "description": _description_for(status)}
        for status in ERROR_STATUSES
    }
    return responses


#: Where the transport, not the domain, knows which status is truthful.
#:
#: A severity-derived status says how bad a failure is; the URL says whether the
#: thing exists. Both matter, and they are not the same question: "no project
#: with that id is open here" is a 404 however severely the domain regards it,
#: and a command refused because the state will not allow it is a 409, not the
#: 400 its severity would suggest.
#:
#: One table, because two routers that each decided would eventually disagree —
#: and a frontend that has to know which router it called in order to interpret a
#: status is a frontend with a bug waiting.
STATUS_FOR_CODE: dict[str, int] = {
    # The projects ring.
    "NS-PROJECT-4040": 404,  # no such open project
    "NS-PROJECT-4041": 404,  # no such file
    "NS-PROJECT-4220": 422,  # the archive refused the file
    # The timeline ring: a command refused because the state will not allow it.
    "NS-COMMAND-4104": 409,
    "NS-TIMELINE-4090": 409,  # the timeline was replaced behind the editor's back
    # The job ring: a refusal the scheduler made *before any work existed*.
    # Nothing here means "the export failed" — a job's own failure is an
    # outcome on the socket, not a response to the request that queued it.
    "NS-JOB-5001": 503,  # no slot; nothing was started, so submitting again is safe
    "NS-JOB-5002": 503,  # the kind's circuit breaker is open, so it is disabled
    "NS-JOB-5006": 409,  # cancelling a job that has already stopped
    "NS-JOB-5007": 500,  # a job body that cannot cross the process boundary
    "NS-JOB-5008": 503,  # the job history could not be written or read
}


def status_for(error: NovaError) -> int | None:
    """The status this code is served as, or `None` to let severity decide."""
    return STATUS_FOR_CODE.get(error.code)


def _description_for(status: int) -> str:
    """What each failure means here, in the words the schema should use."""
    return {
        401: "No session token, or the wrong one.",
        403: "A Host or Origin that is not this session's loopback address.",
        404: "No such endpoint.",
        409: "The request was refused; the body says why, and whether to retry.",
        416: "The requested range is no longer retained; refetch the state.",
        422: "The request did not match the endpoint's schema.",
        500: "An unexpected error; the body names the exception.",
    }.get(status, "Request failed.")


__all__ = [
    "ERROR_STATUSES",
    "PROBLEM_MEDIA_TYPE",
    "STATUS_FOR_CODE",
    "UNPROCESSABLE_ENTITY",
    "error_responses",
    "install_error_handlers",
    "problem_body",
    "problem_response",
    "respond",
    "status_for",
]

#: The media type every error response uses, success or failure.
PROBLEM_MEDIA_TYPE: str = "application/problem+json"

#: What FastAPI calls a validation error, in the vocabulary the frontend already
#: speaks. A field the client sent that we refuse is a client mistake, not a
#: server fault, and reporting it as `500` would send an operator looking for a
#: crash that never happened.
_VALIDATION_CODE: str = "NS-VALIDATION-4220"

#: 422, written out: Starlette renamed this constant (`..._UNPROCESSABLE_ENTITY`
#: to `..._UNPROCESSABLE_CONTENT`) and the number is what the protocol defines
#: and what the frontend matches on, so there is nothing to gain from a name
#: that has changed once already.
UNPROCESSABLE_ENTITY: Final[int] = 422

#: What an unhandled exception becomes. A `NovaError` never reaches here — it
#: travels inside a `Result`, and :func:`respond` is what turns it into a
#: response — so anything arriving at this handler is a bug, and the body says so.
_UNHANDLED_CODE: str = "NS-TRANSPORT-5000"


def problem_body(problem: Any) -> dict[str, Any]:
    """Flatten a `ProblemDetail` into one JSON object.

    RFC 9457 puts extension members at the top level beside `type` and `title`,
    which is why `extensions` is spread rather than nested: a client reads
    `body["code"]`, not `body["extensions"]["code"]`, and the extra hop is where
    a code usually gets lost.
    """
    body: dict[str, Any] = {
        "type": problem.type,
        "title": problem.title,
        "status": problem.status,
        "detail": problem.detail,
        "code": problem.code,
        "domain": problem.domain,
        "severity": problem.severity,
        "retryable": problem.retryable,
    }
    if problem.instance is not None:
        body["instance"] = problem.instance
    if problem.remedy is not None:
        body["remedy"] = problem.remedy
    if problem.cause is not None:
        body["cause"] = problem.cause
    body.update(problem.extensions)
    return body


def problem_response(
    error: NovaError, *, instance: str | None = None, status: int | None = None
) -> JSONResponse:
    """One `NovaError` as one `problem+json` response.

    Args:
        error: The refusal.
        instance: The path the failure happened on.
        status: An explicit status, used when the transport knows better than
            the severity — "there is no such open project" is a 404 however
            severely the domain regards it.
    """
    problem = error.to_problem(instance=instance)
    return JSONResponse(
        status_code=problem.status if status is None else status,
        content=problem_body(problem),
        media_type=PROBLEM_MEDIA_TYPE,
    )


def respond(
    result: Result[Any],
    *,
    to_body: Callable[[Any], Any] | None = None,
    status_code: int = status.HTTP_200_OK,
    instance: str | None = None,
    status_for: Callable[[NovaError], int | None] | None = None,
) -> JSONResponse:
    """Map a `Result` onto a response, in the one shape the frontend parses.

    Args:
        result: What a service returned.
        to_body: How to serialise the success half. A router supplies this
            rather than the caller building a body and losing the `Result`.
        status_code: The status for the success half — `201` for a create.
        instance: The request path, echoed into the problem body on failure.
        status_for: Optional per-code status override, for the cases where the
            transport and not the domain knows which status is truthful.

    Returns:
        A `200`/`201` with the serialised value, or a `problem+json` response
        carrying the error's own severity-derived status.
    """
    problem = result.error()
    if problem is not None:
        override = status_for(problem) if status_for is not None else None
        return problem_response(problem, instance=instance, status=override)
    body = to_body(result.unwrap()) if to_body is not None else None
    return JSONResponse(status_code=status_code, content=_as_content(body))


def _as_content(body: Any) -> Any:
    """A pydantic DTO as JSON-ready data; anything else untouched.

    Routers hand :func:`respond` a DTO from a mapper rather than a dict they
    built, because a body built by hand is a second definition of the contract.
    Dumping it here means every router does not have to remember `.model_dump`,
    and the one that forgets does not ship a 500.
    """
    dumper = getattr(body, "model_dump", None)
    return dumper(mode="json") if callable(dumper) else body


def _validation_problem(request: Request, error: RequestValidationError) -> dict[str, Any]:
    """A request that did not match the schema, as a problem with the field names."""
    fields = [
        {
            "field": ".".join(str(part) for part in item.get("loc", ())[1:]) or "body",
            "message": item.get("msg", ""),
            "kind": item.get("type", ""),
        }
        for item in error.errors()
    ]
    return {
        "type": f"https://nova.studio/errors/{_VALIDATION_CODE}",
        "title": "Validation error",
        "status": UNPROCESSABLE_ENTITY,
        "detail": "the request did not match the endpoint's schema",
        "instance": str(request.url.path),
        "code": _VALIDATION_CODE,
        "domain": ErrorDomain.VALIDATION.value,
        "severity": ErrorSeverity.WARNING.value,
        "retryable": False,
        "fields": fields,
    }


def install_error_handlers(app: FastAPI) -> None:
    """Make every error this application can return speak `problem+json`.

    Three handlers for the three ways a request can fail *here*: the URL or
    method was wrong (Starlette's `HTTPException`), the body did not match the
    schema (`RequestValidationError`), or a bug raised something we did not
    expect. All three are answers to the frontend, so all three look like answers
    from the same application.

    A `NovaError` is deliberately **not** among them: it is a value, not an
    exception, it arrives inside a `Result`, and :func:`respond` is what maps it.
    Registering a handler for it would imply the opposite — that services raise
    their refusals across the wire.
    """

    @app.exception_handler(StarletteHTTPException)
    async def _on_http_error(request: Request, error: StarletteHTTPException) -> JSONResponse:
        status_code = error.status_code
        detail = error.detail if isinstance(error.detail, str) else "request failed"
        body = {
            "type": f"https://nova.studio/errors/http-{status_code}",
            "title": _title_for_status(status_code),
            "status": status_code,
            "detail": detail,
            "instance": str(request.url.path),
            "code": f"NS-TRANSPORT-{status_code}",
            "domain": ErrorDomain.TRANSPORT.value,
            "severity": ErrorSeverity.WARNING.value
            if status_code < 500
            else ErrorSeverity.ERROR.value,
            "retryable": status_code >= 500,
        }
        response = JSONResponse(
            status_code=status_code, content=body, media_type=PROBLEM_MEDIA_TYPE
        )
        # Whatever the raiser attached travels with the response: `WWW-Authenticate`
        # on a 401 is what tells a client *how* to authenticate, and `Retry-After`
        # on a 429 is the entire point of sending one.
        for name, value in (error.headers or {}).items():
            response.headers[name] = value
        return response

    @app.exception_handler(RequestValidationError)
    async def _on_validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=UNPROCESSABLE_ENTITY,
            content=_validation_problem(request, error),
            media_type=PROBLEM_MEDIA_TYPE,
        )

    @app.exception_handler(Exception)
    async def _on_unhandled(request: Request, error: Exception) -> JSONResponse:
        # A desktop application fails in front of one user, whose only route to a
        # bug report is the message on the screen — so the body names the
        # exception. The traceback goes to the log, not to the client.
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "type": f"https://nova.studio/errors/{_UNHANDLED_CODE}",
                "title": "Unexpected error",
                "status": status.HTTP_500_INTERNAL_SERVER_ERROR,
                "detail": f"{type(error).__name__}: {error}",
                "instance": str(request.url.path),
                "code": _UNHANDLED_CODE,
                "domain": ErrorDomain.TRANSPORT.value,
                "severity": ErrorSeverity.CRITICAL.value,
                "retryable": False,
            },
            media_type=PROBLEM_MEDIA_TYPE,
        )


def _title_for_status(status_code: int) -> str:
    """A short title for the status, so the UI never has to render a number."""
    return {
        400: "Bad request",
        401: "Not authenticated",
        403: "Not permitted",
        404: "Not found",
        405: "Method not allowed",
        409: "Conflict",
        413: "Too large",
        429: "Too many requests",
    }.get(status_code, "Server error" if status_code >= 500 else "Request failed")
