"""The ``Result`` type: expected failure as a value (ARCHITECTURE.md §5.5).

``Result[T]`` is ``Ok[T] | Err``.  It is used for every failure a user can act on
— an unsupported codec, a missing asset, a cancelled job, a rejected validation.
Invariant violations (bugs, corrupt documents) raise
:class:`~nova_studio.core.errors.NovaInvariantError` instead and are *not*
modelled here.

Why a hand-rolled Result rather than exceptions
-----------------------------------------------
1. **Exhaustiveness.**  A service returning ``Result`` cannot be called without the
   author seeing that failure is possible.  Exceptions are invisible in a signature.
2. **Composition.**  Pipelines such as the caption engine (§8) are sequences of
   stages that must short-circuit cleanly and report *which* stage failed.
   ``and_then`` expresses that without nested ``try`` blocks.
3. **Cross-boundary stability.**  A ``Result`` is trivially serialisable onto the
   event bus and the WebSocket channel; an exception is not.

The classes are frozen and slot-based; ``Ok`` carries no allocation beyond the
value itself, so using ``Result`` on a hot path costs one small object.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import wraps
from typing import TYPE_CHECKING, Any, Generic, NoReturn, TypeAlias, TypeVar, overload

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence

from nova_studio.core.errors import (
    ErrorDomain,
    ErrorSeverity,
    NovaError,
    NovaInvariantError,
)

__all__ = [
    "Err",
    "Ok",
    "Result",
    "ResultUnwrapError",
    "catch_errors",
    "collect",
    "collect_all",
    "err",
    "error_result",
    "failed",
    "ok",
    "unwrap_all",
]

T = TypeVar("T")
U = TypeVar("U")
E = TypeVar("E", bound=NovaError)


@dataclass(frozen=True, slots=True)
class Ok(Generic[T]):
    """A successful result carrying a value."""

    value: T

    # -- predicates --------------------------------------------------------

    def is_ok(self) -> bool:
        """Always ``True`` for :class:`Ok`."""
        return True

    def is_err(self) -> bool:
        """Always ``False`` for :class:`Ok`."""
        return False

    # -- access ------------------------------------------------------------

    def unwrap(self) -> T:
        """Return the value."""
        return self.value

    def unwrap_or(self, default: T) -> T:
        """Return the value; ``default`` is ignored."""
        return self.value

    def unwrap_or_else(self, factory: Callable[[], T]) -> T:
        """Return the value; ``factory`` is never called."""
        return self.value

    def unwrap_err(self) -> NoReturn:
        """Always raises: an :class:`Ok` has no error."""
        raise NovaInvariantError("unwrap_err called on Ok")

    def error(self) -> None:
        """``None`` for a successful result."""
        return

    # -- transformation ----------------------------------------------------

    def map(self, transform: Callable[[T], U]) -> Result[U]:
        """Apply ``transform`` to the value."""
        return Ok(transform(self.value))

    def map_err(self, transform: Callable[[NovaError], NovaError]) -> Result[T]:
        """No-op for :class:`Ok`; present for symmetry with :class:`Err`."""
        return self

    def and_then(self, bind: Callable[[T], Result[U]]) -> Result[U]:
        """Chain another fallible operation onto this value."""
        return bind(self.value)

    def or_else(self, fallback: Callable[[NovaError], Result[T]]) -> Result[T]:
        """No-op for :class:`Ok`."""
        return self

    # -- interop -----------------------------------------------------------

    def __iter__(self) -> Iterator[T]:
        """Allow ``if (value := result) is not None`` style unpacking in loops."""
        yield self.value

    def __bool__(self) -> bool:
        """An :class:`Ok` is always truthy."""
        return True

    def to_dict(self) -> dict[str, Any]:
        """Serialise as ``{"ok": value}``."""
        return {"ok": self.value}


@dataclass(frozen=True, slots=True)
class Err(Generic[T]):
    """A failed result carrying a structured :class:`NovaError`."""

    error_value: NovaError

    # -- predicates --------------------------------------------------------

    def is_ok(self) -> bool:
        """Always ``False`` for :class:`Err`."""
        return False

    def is_err(self) -> bool:
        """Always ``True`` for :class:`Err`."""
        return True

    # -- access ------------------------------------------------------------

    def unwrap(self) -> NoReturn:
        """Always raises, converting the error into an exception.

        Use only where failure genuinely cannot happen or must abort the process;
        prefer :meth:`unwrap_or` or explicit handling.
        """
        raise ResultUnwrapError(self.error_value)

    def unwrap_or(self, default: T) -> T:
        """Return ``default``, discarding the error."""
        return default

    def unwrap_or_else(self, factory: Callable[[], T]) -> T:
        """Return ``factory()``, discarding the error."""
        return factory()

    def unwrap_err(self) -> NovaError:
        """Return the error."""
        return self.error_value

    def error(self) -> NovaError:
        """Return the error.  Preferred over :meth:`unwrap_err` for readability."""
        return self.error_value

    # -- transformation ----------------------------------------------------

    def map(self, transform: Callable[[T], U]) -> Result[U]:
        """Propagate the error without applying ``transform``."""
        return Err(self.error_value)

    def map_err(self, transform: Callable[[NovaError], NovaError]) -> Result[T]:
        """Transform the error, e.g. to add context about which stage failed."""
        return Err(transform(self.error_value))

    def and_then(self, bind: Callable[[T], Result[U]]) -> Result[U]:
        """Short-circuit: ``bind`` is never called."""
        return Err(self.error_value)

    def or_else(self, fallback: Callable[[NovaError], Result[T]]) -> Result[T]:
        """Attempt a recovery from this error."""
        return fallback(self.error_value)

    # -- interop -----------------------------------------------------------

    def __iter__(self) -> Iterator[T]:
        """Yield nothing, so ``for value in result`` skips failures."""
        return iter(())

    def __bool__(self) -> bool:
        """An :class:`Err` is always falsy, so ``if result:`` means success."""
        return False

    def to_dict(self) -> dict[str, Any]:
        """Serialise as ``{"err": {...}}`` using the error's own dict form."""
        return {"err": self.error_value.to_dict()}


