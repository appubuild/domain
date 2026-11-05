"""L4 — the export job factory: the one place that knows what a worker needs.

A job body crosses a process boundary, so it has to be *picklable*: data and
module-level names, no open handles, no locks, no bound methods of a live
object. `ExportVideoJob` already holds its collaborators as factories and calls
them inside the run for exactly that reason — but something still has to choose
which factories, and choosing adapters is composition, which belongs to the
outermost ring.

So this module is small on purpose:

```
    routers/export.py  ──▶  ExportJobFactory  ──▶  ExportVideoJob
       (HTTP words)         (which adapters)        (picklable data)
```

**Why a factory object rather than module-level constants.** The adapter
choices are the same for every export, but *where they are decided* should be
one line a reader can find and a test can replace. A test that wants an export
to run against a fake renderer builds a second factory and hands it to the app
— no monkeypatching, no import order.

**Why the inner functions are module-level.** A lambda is not picklable by
value; a module-level function is pickled *by name*. `new_renderer` and its
siblings live at module scope and the factory only names them, so what travels
to the worker is three qualified names and the project.

**Why `default_factory` and not a plain default.** A function stored as a
dataclass field's default is a class attribute, and reading it through an
instance binds it as a method — `self.renderer()` would pass `self` as the
first argument. `default_factory` sets an *instance* attribute instead, which
does not bind. This is the one piece of cleverness in the module, and it is
the reason there is a comment on each field.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from nova_studio.infra.imaging import OpenCVImageOps
from nova_studio.infra.media import PyAVDecoder
from nova_studio.infra.render import PyAVRenderer
from nova_studio.services.render import EXPORT_CACHE_BYTES, ExportVideoJob

if TYPE_CHECKING:
    from collections.abc import Callable

    from nova_studio.domain.project import Project
    from nova_studio.ports.imaging import ImageOps
    from nova_studio.ports.media import MediaDecoder
    from nova_studio.ports.render import Renderer
    from nova_studio.services.render import ExportRequest

__all__ = ["ExportJobFactory", "new_decoder", "new_ops", "new_renderer"]


def new_renderer() -> Renderer:
    """Open the real encoder — in the worker, not in the process that queued it.

    Module-level, so the body that names it pickles as
    ``nova_studio.api.exports.new_renderer`` and the worker imports it back.
    """
    return PyAVRenderer()


def new_ops() -> ImageOps:
    """The pixel primitives the compositor resamples with."""
    return OpenCVImageOps()


def new_decoder() -> MediaDecoder:
    """Open the real decoder — in the worker, so the handles are the worker's."""
    return PyAVDecoder()


@dataclass(frozen=True, slots=True)
class ExportJobFactory:
    """Builds the body of one export job.

    Frozen and holding no mutable state: it is built once per session and
    handed to every request, so two exports in flight must not be able to
    change each other's adapters.

    Attributes:
        renderer: How to open the output file. Called inside the job.
        ops: The pixel primitives the compositor uses.
        decoder: How to open a source file.
        cache_bytes: How much decoded picture the worker's pool may hold.
    """

    renderer: Callable[[], Renderer] = field(default_factory=lambda: new_renderer)
    ops: Callable[[], ImageOps] = field(default_factory=lambda: new_ops)
    decoder: Callable[[], MediaDecoder] = field(default_factory=lambda: new_decoder)
    cache_bytes: int = EXPORT_CACHE_BYTES

    def job_for(self, project: Project, request: ExportRequest) -> ExportVideoJob:
        """The body that gets pickled into the worker.

        The resolver is left at its default — paths resolved from the project's
        own assets — because the project is a frozen value that travels with
        the job. A resolver closing over the *workspace* would not travel at
        all: it is a live object holding a lock and a bus, and the worker would
        get a copy of neither.
        """
        return ExportVideoJob(
            project=project,
            request=request,
            renderer_factory=self.renderer,
            ops_factory=self.ops,
            decoder_factory=self.decoder,
            cache_bytes=self.cache_bytes,
        )
