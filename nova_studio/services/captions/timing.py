"""L3 — the two arithmetic rules every caption stage needs.

They are here, and not in the stage that happened to need them first, because
they are *rules* rather than steps: **how long a cue is held**, and **how fast a
cue is read**. Three callers apply them — the breaker when it groups words, the
builder when it turns a transcript into cues, and the stretch that keeps a cue
on screen long enough — and a rule that lives three times is a rule that drifts.

Both are stated so they hold at the edges: a zero-length cue reads as
infinitely fast rather than dividing by zero, and a held cue is never left with
no duration at all.

Both count **graphemes**, not code points: one emoji, one accented letter and
one CJK glyph are each one character to a reader, and a rule that counted "é" as
two would hold a French caption twice as long as it needs.
"""

from __future__ import annotations

import math

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.captions import graphemes

__all__ = ["chars_per_second", "held_until", "time_to_read"]


def chars_per_second(text: str, start_ms: int, end_ms: int) -> float:
    """How fast ``text`` would have to be read between two instants.

    Characters per second is the only measure that predicts whether something
    can be read (ADR-0009 §2): a twenty-character line is comfortable in two
    seconds and impossible in half of one. It is also the measure that catches
    the failure no other rule sees — a fast speaker producing a perfectly-sized
    six-second cue containing nine words nobody can finish.
    """
    duration = end_ms - start_ms
    if duration <= 0:
        return float("inf")
    return len(graphemes(text)) * 1000.0 / duration


def time_to_read(text: str, max_reading_rate_cps: float) -> int:
    """Milliseconds ``text`` needs on screen, at the reading-rate ceiling.

    Rounded **up**, because a cue that is one millisecond short of readable is
    not readable.
    """
    if max_reading_rate_cps <= 0:
        raise NovaInvariantError(
            f"max_reading_rate_cps must be positive, got {max_reading_rate_cps}"
        )
    return math.ceil(len(graphemes(text)) / max_reading_rate_cps * 1000)


def held_until(
    start_ms: int,
    end_ms: int,
    *,
    min_duration_ms: int,
    next_start: int | None = None,
    max_duration_ms: int | None = None,
) -> int:
    """When a cue starting at ``start_ms``, whose words end at ``end_ms``, leaves.

    A cue the eye cannot land on is worse than a slightly late one, so a cue
    shorter than ``min_duration_ms`` is held longer. Four rules keep that from
    becoming the bug where captions pile up on top of each other:

    * **It only ever extends.** A cue starts when its words were spoken; moving
      its start would desynchronise it from the audio, which is the one thing a
      viewer notices before anything else.
    * **Never into the next cue.** ``next_start`` bounds the extension, so a
      lengthened cue stops where the following one begins rather than covering
      it.
    * **Never past the cap.** ``max_duration_ms`` bounds it the other way: a
      single word said slowly is a cue of its own, and holding it for a second
      anyway would outstay the shot.
    * **Never nothing.** A cue squeezed by both bounds still lasts a
      millisecond, because a zero-duration cue is invisible and divides by zero
      everywhere downstream.
    """
    extension = start_ms + min_duration_ms
    if next_start is not None:
        extension = min(extension, next_start)
    if max_duration_ms is not None:
        extension = min(extension, start_ms + max_duration_ms)
    return max(end_ms, extension, start_ms + 1)
