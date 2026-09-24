"""Error taxonomy for Nova Studio.

Two channels, deliberately separated (ARCHITECTURE.md §5.5):

* **Expected failure** is a value.  :mod:`nova_studio.core.result` carries it as
  ``Err(NovaError)`` so that callers must handle it.  Used for anything a user can
  act on: an unsupported codec, a missing file, a cancelled job.
* **Invariant violation** is an exception.  :class:`NovaInvariantError` and its
  subclasses signal a bug or a corrupted document, never a user mistake.

Every error carries a **stable machine code** of the form ``NS-<DOMAIN>-<NNNN>``.
Codes are part of the public contract: the frontend maps them to localised,
actionable messages ("HEVC 10-bit is not supported by your GPU decoder — switch to
software decoding"), support engineers search the log for them, and telemetry groups
by them.  A code is never reused and never changes meaning.
"""

from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING, Any, Self

if TYPE_CHECKING:
    from collections.abc import Mapping

__all__ = [
    "ErrorDomain",
    "ErrorSeverity",
    "NovaError",
    "NovaInvariantError",
    "ProblemDetail",
]


class ErrorDomain(StrEnum):
    """Subsystem that produced an error; the second segment of an error code."""

    CORE = "CORE"
    PROJECT = "PROJECT"
    MEDIA = "MEDIA"
    TIMELINE = "TIMELINE"
    RENDER = "RENDER"
    CAPTION = "CAPTION"
    EFFECT = "EFFECT"
    TRANSITION = "TRANSITION"
    TEXT = "TEXT"
    AUDIO = "AUDIO"
    COLOUR = "COLOUR"
    ANIMATION = "ANIMATION"
    PLUGIN = "PLUGIN"
    EXPORT = "EXPORT"
    TEMPLATE = "TEMPLATE"
    FONT = "FONT"
    SETTINGS = "SETTINGS"
    CACHE = "CACHE"
    AI = "AI"
    STORAGE = "STORAGE"
    TRANSPORT = "TRANSPORT"
    VALIDATION = "VALIDATION"
    PERMISSION = "PERMISSION"
    LICENCE = "LICENCE"
    UPDATE = "UPDATE"
    INTERNAL = "INTERNAL"


class ErrorSeverity(StrEnum):
    """How urgently an error should be surfaced.

    Drives the UI treatment and the log level, so that a benign, recoverable
    condition does not alarm the user while a data-loss risk always does.
    """

    #: Handled silently; recorded for diagnostics only.
    DEBUG = "debug"
    #: Worth recording; the user does not need to act.
    INFO = "info"
    #: Shown as a transient toast; the operation did not complete.
    WARNING = "warning"
    #: Shown as a modal or blocking banner; the user must act.
    ERROR = "error"
    #: Data integrity is at risk; the user must act immediately and is offered a
    #: recovery path.
    CRITICAL = "critical"


