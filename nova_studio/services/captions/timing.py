"""L3 — the two arithmetic rules every caption stage needs.

They are here, and not in the stage that happened to need them first, because
they are *rules* rather than steps: the minimum a cue is held on screen, and
the rate at which a cue is read. Two stages apply them — the Break stage when it
groups words, and the builder when it turns a transcript into cues — and a rule
that lives twice is a rule that drifts.

Both are stated so they hold at the edges: a zero-length cue reads as
infinitely fast rather than dividing by zero, and a held cue is never left with
no duration at all.
"""

from __future__ import annotations

__all__ = ["chars_per_second", "held_until"]


def chars_per_second(text: str, start_ms: int, end_ms: int) -> float:
    """How fast ``text`` would have to be read between two instants.

    Characters per second is the only measure that predicts whether something
    can be read (ADR-0009 §2): a twenty-character line is fine in two seconds
    and impossible in half of one.
    """
    duration = end_ms - start_ms
    if duration <= 0:
        return float("inf")
    return len(text) * 1000.0 / duration


def held_until(
    start_ms: int,
    end_ms: int,
    *,
    min_duration_ms: int,
    next_start: int | None = None,
) -> int:
    """When a cue that starts at ``start_ms`` should stop being shown.

    A cue the eye cannot land on is worse than a slightly late one, so a cue
    shorter than ``min_duration_ms`` is lengthened. Three rules keep that from
    becoming the bug where captions pile up on top of each other:

    * **Forwards only.** A cue starts when its words were spoken; moving its
      start would desynchronise it from the audio, which is the one thing a
      viewer notices before anything else.
    * **Never into the next cue.** ``next_start`` clips the extension, so a
      lengthened cue stops where the following one begins rather than covering
      it.
    * **Never nothing.** A cue kept short by its neighbour still lasts one
      millisecond, because a zero-duration cue is invisible and would divide by
      zero everywhere downstream.
    """
    if end_ms - start_ms < min_duration_ms:
        end_ms = start_ms + min_duration_ms
        if next_start is not None:
            end_ms = min(end_ms, next_start)
    return max(end_ms, start_ms + 1)
