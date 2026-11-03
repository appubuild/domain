"""L3 — where the timeline being edited lives.

A command has to change *something*.  If it changed a `Timeline` it was handed,
the caller would have to thread the result back out through every layer; if it
changed an attribute on the editor, the editor would become a god object.  So
the one piece of mutable state an editing session needs gets exactly one small
home: a holder for one frozen value.

That is all this is — `TimelineStore` holds a `Timeline` and hands out a
replacement.  It is deliberately *not* a repository (no I/O, no persistence;
`services/projects` owns the file) and *not* a view model (no events, no
selection; the frontend keeps its own).  It is the answer to "which timeline is
the user editing?", which is a question with exactly one answer per open project
and no business being answered in six places.

The value is frozen and replaced wholesale: there is no way to mutate a
`Timeline` in place, so a snapshot taken before a command is a valid undo delta
and a snapshot handed to a render worker cannot change underneath it (ADR-0008
§2, ADR-0002 rule 3).

Why ``ctx.services`` and not a dedicated field
----------------------------------------------
``core.commands.CommandContext`` predates this feature and carries ``services:
Any`` precisely so a command can find the service it needs without ``core``
importing L3.  A command looks for its store there and reports a structured
``NS-COMMAND-4101`` if it is missing, rather than crashing with an
``AttributeError`` three layers down.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from nova_studio.core.commands import CommandContext
    from nova_studio.domain.timeline import Timeline

__all__ = ["TimelineStore", "timeline_store"]


@dataclass(slots=True)
class TimelineStore:
    """The timeline being edited: one mutable holder for one frozen value.

    ``timebase`` is not duplicated here — it lives on the `Timeline`, because a
    project can change rate and the store must never be the second place that
    knows.
    """

    timeline: Timeline

    def current(self) -> Timeline:
        """The timeline as it stands."""
        return self.timeline

    def replace(self, timeline: Timeline) -> Timeline:
        """Swap in a new timeline and return the one it displaced.

        Returning the previous value is what lets a caller hold the state it
        needs for a rollback without fetching it twice — the shape every
        command's failure path uses.
        """
        previous = self.timeline
        self.timeline = timeline
        return previous

    def reset(self, timeline: Timeline) -> None:
        """Start editing a different timeline (a project open or a revert).

        History is *not* cleared by this: it belongs to `TimelineEditor`, which
        knows about undo and this store does not.
        """
        self.timeline = timeline


def timeline_store(ctx: CommandContext) -> TimelineStore | None:
    """The store on ``ctx``, or ``None`` when the context is not an editing one.

    ``None`` rather than a raised error, because "this context cannot edit a
    timeline" is a state a caller must be able to report as a command failure
    with a code the frontend understands.
    """
    services = ctx.services
    return services if isinstance(services, TimelineStore) else None
