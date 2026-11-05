"""L4 — the render DTOs: what the preview panel asks for and gets back.

Two shapes, for two different jobs:

**The frame endpoint answers in bytes.** A preview frame is a picture, and a
picture wrapped in JSON is a base64 string a third larger, decoded on the main
thread of a UI that is already busy. So that endpoint returns `image/jpeg` with
the geometry in *headers* — scale, offset, size and gaps — which is what the
panel needs and the only part of a frame a human reads.

**Everything else answers in JSON.** Warming and invalidation are verbs, and a
verb that returned an image would be a verb with nowhere to say how many frames
it warmed or that three assets were offline.

Deliberately absent: a "render this range" request. That is an export, it is a
job (ADR-0010), and it belongs to the export surface — a preview endpoint that
blocked for nine minutes would be indistinguishable from a hang.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "PreviewCacheResponse",
    "PreviewWarmRequest",
    "PreviewWarmResponse",
]


class _Strict(BaseModel):
    """The base every render DTO gets: strict, frozen, self-documenting."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class PreviewWarmRequest(_Strict):
    """ "Have these frames ready" — the difference between scrubbing and not.

    Warming is a separate request rather than a side effect of asking for a
    frame, because it is work the user has not asked to see: doing it inside the
    frame request would add the latency of fifteen decodes to the one frame the
    user is waiting for, and a panel that scrubs backwards would pay for frames
    it is leaving behind.
    """

    frame: int = Field(
        default=0,
        ge=0,
        description="The playhead. The frame after it is the first one warmed.",
    )
    count: int | None = Field(
        default=None,
        ge=0,
        description="How many frames ahead. The session's default when omitted.",
    )


class PreviewWarmResponse(_Strict):
    """How much of the future is now in hand."""

    frame: int = Field(description="The playhead this warming started from.")
    warmed: int = Field(
        description=(
            "How many frames were decoded. Zero at the end of a timeline, which "
            "is the one place where warming legitimately does nothing."
        )
    )
    cached_bytes: int = Field(description="How much decoded picture is held.")
    open_sources: int = Field(description="How many decoders are open.")
    seeks: int = Field(
        description=(
            "How many reads the pool has started. One per clip per run is "
            "healthy; one per frame is a bug report."
        )
    )
    gaps: list[str] = Field(
        default_factory=list,
        description="Assets that could not be decoded, by id.",
    )


class PreviewCacheResponse(_Strict):
    """The answer to "forget what you decoded"."""

    cleared: bool = Field(description="Whether the pictures were dropped.")
    cached_bytes: int = Field(description="How much decoded picture is held now.")
    open_sources: int = Field(
        description=(
            "How many decoders are still open. Clearing the cache keeps them: "
            "an edit changes the timeline, not the files."
        )
    )
