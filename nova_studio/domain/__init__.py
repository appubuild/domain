"""L2 — the domain model: what a Nova Studio project *is*.

This ring holds the entities, value objects and invariants that describe video
editing: projects, timelines, tracks, clips, transitions, captions, effects and
exports.  It is the code that must still be correct in ten years, when the codec
of the month, the GPU API and the ASR model have each been replaced several times
(ADR-0002).

Hard rules, enforced by ``scripts/check_layering.py``:

1. **No I/O of any kind.**  Not files, not the network, not a database, not
   ``datetime.now()``, not ``random``.  Banned at import level: ``sqlite3``,
   ``socket``, ``subprocess``, ``urllib``, ``http``, ``asyncio``, ``threading``.
2. **Time and identity are injected.**  A domain object that needs the current
   time or a new id receives a ``Clock`` / ``IdFactory`` port from its caller.
   This is what makes an edit decision testable without a filesystem and
   reproducible under a frozen clock.
3. **Framework-free.**  Entities are plain frozen dataclasses, not
   ``pydantic.BaseModel`` (ADR-0002 rule 6).  Wire DTOs live in ``api``.
4. **May import** ``nova_studio.core``, ``nova_studio.ports`` and the stdlib.
   May **not** import ``services``, ``infra`` or ``api``.

The payoff is that this entire ring is testable in milliseconds with no FFmpeg,
no GPU and no model weights present — which is why the majority of the test suite
runs there.

Modules (populated in Stage 3, in dependency order)::

    media.py       asset identity, streams, codecs, frame geometry
    persistence.py what we store: manifests, revisions, journal, cache entries
    asr.py         transcripts, words, speech regions, model references
    timeline.py    tracks, clips, transitions, the edit decision list
    captions.py    caption cues, words, speakers, templates
    effects.py     effect graphs and parameter values
    project.py     the aggregate root: a project and its invariants
    export.py      export presets and render intent

Invariant discipline: an entity validates itself at construction and raises
``NovaInvariantError`` (an ``AssertionError`` subclass) when a caller has broken a
rule that no valid input could produce.  Expected, user-caused failures — a
missing file, an unsupported codec — are returned as ``Err(NovaError)`` instead,
never raised.  Keeping those two channels distinct is what lets the API translate
one into ``400`` and the other into ``500`` without guessing.
"""

from __future__ import annotations
