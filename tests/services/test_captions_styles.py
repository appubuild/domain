"""The house styles (`services/captions/styles.py`).

A look is data — that is the whole design, because data is what a plugin ships,
a user forks and a template picker lists. These tests pin what the four presets
mean, and the one trap in applying them: **a word's characters must join to make
the word**, so a look that changes the case must rebuild the words and not just
the text. Get that wrong and the result is a document the domain refuses to load.
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.result import Err
from nova_studio.domain.captions import (
    CaptionAnchor,
    CaptionDocument,
    CaptionSegment,
    CaptionWord,
)
from nova_studio.services.captions.pipeline import CaptionPipeline, StageContext
from nova_studio.services.captions.styles import (
    DEFAULT_TEMPLATE,
    LOOKS,
    Backdrop,
    CaptionLook,
    CaptionTemplate,
    StyleStage,
    TextCase,
    WordAnimation,
    apply_look,
    look_for,
)

pytestmark = pytest.mark.unit


def _cue(
    text: str = "hello there friends",
    *,
    start_ms: int = 0,
    step_ms: int = 400,
    speaker: str | None = None,
    locked: bool = False,
    with_words: bool = True,
    confidence: float | None = None,
) -> CaptionSegment:
    """A three-word cue, timed, as the builder would have made it."""
    words: tuple[CaptionWord, ...] = ()
    end_ms = start_ms + 500
    if with_words:
        at = start_ms
        for token in text.split():
            words += (CaptionWord.of(token, at, at + step_ms - 40, confidence=confidence),)
            at += step_ms
        end_ms = words[-1].end_ms
    return CaptionSegment(
        index=0,
        start_ms=start_ms,
        end_ms=end_ms,
        text=text,
        words=words,
        speaker=speaker,
        locked=locked,
        confidence=confidence,
    )


def replace_look(**kwargs: float | TextCase | bool) -> CaptionLook:
    """The Netflix look with one field changed, for the cases no preset covers."""
    return replace(look_for(CaptionTemplate.NETFLIX), **kwargs)  # type: ignore[arg-type]


class TestThePresets:
    def test_every_template_has_a_look(self) -> None:
        assert {template for template, _ in LOOKS} == set(CaptionTemplate)

    def test_the_default_is_the_broadcast_one(self) -> None:
        assert DEFAULT_TEMPLATE is CaptionTemplate.NETFLIX

    def test_a_new_project_starts_unobtrusive(self) -> None:
        assert look_for(DEFAULT_TEMPLATE).word_animation is WordAnimation.NONE

    def test_netflix_sits_at_the_bottom_and_does_not_shout(self) -> None:
        look = look_for(CaptionTemplate.NETFLIX)
        assert look.anchor is CaptionAnchor.BOTTOM_CENTER
        assert look.text_case is TextCase.NONE

    def test_netflix_uses_the_broadcast_outline(self) -> None:
        assert look_for(CaptionTemplate.NETFLIX).backdrop is Backdrop.OUTLINE

    def test_tiktok_is_read_on_a_phone(self) -> None:
        """Held at arm's length: middle of the frame, few characters a line."""
        look = look_for(CaptionTemplate.TIKTOK)
        assert look.anchor is CaptionAnchor.MIDDLE_CENTER
        assert look.max_chars_per_line < look_for(CaptionTemplate.NETFLIX).max_chars_per_line

    def test_tiktok_shouts(self) -> None:
        assert look_for(CaptionTemplate.TIKTOK).text_case is TextCase.UPPER

    def test_tiktok_pops_the_word_being_spoken(self) -> None:
        look = look_for(CaptionTemplate.TIKTOK)
        assert look.word_animation is WordAnimation.BOUNCE
        assert look.highlight_active_word is True

    def test_podcast_says_who_is_talking(self) -> None:
        look = look_for(CaptionTemplate.PODCAST)
        assert look.show_speaker_names is True
        assert look.word_animation is WordAnimation.KARAOKE

    def test_gaming_stays_out_of_the_crosshair(self) -> None:
        look = look_for(CaptionTemplate.GAMING)
        assert look.anchor is CaptionAnchor.BOTTOM_LEFT
        assert look.backdrop is Backdrop.BOX

    def test_plain_is_literally_plain(self) -> None:
        look = look_for(CaptionTemplate.PLAIN)
        assert (look.word_animation, look.backdrop) == (WordAnimation.NONE, Backdrop.NONE)

    def test_an_unknown_template_falls_back_instead_of_refusing(self) -> None:
        """A project from a newer build must still open (ADR-0015 rule 3)."""
        assert look_for("a-style-from-next-year") is look_for(DEFAULT_TEMPLATE)

    def test_a_look_knows_the_breaking_rules_it_implies(self) -> None:
        rules = look_for(CaptionTemplate.TIKTOK).rules()
        assert (rules.max_lines, rules.max_chars_per_line) == (2, 20)

    def test_a_look_knows_where_a_cue_sits(self) -> None:
        position = look_for(CaptionTemplate.GAMING).position()
        assert (position.anchor, position.x, position.y) == (CaptionAnchor.BOTTOM_LEFT, 0.0, 0.0)

    def test_the_offset_is_part_of_the_position(self) -> None:
        look = replace_look(x=0.25, y=-0.1)
        position = look.position()
        assert (position.x, position.y) == (0.25, -0.1)

    def test_style_keys_are_flat_and_stringly_typed(self) -> None:
        """Because plugins contribute keys this module has not been written for."""
        overrides = look_for(CaptionTemplate.TIKTOK).overrides()
        assert overrides["word_animation"] == "bounce"
        assert overrides["template"] == "tiktok"

    def test_the_keys_a_renderer_needs_are_all_there(self) -> None:
        assert {
            "template",
            "text_case",
            "word_animation",
            "backdrop",
            "font_size_ratio",
            "font_weight",
            "line_spacing",
        } <= set(look_for(CaptionTemplate.NETFLIX).overrides())