class NovaError:
    """A structured, user-actionable error value.

    Instances are immutable.  ``details`` is a free-form mapping used for
    programmatic context (asset ids, frame numbers, codec names); it must be
    JSON-serialisable because it crosses the API boundary.

    Attributes:
        code: Stable machine code, e.g. ``NS-MEDIA-4001``.
        domain: Subsystem that produced the error.
        message: Short human-readable summary in the developer locale.  The UI
            re-renders this from ``code`` + ``details`` using the localisation
            bundles; ``message`` is the fallback and the log-facing text.
        severity: How urgently this should be surfaced.
        details: JSON-serialisable context for diagnostics and localisation.
        remedy: Optional actionable hint shown next to the message.
        cause: Optional underlying error code or exception text, for chaining.
        retryable: Whether the same operation may succeed if attempted again.
    """

    __slots__ = (
        "_cause",
        "_code",
        "_details",
        "_domain",
        "_message",
        "_remedy",
        "_retryable",
        "_severity",
    )

    def __init__(
        self,
        code: str,
        message: str,
        *,
        domain: ErrorDomain | str = ErrorDomain.INTERNAL,
        severity: ErrorSeverity = ErrorSeverity.ERROR,
        details: Mapping[str, Any] | None = None,
        remedy: str | None = None,
        cause: str | None = None,
        retryable: bool = False,
    ) -> None:
        self._code = code
        self._message = message
        self._domain = ErrorDomain(domain) if not isinstance(domain, ErrorDomain) else domain
        self._severity = severity
        self._details: dict[str, Any] = dict(details) if details else {}
        self._remedy = remedy
        self._cause = cause
        self._retryable = retryable

    # -- accessors (read-only properties keep the value immutable) ---------

    @property
    def code(self) -> str:
        """Stable machine code, e.g. ``NS-MEDIA-4001``."""
        return self._code

    @property
    def domain(self) -> ErrorDomain:
        """Subsystem that produced the error."""
        return self._domain

    @property
    def message(self) -> str:
        """Short human-readable summary."""
        return self._message

    @property
    def severity(self) -> ErrorSeverity:
        """How urgently this should be surfaced."""
        return self._severity

    @property
    def details(self) -> dict[str, Any]:
        """JSON-serialisable diagnostic context."""
        return dict(self._details)

    @property
    def remedy(self) -> str | None:
        """Actionable hint for the user, if any."""
        return self._remedy

    @property
    def cause(self) -> str | None:
        """Underlying error code or exception text."""
        return self._cause

    @property
    def retryable(self) -> bool:
        """Whether retrying the same operation may succeed."""
        return self._retryable

    # -- transformations ---------------------------------------------------

    def with_details(self, **extra: Any) -> Self:
        """Return a copy with additional diagnostic details merged in."""
        return self.__class__(
            self._code,
            self._message,
            domain=self._domain,
            severity=self._severity,
            details={**self._details, **extra},
            remedy=self._remedy,
            cause=self._cause,
            retryable=self._retryable,
        )

    def with_remedy(self, remedy: str) -> Self:
        """Return a copy carrying a user-facing remedy hint."""
        return self.__class__(
            self._code,
            self._message,
            domain=self._domain,
            severity=self._severity,
            details=self._details,
            remedy=remedy,
            cause=self._cause,
            retryable=self._retryable,
        )

    def caused_by(self, cause: BaseException | str) -> Self:
        """Return a copy chained to an underlying exception or code."""
        text = cause if isinstance(cause, str) else f"{type(cause).__name__}: {cause}"
        return self.__class__(
            self._code,
            self._message,
            domain=self._domain,
            severity=self._severity,
            details=self._details,
            remedy=self._remedy,
            cause=text,
            retryable=self._retryable,
        )

    def escalated(self, severity: ErrorSeverity) -> Self:
        """Return a copy reported at a higher severity."""
        return self.__class__(
            self._code,
            self._message,
            domain=self._domain,
            severity=severity,
            details=self._details,
            remedy=self._remedy,
            cause=self._cause,
            retryable=self._retryable,
        )

    # -- serialisation -----------------------------------------------------

    def to_problem(self, *, instance: str | None = None) -> ProblemDetail:
        """Convert to an RFC 9457 ``problem+json`` payload."""
        return ProblemDetail(
            type=f"https://nova.studio/errors/{self._code}",
            title=self.title_for_code(),
            status=_status_for_severity(self._severity),
            detail=self._message,
            instance=instance,
            code=self._code,
            domain=self._domain.value,
            severity=self._severity.value,
            remedy=self._remedy,
            cause=self._cause,
            retryable=self._retryable,
            extensions=dict(self._details),
        )

    def title_for_code(self) -> str:
        """A terse title for the problem envelope, derived from the domain.

        RFC 9457 wants a short summary of the *problem type*, not of this
        instance; the instance detail lives in ``detail``.  The frontend replaces
        this with a localised title looked up from ``code``.
        """
        words = self._domain.value.lower().split("_")
        return f"{' '.join(words).capitalize()} error"

    def to_dict(self) -> dict[str, Any]:
        """Serialise for logs, telemetry and the event bus."""
        payload: dict[str, Any] = {
            "code": self._code,
            "domain": self._domain.value,
            "message": self._message,
            "severity": self._severity.value,
            "retryable": self._retryable,
        }
        if self._details:
            payload["details"] = dict(self._details)
        if self._remedy is not None:
            payload["remedy"] = self._remedy
        if self._cause is not None:
            payload["cause"] = self._cause
        return payload

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> NovaError:
        """Inverse of :meth:`to_dict`."""
        return cls(
            str(data["code"]),
            str(data.get("message", "")),
            domain=ErrorDomain(str(data.get("domain", ErrorDomain.INTERNAL.value))),
            severity=ErrorSeverity(str(data.get("severity", ErrorSeverity.ERROR.value))),
            details=data.get("details") or {},
            remedy=data.get("remedy"),
            cause=data.get("cause"),
            retryable=bool(data.get("retryable", False)),
        )

    # -- dunder ------------------------------------------------------------

    def __str__(self) -> str:
        base = f"[{self._code}] {self._message}"
        if self._cause:
            base = f"{base} (cause: {self._cause})"
        return base

    def __repr__(self) -> str:
        return (
            f"NovaError(code={self._code!r}, domain={self._domain.value!r}, "
            f"severity={self._severity.value!r}, message={self._message!r}, "
            f"details={self._details!r}, remedy={self._remedy!r}, "
            f"cause={self._cause!r}, retryable={self._retryable!r})"
        )

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, NovaError):
            return NotImplemented
        return self.to_dict() == other.to_dict()

    def __hash__(self) -> int:
        return hash(self._code)


