"""L3 feature — media: getting footage into the editor and keeping it playable.

**Purpose.** Own the three decisions that stand between a file on a disk and a
clip on a timeline: **does this file belong here** (ingest), **which copy of it
should we decode** (the proxy policy), and **which frames should we draw** (the
thumbnail plan). What a file *is* lives in `domain/media.py`; reading bytes is
`infra/`'s job through `ports/media.py`. This layer decides and reports.

**Folder structure.**

```
services/media/
├── __init__.py     this file: the feature's contract
├── ingest.py       MediaIngestor — paths in, assets plus per-file failures out
├── proxy.py        ProxyPolicy — which source to decode, and whether to make one
├── keys.py         the cache key vocabulary: what a derived artefact is called
├── cache.py        MediaCache — which *file* that key means, per asset
├── thumbnails.py   thumbnail_indices — the frames a strip should ask for
└── generation.py   ProxyJob / ThumbnailJob — how the bytes get made
```

**Backend / frontend.** One API per intent. The frontend drops forty files on a
panel and gets one `IngestReport` back: `assets` to add to the project,
`failures` to list with their `code` mapped to a local message, `duplicates` to
say "already here", and `summary()` for the status bar. It never probes, never
compares paths and never decides a codec is expensive — the policy lives here so
that the laptop build and the workstation build differ by one binding, not by
two code paths.

**State management.** `MediaIngestor` holds an injected prober and id source and
nothing else; every import is independent and repeatable. `ProxyPolicy`,
`ProxyPlan` and the thumbnail index tuple are frozen values, safe to hand to a
render worker or cache as part of a job payload. No cache, no handles, no
threads: the only long-running work this feature *causes* is a proxy transcode,
and that goes to the scheduler as a `NORMAL` job (ADR-0010) — never a thread
spawned here.

**Functions.**

| Call | Answers |
| --- | --- |
| `MediaIngestor.ingest(paths, existing)` | "what did we get, what failed, what was already here" |
| `ProxyPolicy.decide(scale, available)` | "which copy do I decode at this preview scale" |
| `ProxyPolicy.plan(info)` | "is a proxy worth building, and how big" |
| `MediaCache.resolve(project, asset_id, source)` | "which file *is* that copy" |
| `MediaCache.sources_for(project, scale)` | "which copy should everything decode, at this preview scale" |
| `thumbnail_indices(count, wanted, keyframes)` | "which frames does a strip ask for" |
| `proxy_requests(project, cache=…)` | "which proxies are missing" |
| `thumbnail_requests(project, cache=…)` | "which thumbnails are missing" |
| `ProxyJob(request, …)(context)` | "make this proxy, as a job" |
| `ThumbnailJob(asset_id, source, requests, …)(context)` | "make these stills, as a job" |

**Transparency.** `MediaCache` is why §7.2's promise holds. `resolve` falls back
*towards the original* — a missing thumbnail answers with a proxy, a missing
proxy with the original — so a copy that has not been generated yet degrades
the picture instead of removing it. Only a missing original removes a layer,
which is a relink and not a cache miss.

**Events.** None yet. Proxy transcodes will publish `job.*` through the
scheduler; ingest will emit `media.imported` once the media panel needs to
refresh live, and `media.relinked` when the relink flow lands (which is when
`services/projects` starts listening, per §4).

**Error handling.** Ingest never returns a `Result` — a batch cannot fail as a
batch, so failures travel *inside* the report as `IngestFailure`, each carrying
the `NovaError` the probe produced (`NS-MEDIA-4001` unreadable, `-4003`
unsupported codec, `-4004` decode failed). Empty paths are refused without I/O
under `NS-MEDIA-4001`. `ProxyPolicy` and `thumbnail_indices` raise
`NovaInvariantError` for a nonsensical argument (a non-positive scale, a
negative frame count) because those are bugs in the caller, not states of a
file.

**Generation is a job, and a job leaves nothing behind on failure.** `ProxyJob`
and `ThumbnailJob` are frozen bodies holding *factories*, so they can be
pickled and run in a worker process (ADR-0010 §1); the renderer stages beside
the target and promotes on `finish`, the still sink renames into place, and
neither records a row until the bytes are complete — a cache entry is a promise
eviction will collect on, and bytes no row names are bytes nobody can reclaim.
Proxies are planned for the assets the **timeline references**, thumbnails for
every asset in the project: transcoding two hundred files somebody imported but
never cut is how a cache becomes forty gigabytes, while eight decodes of each is
how a media bin becomes browsable.

**Caching.** None in the code — but the *output* is the cache key.
`thumbnail_indices` is deterministic, so a strip laid out today and the same
strip laid out after a reopen ask for the same frames and hit the same cache
entries instead of repopulating it (ADR-0015 rule 6: the cache is disposable,
and a stable key is what makes a disposable cache useful).

**Performance.** Ingest is one container open per file, no frame decode — the
probe port is defined that way on purpose (`ports/media.py` §"MediaProber"). The
thumbnail plan is integer arithmetic; it exists precisely to keep the decode
count down, snapping each target back to a keyframe so a ten-minute 4K clip
costs eight cheap seeks instead of eight GOP walks.

**Testing.** `tests/services/test_media_ingest.py` pins the three rules above
against a fake prober and a deterministic id source.
`tests/services/test_media_proxy.py` pins the fidelity budget and the even-dimension
arithmetic. `tests/services/test_media_thumbnails.py` pins the spread, the
keyframe snapping and the deduplication. `tests/services/test_media_cache.py`
pins which file a key means. `tests/services/test_media_generation.py` pins the
planners (reach, idempotence, geometry) and both job bodies against a fake
decoder, a fake renderer and a still sink that writes to a dictionary — no
FFmpeg, no filesystem, no numpy beyond what the domain already carries.

**Database schema.** None — see the note in `docs/architecture/services.md` §1.

**Future expansion.**

* **Content hashing** once `ports/filesystem.py` exists: duplicates will then be
  matched by bytes, and relink will be provable rather than hopeful.
* **Waveform and audio-analysis planning**, which is the same shape as the
  thumbnail plan — indices in, samples out.
* **Submission**, once `services/jobs/` exists: `proxy_requests` and
  `thumbnail_requests` are the pure half a scheduler needs — "what is missing",
  asked as often as it likes, because a request for something already held is
  simply not made.
* **Byte-budgeted eviction** over `select_for_eviction`, which is the other half
  of `MediaCache.record` and the reason every row carries a size.
* **Audio in the proxy.** The frame pool is video-only today, so a proxy is too;
  the day a mixer exists, `proxy_output_spec` gains an audio stream and nothing
  else changes.
"""