class TestALookMustBeSane:
    def test_no_lines_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            CaptionLook(template=CaptionTemplate.PLAIN, max_lines=0)

    def test_no_characters_a_line_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            CaptionLook(template=CaptionTemplate.PLAIN, max_chars_per_line=0)

    def test_a_font_size_of_nothing_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            CaptionLook(template=CaptionTemplate.PLAIN, font_size_ratio=0.0)

    def test_a_font_size_bigger_than_the_frame_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            CaptionLook(template=CaptionTemplate.PLAIN, font_size_ratio=1.5)

    def test_an_out_of_range_weight_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            CaptionLook(template=CaptionTemplate.PLAIN, font_weight=50)

    def test_negative_line_spacing_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            CaptionLook(template=CaptionTemplate.PLAIN, line_spacing=0.0)

    def test_an_offset_outside_the_safe_area_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            CaptionLook(template=CaptionTemplate.PLAIN, x=1.5)


class TestCase:
    def test_upper(self) -> None:
        assert (
            CaptionLook(template=CaptionTemplate.PLAIN, text_case=TextCase.UPPER).text_of(
                "hello there"
            )
            == "HELLO THERE"
        )

    def test_lower(self) -> None:
        assert (
            CaptionLook(template=CaptionTemplate.PLAIN, text_case=TextCase.LOWER).text_of(
                "HELLO There"
            )
            == "hello there"
        )

    def test_title(self) -> None:
        assert (
            CaptionLook(template=CaptionTemplate.PLAIN, text_case=TextCase.TITLE).text_of(
                "hello there"
            )
            == "Hello There"
        )

    def test_none_leaves_the_text_alone(self) -> None:
        assert CaptionLook(template=CaptionTemplate.PLAIN).text_of("Hello There") == "Hello There"


