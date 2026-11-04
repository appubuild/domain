"""Choosing what a file is written from (`services/export/layers.py`).

A document holds every layer a project has and a sidecar file holds exactly one,
so the first question an export asks is *which*. This file is about that
question and about the three refusals around it — the layer that is not there,
the layer with nothing in it, and the cues a player will mishandle.
"""

from __future__ import annotations

import pytest

from nova_studio.domain.captions import (
    CaptionDocument,
    CaptionLayer,
    CaptionLayerKind,
    CaptionSegment,
)
from nova_studio.services.export.codes import ExportErrorCode
from nova_studio.services.export.layers import layer_cues, layer_of

pytestmark = pytest.mark.unit


def _cue(
    start_ms: int = 0,
    end_ms: int = 1_000,
    text: str = "a line of caption",
    **over: object,
) -> CaptionSegment:
    return CaptionSegment(
        **{"index": 0, "start_ms": start_ms, "end_ms": end_ms, "text": text, **over}  # type: ignore[arg-type]
    )


class TestLayerOf:
    def test_the_primary_layer_is_there_by_default(self):
        assert layer_of(CaptionDocument()).unwrap().layer_id == "primary"

    def test_a_translation_layer_can_be_found(self):
        document = CaptionDocument(
            layers=(
                CaptionLayer.primary("en"),
                CaptionLayer(layer_id="de", language="de", kind=CaptionLayerKind.TRANSLATION),
            )
        )
        assert layer_of(document, "de").unwrap().language == "de"

    def test_a_layer_that_is_not_there_is_refused(self):
        assert (
            layer_of(CaptionDocument(), "de").unwrap_err().code == ExportErrorCode.LAYER_NOT_FOUND
        )

    def test_the_refusal_names_the_layer(self):
        assert layer_of(CaptionDocument(), "de").unwrap_err().details["layer_id"] == "de"

    def test_the_refusal_says_what_there_is(self):
        document = CaptionDocument(
            layers=(
                CaptionLayer.primary("en"),
                CaptionLayer(layer_id="de", language="de", kind=CaptionLayerKind.TRANSLATION),
            )
        )
        assert "de" in layer_of(document, "fr").unwrap_err().remedy


class TestLayerCues:
    def test_every_cue_of_the_layer_comes_back(self):
        cues = layer_cues(CaptionDocument.of(_cue(0, 1_000), _cue(1_200, 2_200))).unwrap()
        assert len(cues) == 2

    def test_only_that_layers_cues(self):
        document = CaptionDocument(
            segments=(
                _cue(0, 1_000, "good morning", layer_id="primary"),
                _cue(0, 1_000, "guten morgen", layer_id="de"),
            ),
            layers=(
                CaptionLayer.primary("en"),
                CaptionLayer(layer_id="de", language="de", kind=CaptionLayerKind.TRANSLATION),
            ),
        ).reindexed()
        cues = layer_cues(document, "de").unwrap()
        assert [cue.text for cue in cues] == ["guten morgen"]

    def test_they_come_back_in_the_order_they_are_shown(self):
        document = CaptionDocument.of(_cue(2_400, 3_400), _cue(0, 1_000), _cue(1_200, 2_200))
        cues = layer_cues(document).unwrap()
        assert [cue.start_ms for cue in cues] == [0, 1_200, 2_400]

    def test_a_translation_that_sits_on_the_original_is_fine(self):
        """A translation is validated on its own, not against what it translates."""
        document = CaptionDocument(
            segments=(
                _cue(0, 1_000, "good morning", layer_id="primary"),
                _cue(0, 1_000, "guten morgen", layer_id="de"),
            ),
            layers=(
                CaptionLayer.primary("en"),
                CaptionLayer(layer_id="de", language="de", kind=CaptionLayerKind.TRANSLATION),
            ),
        ).reindexed()
        assert layer_cues(document, "de").is_ok()

    def test_an_empty_layer_is_refused(self):
        document = CaptionDocument(
            layers=(
                CaptionLayer.primary("en"),
                CaptionLayer(layer_id="de", language="de", kind=CaptionLayerKind.TRANSLATION),
            )
        )
        assert layer_cues(document, "de").unwrap_err().code == ExportErrorCode.EMPTY_LAYER

    def test_overlapping_cues_are_refused(self):
        document = CaptionDocument.of(_cue(0, 1_500), _cue(1_200, 2_200))
        assert layer_cues(document).unwrap_err().code == ExportErrorCode.INVALID_DOCUMENT

    def test_the_refusal_says_which_layer(self):
        document = CaptionDocument.of(_cue(0, 1_500), _cue(1_200, 2_200))
        assert layer_cues(document).unwrap_err().details["layer_id"] == "primary"
