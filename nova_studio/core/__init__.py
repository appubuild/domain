"""L1 — the infrastructure-agnostic kernel of Nova Studio.

This package knows nothing about video editing.  It provides the five mechanisms
the rest of the system is built from (ARCHITECTURE.md §5):

``events``
    Typed in-process publish/subscribe with sync, queued and outbox delivery.
``di``
    An explicit dependency-injection container with three lifetimes and
    registration-time cycle detection.
``commands``
    The command pattern, per-scope undo/redo and gesture coalescing.
``result`` / ``errors``
    Expected failure as a value; invariant violation as an exception.  Stable
    ``NS-<DOMAIN>-<NNNN>`` error codes cross the API boundary.
``temporal``
    Frame-accurate time: exact rational timebases, SMPTE drop-frame timecode and
    explicitly-rounded conversions (ADR-0006).
``ident``
    Time-ordered UUIDv7 entity ids and human-quotable short ids.

Import rule (ADR-0002): nothing here may import ``nova_studio.domain``,
``nova_studio.ports``, ``nova_studio.services``, ``nova_studio.infra`` or
``nova_studio.api``.  ``scripts/check_layering.py`` fails the build otherwise.
"""

from __future__ import annotations

from nova_studio.core.clock import (
    DEFAULT_CLOCK,
    FixedClock,
    MonotonicClock,
    SystemClock,
    WallClock,
    monotonic_seconds,
    wall_milliseconds,
)
from nova_studio.core.commands import (
    Command,
    CommandContext,
    CommandError,
    CommandHistory,
    CommandOutcome,
    CommandRegistry,
    CommandScopeState,
    CompositeCommand,
    MemoryClass,
    UndoScope,
    UndoStack,
)
from nova_studio.core.di import (
    ContainerError,
    DependencyGraphError,
    Lifetime,
    Registration,
    ResolutionError,
    Resolver,
    ServiceContainer,
    ServiceScope,
)
from nova_studio.core.errors import (
    DocumentCorruptionError,
    ErrorDomain,
    ErrorSeverity,
    LayerViolationError,
    NovaError,
    NovaInvariantError,
    ProblemDetail,
)
from nova_studio.core.events import (
    AsyncEventStream,
    DeliveryMode,
    EventBus,
    EventEnvelope,
    EventHandler,
    EventPayload,
    EventStatistics,
    Subscription,
    TopicLike,
)
from nova_studio.core.ident import (
    CLOCK_SEQ_BITS,
    EntityId,
    IdFactory,
    ShortId,
    is_valid_entity_id,
    new_entity_id,
    new_short_id,
    process_token,
    random_suffix,
)
from nova_studio.core.result import (
    Err,
    Ok,
    Result,
    ResultUnwrapError,
    catch_errors,
    collect,
    collect_all,
    err,
    error_result,
    failed,
    ok,
    unwrap_all,
)
from nova_studio.core.temporal import (
    AUDIO_SAMPLE_RATES,
    DEFAULT_AUDIO_SAMPLE_RATE,
    DEFAULT_TIMEBASE,
    STANDARD_TIMEBASES,
    FrameCount,
    Rational,
    Rounding,
    SampleCount,
    Timebase,
    Timecode,
    TimecodeParseError,
    frames_to_samples,
    frames_to_seconds,
    seconds_to_frames,
    timebase_from_fps,
)

__all__ = [
    "AUDIO_SAMPLE_RATES",
    "CLOCK_SEQ_BITS",
    "DEFAULT_AUDIO_SAMPLE_RATE",
    "DEFAULT_CLOCK",
    "DEFAULT_TIMEBASE",
    "STANDARD_TIMEBASES",
    "AsyncEventStream",
    "Command",
    "CommandContext",
    "CommandError",
    "CommandHistory",
    "CommandOutcome",
    "CommandRegistry",
    "CommandScopeState",
    "CompositeCommand",
    "ContainerError",
    "DeliveryMode",
    "DependencyGraphError",
    "DocumentCorruptionError",
    "EntityId",
    "Err",
    "ErrorDomain",
    "ErrorSeverity",
    "EventBus",
    "EventEnvelope",
    "EventHandler",
    "EventPayload",
    "EventStatistics",
    "FixedClock",
    "FrameCount",
    "IdFactory",
    "LayerViolationError",
    "Lifetime",
    "MemoryClass",
    "MonotonicClock",
    "NovaError",
    "NovaInvariantError",
    "Ok",
    "ProblemDetail",
    "Rational",
    "Registration",
    "ResolutionError",
    "Resolver",
    "Result",
    "ResultUnwrapError",
    "Rounding",
    "SampleCount",
    "ServiceContainer",
    "ServiceScope",
    "ShortId",
    "Subscription",
    "SystemClock",
    "Timebase",
    "Timecode",
    "TimecodeParseError",
    "TopicLike",
    "UndoScope",
    "UndoStack",
    "WallClock",
    "catch_errors",
    "collect",
    "collect_all",
    "err",
    "error_result",
    "failed",
    "frames_to_samples",
    "frames_to_seconds",
    "is_valid_entity_id",
    "monotonic_seconds",
    "new_entity_id",
    "new_short_id",
    "ok",
    "process_token",
    "random_suffix",
    "seconds_to_frames",
    "timebase_from_fps",
    "unwrap_all",
    "wall_milliseconds",
]