class TestApplying:
    def test_a_cue_gains_the_looks_position(self) -> None:
        dressed = apply_look((_cue(),), look_for(CaptionTemplate.GAMING))
        assert dressed[0].position is not None
        assert dressed[0].position.anchor is CaptionAnchor.BOTTOM_LEFT

    def test_a_cue_gains_the_looks_style_keys(self) -> None:
        dressed = apply_look((_cue(),), look_for(CaptionTemplate.TIKTOK))
        assert dressed[0].style_overrides is not None
        assert dressed[0].style_overrides["backdrop"] == "shadow"

    def test_the_case_is_applied_to_the_text(self) -> None:
        dressed = apply_look((_cue(),), look_for(CaptionTemplate.TIKTOK))
        assert dressed[0].text == "HELLO THERE FRIENDS"

    def test_the_case_is_applied_to_the_words_too(self) -> None:
        """Otherwise the words would no longer be in the text."""
        dressed = apply_look((_cue(),), look_for(CaptionTemplate.TIKTOK))
        assert [word.text for word in dressed[0].words] == ["HELLO", "THERE", "FRIENDS"]

    def test_the_words_characters_are_rebuilt_to_match(self) -> None:
        """The trap: characters must join to make the word."""
        dressed = apply_look((_cue(),), look_for(CaptionTemplate.TIKTOK))
        for word in dressed[0].words:
            assert "".join(char.text for char in word.chars) == word.text

    def test_a_re_styled_cue_still_loads(self) -> None:
        """The domain invariant, end to end."""
        dressed = apply_look((_cue(),), look_for(CaptionTemplate.TIKTOK))
        assert CaptionSegment.from_wire(dressed[0].to_wire()) == dressed[0]

    def test_a_cue_that_does_not_change_case_keeps_its_words(self) -> None:
        """No case change means no rebuild: the word is the very same object."""
        cue = _cue()
        dressed = apply_look((cue,), look_for(CaptionTemplate.NETFLIX))
        assert all(new is old for new, old in zip(dressed[0].words, cue.words, strict=True))

    def test_word_timings_survive_a_case_change(self) -> None:
        cue = _cue()
        dressed = apply_look((cue,), look_for(CaptionTemplate.TIKTOK))
        assert [word.start_ms for word in dressed[0].words] == [word.start_ms for word in cue.words]

    def test_the_word_speaks_for_itself_after_a_case_change(self) -> None:
        """Confidence, timings and highlight are carried over, not reset."""
        cue = _cue(confidence=0.6)
        dressed = apply_look((cue,), look_for(CaptionTemplate.TIKTOK))
        word = dressed[0].words[0]
        assert (word.confidence, word.start_ms, word.end_ms) == (0.6, 0, 360)

    def test_every_cue_is_dressed(self) -> None:
        dressed = apply_look(
            (_cue("one two"), _cue("three four")), look_for(CaptionTemplate.TIKTOK)
        )
        assert all(cue.style_overrides for cue in dressed)

    def test_nothing_is_dropped(self) -> None:
        cues = (_cue("one two"), _cue("three four"))
        assert len(apply_look(cues, look_for(CaptionTemplate.TIKTOK))) == 2


class TestLockedCues:
    def test_a_locked_cue_is_untouched(self) -> None:
        cue = _cue(locked=True)
        assert apply_look((cue,), look_for(CaptionTemplate.TIKTOK))[0] is cue

    def test_a_locked_cue_does_not_even_move(self) -> None:
        """Locking is the promise that a re-style will not move it."""
        cue = _cue(locked=True)
        dressed = apply_look((cue,), look_for(CaptionTemplate.GAMING))
        assert (dressed[0].position, dressed[0].style_overrides) == (None, None)

    def test_the_unlocked_neighbours_are_still_dressed(self) -> None:
        dressed = apply_look(
            (_cue("one two"), _cue("three four", locked=True)),
            look_for(CaptionTemplate.TIKTOK),
        )
        assert dressed[0].style_overrides is not None
        assert dressed[1].style_overrides is None


class TestSpeakerNames:
    def test_the_speaker_is_prefixed(self) -> None:
        cue = _cue(speaker="Alice")
        dressed = apply_look((cue,), look_for(CaptionTemplate.PODCAST))
        assert dressed[0].text == "Alice: hello there friends"

    def test_a_look_that_does_not_ask_leaves_the_text_alone(self) -> None:
        cue = _cue(speaker="Alice")
        dressed = apply_look((cue,), look_for(CaptionTemplate.NETFLIX))
        assert dressed[0].text == "hello there friends"

    def test_a_cue_with_no_speaker_is_not_prefixed(self) -> None:
        dressed = apply_look((_cue(),), look_for(CaptionTemplate.PODCAST))
        assert dressed[0].text == "hello there friends"

    def test_the_prefix_is_not_applied_twice(self) -> None:
        """Re-styling a document twice must not grow the name."""
        look = look_for(CaptionTemplate.PODCAST)
        once = apply_look((_cue("Alice: hello there", speaker="Alice"),), look)
        twice = apply_look(once, look)
        assert twice[0].text == "Alice: hello there"

    def test_a_named_cue_still_loads(self) -> None:
        dressed = apply_look((_cue(speaker="Alice"),), look_for(CaptionTemplate.PODCAST))
        assert CaptionSegment.from_wire(dressed[0].to_wire()) == dressed[0]

    def test_the_speaker_prefix_takes_the_case_too(self) -> None:
        look = replace_look(text_case=TextCase.UPPER, show_speaker_names=True)
        dressed = apply_look((_cue(speaker="Alice"),), look)
        assert dressed[0].text == "ALICE: HELLO THERE FRIENDS"