def _status_for_severity(severity: ErrorSeverity) -> int:
    """Map severity onto an HTTP status for the ``problem+json`` envelope.

    The API layer may override this with the real transport status; the mapping
    exists so that an error surfaced off the request path (a job failure broadcast
    over WebSocket) still carries a meaningful status-like field.
    """
    return {
        ErrorSeverity.DEBUG: 200,
        ErrorSeverity.INFO: 200,
        ErrorSeverity.WARNING: 409,
        ErrorSeverity.ERROR: 422,
        ErrorSeverity.CRITICAL: 500,
    }[severity]


class ProblemDetail:
    """RFC 9457 ``application/problem+json`` payload with Nova extensions."""

    __slots__ = (
        "cause",
        "code",
        "detail",
        "domain",
        "extensions",
        "instance",
        "remedy",
        "retryable",
        "severity",
        "status",
        "title",
        "type",
    )

    def __init__(
        self,
        *,
        type: str,
        title: str,
        status: int,
        detail: str,
        instance: str | None = None,
        code: str,
        domain: str,
        severity: str,
        remedy: str | None = None,
        cause: str | None = None,
        retryable: bool = False,
        extensions: dict[str, Any] | None = None,
    ) -> None:
        self.type = type
        self.title = title
        self.status = status
        self.detail = detail
        self.instance = instance
        self.code = code
        self.domain = domain
        self.severity = severity
        self.remedy = remedy
        self.cause = cause
        self.retryable = retryable
        self.extensions = extensions or {}

    def to_dict(self) -> dict[str, Any]:
        """Serialise to the wire representation."""
        payload: dict[str, Any] = {
            "type": self.type,
            "title": self.title,
            "status": self.status,
            "detail": self.detail,
            "code": self.code,
            "domain": self.domain,
            "severity": self.severity,
            "retryable": self.retryable,
        }
        if self.instance is not None:
            payload["instance"] = self.instance
        if self.remedy is not None:
            payload["remedy"] = self.remedy
        if self.cause is not None:
            payload["cause"] = self.cause
        if self.extensions:
            payload["extensions"] = self.extensions
        return payload


class NovaInvariantError(AssertionError):
    """Base class for invariant violations — always a bug or a corrupt document.

    Subclasses ``AssertionError`` so that an invariant failure is never silently
    swallowed by a broad ``except Exception`` intended for expected failures, and
    so that ``pytest`` reports it distinctly.
    """

    def __init__(self, message: str, *, context: Mapping[str, Any] | None = None) -> None:
        self.context: dict[str, Any] = dict(context) if context else {}
        super().__init__(message)


class DocumentCorruptionError(NovaInvariantError):
    """A persisted document failed validation and cannot be trusted."""


class LayerViolationError(NovaInvariantError):
    """A layering rule from ADR-0002 was broken at runtime.

    Normally caught statically by ``scripts/check_layering.py``; raised at runtime
    only by the plugin audit hook when a plugin reaches past the SDK surface.
    """


class ConcurrentModificationError(NovaInvariantError):
    """Two writers attempted to mutate the same aggregate in one transaction."""
