"""L4 — the job event bridge: executor to bus, in one direction only.

The executor notifies :class:`~nova_studio.ports.jobs.JobObserver`s, which is
the port's own vocabulary and knows nothing about events, topics or sockets.
The frontend speaks the bus. This module is the two-sentence translation
between them, and it is the only place either side learns about the other.

```
    ConcurrentJobExecutor ──observer──▶ JobEventBridge ──publish──▶ EventBus ──▶ /api/v1/ws
```

**Topics**, named as ADR-0010 §3 and §5 name them:

| Topic | When | Payload |
| --- | --- | --- |
| `job.progressed` | a throttled report, or any stage change | `job_id`, `progress` |
| `job.status` | every change of state | the whole record |
| `job.failed` | the record went to `failed` | the record, plus `reason` |

Why `job.failed` exists when `job.status` already covers it: a subscriber that
only cares about failures — a toast, a log — should be able to say so in one
line instead of filtering a stream it otherwise ignores. It is a *second name*
for a subset of the stream, not a second stream.

**The payload is the record, not a summary.** A client that reconnects
mid-export gets everything it needs from the next event, which is the property
that lets the UI be genuinely event-driven (ADR-0010 §7) rather than
event-driven with a polling fallback that nobody removed.

**An observer must not block** — the port says it, and this bridge honours it by
publishing and returning: the bus delivers to each subscriber on its own
schedule, so a slow client slows itself and never the job.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from nova_studio.core.jobs import JobStatus

if TYPE_CHECKING:
    from nova_studio.core.events import EventBus
    from nova_studio.core.jobs import JobProgress, JobRecord
    from nova_studio.ports.jobs import JobObserver, Unsubscribe

__all__ = ["JobEventBridge", "JobEventSource", "install"]


#: Where progress reports are published. Named in ADR-0010 §3.
PROGRESSED: str = "job.progressed"

#: Where every change of state is published.
STATUS: str = "job.status"

#: Where failures are published, under a name a notifier can subscribe to.
FAILED: str = "job.failed"


class JobEventSource(Protocol):
    """What this module needs from an executor: the ability to listen.

    Narrower than :class:`~nova_studio.ports.jobs.JobExecutor` on purpose. A
    bridge that takes the whole port makes a claim about what it uses that it
    cannot back — it never submits, cancels or waits — and a protocol that wide
    is one a test has to satisfy with stubs it does not need.
    """

    def subscribe(self, observer: JobObserver) -> Unsubscribe:
        """Register a listener; call the result to remove it."""
        ...


@dataclass(frozen=True, slots=True)
class JobEventBridge:
    """A `JobObserver` that publishes what it is told.

    Frozen and stateless: it holds the bus it was given and nothing else, so
    two executors in one process — a session and a test — can each have one
    without sharing a cursor.

    Attributes:
        bus: Where the events go.
        source: What `Event.source` says on every event these publish, so a
            client can tell a job's own report from a service narrating one.
    """

    bus: EventBus
    source: str = "jobs"

    def on_progress(self, job_id: str, progress: JobProgress) -> None:
        """One report, as one event carrying the whole report."""
        self.bus.publish(
            PROGRESSED,
            {"job_id": job_id, "progress": progress.to_wire()},
            source=self.source,
        )

    def on_status(self, record: JobRecord) -> None:
        """One change of state, as one event carrying the whole record.

        Serialised fresh for each topic rather than once and shared: two
        events that aliased one payload would let a subscriber that decorated
        one — a timestamp, a localised title — change the other's copy of the
        same record.
        """
        self.bus.publish(STATUS, record.to_wire(), source=self.source)
        if record.status is JobStatus.FAILED:
            self.bus.publish(FAILED, record.to_wire(), source=self.source)


def install(executor: JobEventSource, bus: EventBus, *, source: str = "jobs") -> Unsubscribe:
    """Point an executor's events at a bus, and return how to stop.

    Called once per session, by the composition root. The unsubscribe exists
    because an executor can outlive a bus' usefulness — a test that builds a
    second app, or a session that is being torn down — and an observer that
    could not be removed would keep publishing into a closed bus.

    Args:
        executor: What to listen to. Typed as the **port**, not the adapter,
            so this module depends on the capability and not on the class that
            happens to implement it.
        bus: Where the events go.
        source: What `Event.source` says on them.
    """
    return executor.subscribe(JobEventBridge(bus, source=source))