from __future__ import annotations

from nova_studio.services.media.cache import ExistsFn, MediaCache, SourceResolver, UnlinkFn
from nova_studio.services.media.generation import (
    DEFAULT_THUMBNAIL_WIDTH,
    PROXY_JOB_KIND,
    THUMBNAIL_JOB_KIND,
    GenerationStage,
    ProxyJob,
    ProxyRequest,
    ThumbnailJob,
    ThumbnailRequest,
    proxy_job_spec,
    proxy_output_spec,
    proxy_requests,
    thumbnail_geometry,
    thumbnail_job_spec,
    thumbnail_requests,
)
from nova_studio.services.media.ingest import (
    IngestedAsset,
    IngestFailure,
    IngestReport,
    MediaIngestor,
)
from nova_studio.services.media.keys import (
    PROXY_EXTENSION,
    PROXY_PREFIX,
    THUMBNAIL_EXTENSION,
    THUMBNAIL_PREFIX,
    is_safe_key,
    kind_of,
    proxy_key,
    thumbnail_key,
)
from nova_studio.services.media.proxy import (
    DEFAULT_PROXY_POLICY,
    EDIT_FRIENDLY_CODECS,
    DecodeSource,
    ProxyPlan,
    ProxyPolicy,
)
from nova_studio.services.media.thumbnails import DEFAULT_STRIP_COUNT, thumbnail_indices

__all__ = [
    "DEFAULT_PROXY_POLICY",
    "DEFAULT_STRIP_COUNT",
    "DEFAULT_THUMBNAIL_WIDTH",
    "EDIT_FRIENDLY_CODECS",
    "PROXY_EXTENSION",
    "PROXY_JOB_KIND",
    "PROXY_PREFIX",
    "THUMBNAIL_EXTENSION",
    "THUMBNAIL_JOB_KIND",
    "THUMBNAIL_PREFIX",
    "DecodeSource",
    "ExistsFn",
    "GenerationStage",
    "IngestFailure",
    "IngestReport",
    "IngestedAsset",
    "MediaCache",
    "MediaIngestor",
    "ProxyJob",
    "ProxyPlan",
    "ProxyPolicy",
    "ProxyRequest",
    "SourceResolver",
    "ThumbnailJob",
    "ThumbnailRequest",
    "UnlinkFn",
    "is_safe_key",
    "kind_of",
    "proxy_job_spec",
    "proxy_key",
    "proxy_output_spec",
    "proxy_requests",
    "thumbnail_geometry",
    "thumbnail_indices",
    "thumbnail_job_spec",
    "thumbnail_key",
    "thumbnail_requests",
]
