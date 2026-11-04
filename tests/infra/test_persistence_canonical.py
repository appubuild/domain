"""`infra/persistence/canonical.py` — the byte-level spelling of a document.

Canonical JSON is a *format* property (`project-file-format.md` §4), not a
style, and each rule exists because something downstream depends on the bytes
being stable: a checksum that changes every save is not a checksum, and a diff
that shows whitespace is not a diff.

Pinned here: sorted keys at every depth, no whitespace, UTF-8 with no BOM, one
trailing newline, integers that stay integers, and — in both directions — the
refusal of `NaN` and `Infinity`, which `json.loads` accepts by default and which
therefore have to be rejected twice.
"""

from __future__ import annotations

import pytest

from nova_studio.infra.persistence.canonical import (
    CanonicalJsonError,
    digest_document,
    digest_of,
    dumps_canonical,
    loads_canonical,
)

pytestmark = pytest.mark.unit


class TestWriting:
    def test_keys_are_sorted(self) -> None:
        assert dumps_canonical({"b": 1, "a": 2}) == b'{"a":2,"b":1}\n'

    def test_keys_are_sorted_at_every_depth(self) -> None:
        document = {"outer": {"z": 1, "y": {"b": 2, "a": 3}}}
        assert dumps_canonical(document) == b'{"outer":{"y":{"a":3,"b":2},"z":1}}\n'

    def test_there_is_no_insignificant_whitespace(self) -> None:
        assert b", " not in dumps_canonical({"a": 1, "b": 2})

    def test_there_is_a_trailing_newline(self) -> None:
        assert dumps_canonical({"a": 1}).endswith(b"\n")

    def test_there_is_exactly_one_trailing_newline(self) -> None:
        assert dumps_canonical({"a": 1}).count(b"\n") == 1

    def test_the_encoding_is_utf8(self) -> None:
        assert dumps_canonical({"name": "café"}) == '{"name":"café"}\n'.encode()

    def test_non_ascii_is_not_escaped(self) -> None:
        """A support engineer running `unzip -p` should be able to read it."""
        assert b"\\u" not in dumps_canonical({"name": "café"})

    def test_integers_stay_integers(self) -> None:
        assert dumps_canonical({"frames": 180}) == b'{"frames":180}\n'

    def test_a_rational_stays_a_pair_of_integers(self) -> None:
        assert dumps_canonical({"speed": [30000, 1001]}) == b'{"speed":[30000,1001]}\n'

    def test_an_empty_document(self) -> None:
        assert dumps_canonical({}) == b"{}\n"

    def test_nan_is_refused(self) -> None:
        with pytest.raises(CanonicalJsonError):
            dumps_canonical({"value": float("nan")})

    def test_infinity_is_refused(self) -> None:
        with pytest.raises(CanonicalJsonError):
            dumps_canonical({"value": float("inf")})

    def test_a_value_json_cannot_hold_is_refused(self) -> None:
        with pytest.raises(CanonicalJsonError):
            dumps_canonical({"value": {1, 2}})  # type: ignore[dict-item]

    def test_two_saves_of_the_same_document_are_identical(self) -> None:
        document = {"z": 1, "a": {"n": 2, "m": 3}}
        assert dumps_canonical(document) == dumps_canonical(document)

    def test_key_order_does_not_change_the_bytes(self) -> None:
        assert dumps_canonical({"a": 1, "b": 2}) == dumps_canonical({"b": 2, "a": 1})


class TestReading:
    def test_a_document_round_trips(self) -> None:
        document = {"name": "holiday", "tracks": [{"clip_id": "c1"}]}
        assert loads_canonical(dumps_canonical(document)) == document

    def test_a_list_is_not_a_document(self) -> None:
        with pytest.raises(CanonicalJsonError):
            loads_canonical(b"[1, 2, 3]\n")

    def test_a_scalar_is_not_a_document(self) -> None:
        with pytest.raises(CanonicalJsonError):
            loads_canonical(b"42\n")

    def test_text_that_is_not_json_is_refused(self) -> None:
        with pytest.raises(CanonicalJsonError):
            loads_canonical(b"not json at all")

    def test_bytes_that_are_not_utf8_are_refused(self) -> None:
        with pytest.raises(CanonicalJsonError):
            loads_canonical(b'{"name":"\xff\xfe"}')

    def test_nan_in_a_file_is_refused(self) -> None:
        """`json.loads` accepts these by default, which is the trap."""
        with pytest.raises(CanonicalJsonError):
            loads_canonical(b'{"value":NaN}')

    def test_infinity_in_a_file_is_refused(self) -> None:
        with pytest.raises(CanonicalJsonError):
            loads_canonical(b'{"value":Infinity}')

    def test_empty_bytes_are_refused(self) -> None:
        with pytest.raises(CanonicalJsonError):
            loads_canonical(b"")

    def test_an_empty_object_is_a_document(self) -> None:
        assert loads_canonical(b"{}\n") == {}

    def test_the_error_says_what_is_wrong(self) -> None:
        with pytest.raises(CanonicalJsonError, match="not JSON"):
            loads_canonical(b"{oops")


class TestDigests:
    def test_a_digest_is_stable(self) -> None:
        assert digest_document({"a": 1}) == digest_document({"a": 1})

    def test_a_digest_covers_the_bytes_not_the_mapping(self) -> None:
        """Two dicts that compare equal can still be written differently."""
        assert digest_document({"a": 1}) == digest_document({"a": 1})
        assert digest_document({"a": 1}) != digest_document({"a": 2})

    def test_a_digest_carries_its_algorithm(self) -> None:
        assert str(digest_of(b"hello")).startswith("sha256:")

    def test_a_digest_is_hex_of_the_expected_length(self) -> None:
        assert len(digest_of(b"hello").digest) == 64

    def test_different_bytes_digest_differently(self) -> None:
        assert digest_of(b"hello") != digest_of(b"hellp")

    def test_the_digest_of_a_document_is_the_digest_of_its_bytes(self) -> None:
        assert digest_document({"a": 1}) == digest_of(dumps_canonical({"a": 1}))
