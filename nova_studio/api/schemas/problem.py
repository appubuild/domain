"""L4 — the error DTO, for the contract as much as for the wire.

Every failure this service returns is an RFC 9457 `problem+json` document, and
the frontend generates its client from the OpenAPI schema — so if the schema says
a 422 is FastAPI's `HTTPValidationError` while the wire says `problem+json`, the
generated client is a liar, and the frontend ends up with two error parsers,
which is the exact drift `api/errors.py` exists to prevent.

Defining the body once, as a pydantic model, and pointing every route's error
responses at it is what keeps the two honest.

`extra="allow"` here and nowhere else, deliberately: the sibling DTOs forbid
unknown fields because a client sending one is either broken or newer than we
are. An RFC 9457 document is the opposite case — extension members are the
mechanism the standard provides for carrying context (`clip_id`, `asset_id`,
`frame`), and forbidding them would break the very thing they are for.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

__all__ = ["ProblemResponse", "ValidationField"]


class ValidationField(BaseModel):
    """One field of a request that did not match the schema.

    Named rather than positional in the payload because the frontend maps these
    onto form fields, and a string it has to parse is a string it will parse
    differently in two places.
    """

    model_config = ConfigDict(frozen=True)

    field: str = Field(description="Dotted path of the offending field within the request.")
    message: str = Field(description="What is wrong with it, as pydantic reported it.")
    kind: str = Field(description="Machine-readable error type, e.g. `greater_than_equal`.")


class ProblemResponse(BaseModel):
    """The body of every failure, in the one shape the frontend parses.

    `code` and `title` say *what kind of thing went wrong* and are what the UI
    localises from; `detail`, `remedy` and the extension members say *what
    happened this time*, and are for the log line and the toast.
    """

    model_config = ConfigDict(extra="allow", frozen=True)

    type: str = Field(description="Stable URI identifying the problem type.")
    title: str = Field(description="Short human-readable summary, localised by the frontend.")
    status: int = Field(description="HTTP status, echoed so a logged body is self-contained.")
    detail: str = Field(description="What happened this time, for the log line and the toast.")
    code: str = Field(
        description="Stable machine code, e.g. `NS-TRANSPORT-404`; the localisation key."
    )
    domain: str = Field(description="Subsystem that produced the error.")
    severity: str = Field(
        description="`warning` (toast), `error` (banner) or `critical` (blocking)."
    )
    retryable: bool = Field(
        description="Whether the same operation may succeed if attempted again."
    )
    instance: str | None = Field(default=None, description="Path of the request that failed.")
    remedy: str | None = Field(default=None, description="What the user can do about it.")
    fields: list[ValidationField] | None = Field(
        default=None, description="Per-field detail, for a request that failed validation."
    )