Result: TypeAlias = Ok[T] | Err[T]


class ResultUnwrapError(RuntimeError):
    """Raised by :meth:`Err.unwrap`; wraps the underlying :class:`NovaError`."""

    def __init__(self, error: NovaError) -> None:
        self.error = error
        super().__init__(str(error))


def ok(value: T) -> Ok[T]:
    """Construct a successful result."""
    return Ok(value)


def err(error: NovaError) -> Err[Any]:
    """Construct a failed result.

    The return type is ``Err[Any]`` so that a single ``err(...)`` expression can be
    returned from functions with different success types without an annotation at
    every call site.  Callers that need precision can write ``Err[T](error)``.
    """
    return Err(error)


def error_result(
    code: str,
    message: str,
    *,
    domain: ErrorDomain | str = ErrorDomain.INTERNAL,
    severity: ErrorSeverity = ErrorSeverity.ERROR,
    details: Mapping[str, Any] | None = None,
    remedy: str | None = None,
    retryable: bool = False,
) -> Err[Any]:
    """Shorthand for building an :class:`Err` from its parts."""
    return Err(
        NovaError(
            code,
            message,
            domain=domain,
            severity=severity,
            details=details,
            remedy=remedy,
            retryable=retryable,
        )
    )


def collect(results: Iterable[Result[T]]) -> Result[list[T]]:
    """Combine many results into one.

    Fails fast on the first error, so the caller sees the earliest cause rather
    than an aggregate.  Use :func:`collect_all` when every failure matters.
    """
    values: list[T] = []
    for item in results:
        if item.is_err():
            return Err(item.unwrap_err())
        values.append(item.unwrap())
    return Ok(values)


def collect_all(results: Iterable[Result[T]]) -> Result[list[T]]:
    """Combine results, accumulating *every* error into one.

    The returned error keeps the first code and lists all failures in
    ``details["errors"]``, which is what validation UIs need: show the user all
    the problems at once, not one per submit.
    """
    values: list[T] = []
    failures: list[NovaError] = []
    for item in results:
        if item.is_err():
            failures.append(item.unwrap_err())
        else:
            values.append(item.unwrap())
    if not failures:
        return Ok(values)
    primary = failures[0]
    aggregated = primary.with_details(
        errors=[failure.to_dict() for failure in failures],
        error_count=len(failures),
    )
    return Err(aggregated)


def failed(error: NovaError) -> Err[Any]:
    """Alias of :func:`err` reading naturally in a ``return`` position.

    Because :class:`Err` is covariant in its (unused) success type, ``Err[Any]``
    is assignable to ``Result[T]`` for any ``T``.  Returning ``failed(...)`` from a
    function whose success type differs from the error's original context is
    therefore type-correct without a cast — this is what lets ``validate()`` return
    ``Result[None]`` and have its error forwarded by a caller returning
    ``Result[CommandOutcome]``.
    """
    return Err(error)


def unwrap_all(results: Sequence[Result[T]]) -> list[T]:
    """Unwrap a sequence, raising on the first error.  Test-support helper."""
    return [item.unwrap() for item in results]


@overload
def catch_errors(
    *,
    code: str,
    domain: ErrorDomain | str = ErrorDomain.INTERNAL,
    message: str | None = None,
    severity: ErrorSeverity = ErrorSeverity.ERROR,
    exceptions: tuple[type[BaseException], ...] = (Exception,),
) -> Callable[[Callable[..., T]], Callable[..., Result[T]]]: ...


@overload
def catch_errors(
    func: Callable[..., T],
    *,
    code: str,
    domain: ErrorDomain | str = ErrorDomain.INTERNAL,
    message: str | None = None,
    severity: ErrorSeverity = ErrorSeverity.ERROR,
    exceptions: tuple[type[BaseException], ...] = (Exception,),
) -> Callable[..., Result[T]]: ...


def catch_errors(
    func: Callable[..., T] | None = None,
    *,
    code: str,
    domain: ErrorDomain | str = ErrorDomain.INTERNAL,
    message: str | None = None,
    severity: ErrorSeverity = ErrorSeverity.ERROR,
    exceptions: tuple[type[BaseException], ...] = (Exception,),
) -> Any:
    """Adapt exception-raising code into a :class:`Result`-returning function.

    This is the *boundary* tool: it belongs around adapter calls into third-party
    libraries (PyAV, OpenCV, faster-whisper) that communicate failure by raising.
    Nova Studio's own code should return ``Result`` directly rather than being
    wrapped.

    ``NovaInvariantError`` and ``BaseException`` subclasses outside ``exceptions``
    propagate, so genuine bugs are never masked as expected failures.
    """

    def decorator(target: Callable[..., T]) -> Callable[..., Result[T]]:
        @wraps(target)
        def wrapper(*args: Any, **kwargs: Any) -> Result[T]:
            try:
                return Ok(target(*args, **kwargs))
            except exceptions as exc:
                text = message or f"{target.__qualname__} failed: {exc}"
                return Err(
                    NovaError(
                        code,
                        text,
                        domain=domain,
                        severity=severity,
                        details={"exception": type(exc).__name__},
                    ).caused_by(exc)
                )

        return wrapper

    if func is not None:
        return decorator(func)
    return decorator