class TestWhatACueCannotHonour:
    def test_karaoke_stays_karaoke_when_the_words_are_timed(self) -> None:
        dressed = apply_look((_cue(),), look_for(CaptionTemplate.PODCAST))
        assert dressed[0].style_overrides is not None
        assert dressed[0].style_overrides["word_animation"] == "karaoke"

    def test_karaoke_without_word_timings_falls_back(self) -> None:
        """A karaoke caption with no word timings never lights up."""
        dressed = apply_look((_cue(with_words=False),), look_for(CaptionTemplate.PODCAST))
        assert dressed[0].style_overrides is not None
        assert dressed[0].style_overrides["word_animation"] == "none"

    def test_the_highlight_goes_with_it(self) -> None:
        dressed = apply_look((_cue(with_words=False),), look_for(CaptionTemplate.PODCAST))
        assert dressed[0].style_overrides is not None
        assert dressed[0].style_overrides["highlight_active_word"] is False

    def test_another_animation_is_not_affected(self) -> None:
        """Only karaoke depends on word timings."""
        dressed = apply_look((_cue(with_words=False),), look_for(CaptionTemplate.GAMING))
        assert dressed[0].style_overrides is not None
        assert dressed[0].style_overrides["word_animation"] == "slide"


class TestTheStage:
    """The same look, run inside a pipeline (ADR-0009 §3)."""

    def test_the_stage_calls_itself_style(self) -> None:
        assert StyleStage().name == "style"

    def test_a_stage_starts_on_the_default_template(self) -> None:
        assert StyleStage().look is look_for(DEFAULT_TEMPLATE)

    def test_a_stage_can_carry_another_look(self) -> None:
        tiktok = look_for(CaptionTemplate.TIKTOK)
        assert StyleStage(look=tiktok).look is tiktok

    def test_running_the_stage_gives_a_document(self) -> None:
        document = CaptionDocument.of(_cue())
        result = StyleStage().apply(document, StageContext())
        assert not isinstance(result, Err)
        assert result.unwrap().segment_count == 1

    def test_the_stage_dresses_every_unlocked_cue(self) -> None:
        document = CaptionDocument.of(_cue(), _cue("a second line", start_ms=5_000))
        dressed = (
            StyleStage(look=look_for(CaptionTemplate.TIKTOK))
            .apply(document, StageContext())
            .unwrap()
        )
        assert all(
            cue.style_overrides is not None and cue.style_overrides["template"] == "tiktok"
            for cue in dressed.segments
        )

    def test_the_stage_leaves_a_locked_cue_alone(self) -> None:
        locked = _cue("leave me alone", locked=True)
        document = CaptionDocument.of(locked, _cue("dress me", start_ms=5_000))
        dressed = (
            StyleStage(look=look_for(CaptionTemplate.TIKTOK))
            .apply(document, StageContext())
            .unwrap()
        )
        assert dressed.segments[0] == locked

    def test_the_stage_keeps_the_rest_of_the_document(self) -> None:
        document = CaptionDocument.of(_cue(), language="en")
        dressed = StyleStage().apply(document, StageContext()).unwrap()
        assert dressed.language == "en"
        assert dressed.layers == document.layers

    def test_the_stage_can_be_switched_off(self) -> None:
        """A pipeline keeps the stage in the order, so it can be turned back on."""
        document = CaptionDocument.of(_cue())
        pipeline = (
            CaptionPipeline()
            .with_stage("style", StyleStage(look=look_for(CaptionTemplate.TIKTOK)))
            .disabled_stage("style")
        )
        assert pipeline.run(document, StageContext()).unwrap().segments == document.segments

    def test_the_stage_runs_after_the_break(self) -> None:
        """A re-break then a re-style: the two things an editor asks for together."""
        from nova_studio.services.captions.cues import CueBreaker

        # Comfortably readable speech: speech faster than the reading rate
        # cannot be fixed by breaking, and the pipeline says so (NS-CAPTION-4012)
        # rather than shipping a caption nobody can finish.
        long = " ".join(f"word{index}" for index in range(40))
        document = CaptionDocument.of(_cue(long, step_ms=500))
        pipeline = (
            CaptionPipeline()
            .with_stage("break", CueBreaker())
            .with_stage("style", StyleStage(look=look_for(CaptionTemplate.NETFLIX)))
        )
        result = pipeline.run(document, StageContext())
        assert not isinstance(result, Err), result.error()
        dressed = result.unwrap()
        assert dressed.segment_count > 1
        assert all(
            cue.style_overrides is not None and cue.style_overrides["template"] == "netflix"
            for cue in dressed.segments
        )
