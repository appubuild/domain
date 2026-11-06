"""L3 — the cache key vocabulary: what a derived artefact is *called*.

A proxy and a thumbnail are the same kind of thing to the cache: a key, a kind
and a size. What makes them useful rather than merely present is that the key is
**derived, not assigned** — the same asset at the same size produces the same key
this session, next session, and on another machine, which is what makes a
disposable cache worth having (ADR-0015 rule 6: the cache can be deleted, and a
stable name is the only reason deleting it costs a rebuild and not a mystery).

Three rules:

1. **The key is a file name.** Not a hash of one, not a row id: a name a support
   engineer can read in a directory listing and know what they are looking at.
   `proxy-01J8…-h720.mp4` says what it is; `7f3a9c.mp4` does not.
2. **Everything that changes the bytes is in the name.** Height for a proxy,
   frame and width for a thumbnail. Two artefacts with different bytes must never
   share a key, and the cheapest way to guarantee that is to make the inputs
   visible.
3. **A key is untrusted input the moment it reaches a path.** Asset ids come
   from a project file, so :func:`is_safe_key` runs the domain's own zip-slip
   guard before any of these become a file name.

What is *not* here: where the file lives (:func:`~nova_studio.infra.persistence.
paths.derived_path`, an infra concern) and whether we still have it
(:class:`~nova_studio.services.media.cache.MediaCache`). This module names
things and reads them back; it decides nothing.
"""

from __future__ import annotations

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.persistence import CacheKind, is_valid_document_name as _is_safe

__all__ = [
    "PROXY_EXTENSION",
    "PROXY_PREFIX",
    "THUMBNAIL_EXTENSION",
    "THUMBNAIL_PREFIX",
    "is_safe_key",
    "kind_of",
    "proxy_key",
    "thumbnail_key",
]

#: Every proxy key starts with this. Also what :func:`kind_of` reads.
PROXY_PREFIX: str = "proxy-"

#: Every thumbnail key starts with this.
THUMBNAIL_PREFIX: str = "thumb-"

#: The container every proxy is written as. Matroska rather than MP4 because a
#: proxy is written frame by frame and may be read before it is finished — an
#: MP4 needs its index rewritten at the end, and a job that died mid-write
#: would leave a file that cannot be opened at all.
PROXY_EXTENSION: str = ".mkv"

#: Thumbnails are JPEG: a tile is a picture somebody glances at, and a PNG of
#: the same frame is ten times the bytes for a difference nobody sees.
THUMBNAIL_EXTENSION: str = ".jpg"

#: What separates the parts of a key. Chosen because it cannot appear in an
#: asset id, so a key can be split without guessing.
_SEPARATOR: str = "-"


def proxy_key(asset_id: str, *, height: int) -> str:
    """The key of one asset's proxy at one height.

    Args:
        asset_id: The asset, as the project knows it.
        height: The proxy's height in pixels — the number the policy chose,
            not the height the source happened to have.

    Raises:
        NovaInvariantError: The asset id is empty or unsafe as a file name, or
            the height is not a positive even number. An odd height is refused
            here rather than by the encoder, because by then a job has already
            been scheduled.
    """
    _refuse_unless_safe(asset_id, "asset id")
    if height < 2 or height % 2:
        raise NovaInvariantError(f"a proxy height must be a positive even number, got {height}")
    return f"{PROXY_PREFIX}{asset_id}{_SEPARATOR}h{height}{PROXY_EXTENSION}"


def thumbnail_key(asset_id: str, *, frame: int, width: int) -> str:
    """The key of one frame of one asset, at one width.

    Args:
        asset_id: The asset, as the project knows it.
        frame: The frame index in the source's own numbering — the number
            :func:`~nova_studio.services.media.thumbnails.thumbnail_indices`
            returned, so a strip laid out twice asks for the same keys.
        width: The thumbnail's width in pixels.

    Raises:
        NovaInvariantError: On an unsafe asset id, a negative frame or a
            non-positive width.
    """
    _refuse_unless_safe(asset_id, "asset id")
    if frame < 0:
        raise NovaInvariantError(f"a thumbnail frame must not be negative, got {frame}")
    if width < 1:
        raise NovaInvariantError(f"a thumbnail width must be positive, got {width}")
    return (
        f"{THUMBNAIL_PREFIX}{asset_id}{_SEPARATOR}f{frame}{_SEPARATOR}w{width}{THUMBNAIL_EXTENSION}"
    )


def kind_of(key: str) -> CacheKind:
    """Which family a key belongs to — what :func:`derived_path` needs.

    Raises:
        NovaInvariantError: The key is not one of ours. A cache index holds
            keys from every feature that caches, so an unknown prefix is a
            caller asking about an artefact this module does not own, and
            guessing would put a waveform in the thumbnail directory.
    """
    if key.startswith(PROXY_PREFIX):
        return CacheKind.PROXY
    if key.startswith(THUMBNAIL_PREFIX):
        return CacheKind.THUMBNAIL
    raise NovaInvariantError(
        f"cache key {key!r} belongs to no kind this module knows; "
        f"expected a key starting with {PROXY_PREFIX!r} or {THUMBNAIL_PREFIX!r}"
    )


def is_safe_key(key: str) -> bool:
    """Whether ``key`` may become a file name.

    The domain's own predicate, for the same reason a project id uses it: a
    name that escapes its directory is not a name, it is a path.
    """
    return bool(key) and _is_file_name(key)


def _is_file_name(name: str) -> bool:
    """Whether ``name`` is *one* file name: no traversal, and no separator.

    Stricter than the domain's document-name predicate, and necessarily so:
    that one is about entries inside a project archive, where ``clips/a.json``
    is a perfectly ordinary relative path. A cache key becomes a file in a flat
    directory — one subdirectory per ``CacheKind`` — so a separator is not a
    name, it is a directory this module did not create and eviction will not
    clean up.
    """
    return _is_safe(name) and "/" not in name


def _refuse_unless_safe(asset_id: str, what: str) -> None:
    """One guard, one message, for every string that reaches a file name."""
    if not asset_id:
        raise NovaInvariantError(f"a cache key needs an {what}")
    if not _is_file_name(asset_id):
        raise NovaInvariantError(f"{what} {asset_id!r} cannot be used in a file name")
