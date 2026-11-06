"""L4 — the event DTOs: the WebSocket's frames, and the REST read behind them.

The socket carries one envelope shape and six kinds of frame, so this module is
small on purpose: it is the *wire*, not the domain. `core/events.py` owns the
envelope and `domain/` owns what a payload means; what belongs here is only what
a client in another language has to be able to parse.

Two rules earn the file's keep:

* **A frame a client does not understand is ignored, not fatal.** The types here
  are a closed set the client switches on, and a future frame is one it has
  never heard of — so the client must be able to skip it and keep the socket.
  The payload is therefore `dict[str, Any]` rather than a union of today's
  payload types: a union would make an unknown payload a parse error, and an
  unknown payload is the ordinary case for a client one version behind.
* **`complete` is never implied.** A replay that could not reach back far enough
  says so, because a partial history presented as complete is a UI showing a
  state that never existed (`ws.py`).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "EVENT",
    "GOODBYE",
    "HEARTBEAT",
    "HELLO",
    "PONG",
    "RESYNC",
    "EventEnvelopeWire",
    "RecentEventsResponse",
]


class _Strict(BaseModel):
    """The base every event DTO gets: strict, frozen, self-documenting."""

    model_config = ConfigDict(extra="forbid", frozen=True)


#: The frame kinds, as strings rather than an enum: they cross into TypeScript,
#: where a union of string literals is the same closed set and one that reads
#: the same in both languages.
HELLO: str = "hello"
EVENT: str = "event"
HEARTBEAT: str = "heartbeat"
PONG: str = "pong"
GOODBYE: str = "goodbye"
RESYNC: str = "resync"


class EventEnvelopeWire(_Strict):
    """One event, exactly as the socket sends it.

    `payload` is a free object because the bus can carry any payload, and a
    client that refused to parse an unknown one would be a client that drops
    the socket the first time the backend learns a new topic.
    """

    #: Always `"event"`, and present so this read is the same shape as the
    #: socket: a client can parse one and the other with the same code, which
    #: is the promise the endpoint makes.
    type: Literal["event"] = Field(default="event", description="The frame kind.")
    topic: str = Field(description="Dot-namespaced, e.g. `timeline.clip.moved`.")
    seq: int = Field(description="Monotonic per session; a gap here is lost events.")
    ts: int = Field(description="Publication time, unix milliseconds.")
    payload: dict[str, Any] | None = Field(
        default=None, description="The event's body; its shape follows the topic."
    )
    source: str | None = Field(
        default=None, description="Which subsystem published it, for diagnostics."
    )
    command_id: str | None = Field(
        default=None,
        description="The command that produced it, so a client can match its optimistic update.",
    )


class RecentEventsResponse(_Strict):
    """The tail of the history, as the socket would have sent it.

    The numbers around the events are the point: without `oldest_seq` a client
    cannot tell "nothing has happened" from "history forgot", and a client that
    cannot tell those apart will show the first as the second.
    """

    # Required rather than defaulted: a history read with no `events` key is a
    # client that cannot tell "nothing happened" from "the field was missing",
    # and an optional list is a list every caller has to default again.
    events: list[EventEnvelopeWire] = Field(
        description="The envelopes after `since`, oldest first."
    )
    last_seq: int = Field(description="Newest sequence in the session; 0 when nothing yet.")
    oldest_seq: int | None = Field(
        default=None, description="Oldest sequence still retained; null when nothing is."
    )
    count: int = Field(description="How many envelopes are in `events`.")
