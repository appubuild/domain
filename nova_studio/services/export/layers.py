"""L3 — export: which cues a file is written from.

A caption document holds every layer a project has — the original language, a
translation, a commentary track — and a SubRip or WebVTT file holds exactly one
of them. So the first question an export asks is *which*, and this module is the
only place that answers it, so that SRT and WebVTT cannot disagree.

Three things are refused here rather than written out:

* **A layer the document does not have.** A project whose translation was
  deleted between the dialog and the click is not a project to write an empty
  file for.
* **A layer with nothing in it.** An empty sidecar file is discovered at the
  worst possible moment — after the upload.
* **Cues a player will mishandle.** The layer's own cues are validated on their
  own, as a one-layer document: overlap, a cue too short to read, a reading rate
  nobody can manage. The *rest* of the project's layers are none of this file's
  business, which is why the whole document is not validated here.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from nova_studio.core.errors import ErrorDomain, NovaError
from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.captions import (
    DEFAULT_LAYER_ID,
    CaptionDocument,
    validate_caption_document,
)
from nova_studio.services.export.codes import ExportErrorCode

if TYPE_CHECKING:
    from nova_studio.domain.captions import CaptionLayer, CaptionSegment

__all__ = ["layer_cues", "layer_of"]


def layer_of(document: CaptionDocument, layer_id: str = DEFAULT_LAYER_ID) -> Result[CaptionLayer]:
    """The layer with this id, if the document has one."""
    for layer in document.layers:
        if layer.layer_id == layer_id:
            return ok(layer)
    return failed(
        NovaError(
            code=ExportErrorCode.LAYER_NOT_FOUND,
            message=f"this document has no layer named {layer_id!r}",
            domain=ErrorDomain.EXPORT,
            remedy=(
                "Choose one of "
                f"{', '.join(layer.layer_id for layer in document.layers)}, "
                "or export the whole document instead."
            ),
            details={"layer_id": layer_id},
            retryable=False,
        )
    )


def layer_cues(
    document: CaptionDocument, layer_id: str = DEFAULT_LAYER_ID
) -> Result[tuple[CaptionSegment, ...]]:
    """The cues of one layer, in the order they are shown.

    Sorted, because a file is read from the top and a viewer meets its cues in
    order: a document that was edited out of order still exports in order.

    Args:
        document: What a pipeline finished with.
        layer_id: Which layer to write. Defaults to the primary one.

    Returns:
        ``Ok`` with the cues, or ``Err`` naming the layer and what is wrong with
        it.
    """
    found = layer_of(document, layer_id)
    problem = found.error()
    if problem is not None:
        return failed(problem)
    layer = found.unwrap()

    cues = tuple(cue for cue in document.segments if cue.layer_id == layer_id)
    if not cues:
        return failed(
            NovaError(
                code=ExportErrorCode.EMPTY_LAYER,
                message=f"the {layer_id!r} layer holds no cues to export",
                domain=ErrorDomain.EXPORT,
                remedy="Generate captions for this layer first, or choose another one.",
                details={"layer_id": layer_id},
                retryable=False,
            )
        )

    alone = CaptionDocument(segments=cues, layers=(layer,), language=layer.language).reindexed()
    broken = validate_caption_document(alone)
    if broken:
        return failed(
            NovaError(
                code=ExportErrorCode.INVALID_DOCUMENT,
                message=f"the {layer_id!r} layer cannot be exported: {broken}",
                domain=ErrorDomain.EXPORT,
                remedy="Re-run the caption pipeline, or edit the cue the message names.",
                details={"layer_id": layer_id},
                retryable=False,
            )
        )
    return ok(alone.segments)
