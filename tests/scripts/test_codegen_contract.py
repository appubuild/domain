"""`scripts/codegen_contract.py` — the frontend's view of the API.

What is being pinned is the promise ADR-0001 makes: **the contract is the
tightest coupling in the system, so it is generated, not written**. Two
properties follow, and both are tested:

* **Nothing is lost in translation.** A `T | None` field comes out as
  `T | null` and not as `T | unknown` — a schema mapped to `unknown` is a field
  that stops being checkable everywhere it is used, which is the failure a
  hand-written type would have introduced gradually and invisibly.
* **The committed file is never stale.** A pull request that changes a route
  without regenerating the types is a pull request that compiles locally and
  breaks on the next person's machine, so it fails here instead.

The rest is the vocabulary itself: how a schema becomes a type, and how an
unusable FastAPI operation id becomes a name a caller can type.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from scripts import codegen_contract

REPO_ROOT: Path = Path(__file__).resolve().parent.parent.parent
CONTRACT: Path = REPO_ROOT / "docs" / "architecture" / "api-contract.json"
GENERATED: Path = REPO_ROOT / "frontend" / "src" / "core" / "api" / "contract.ts"

pytestmark = pytest.mark.unit


# -- the type vocabulary ------------------------------------------------------


@pytest.mark.parametrize(
    ("schema", "expected"),
    [
        ({"type": "string"}, "string"),
        ({"type": "integer"}, "number"),
        ({"type": "number"}, "number"),
        ({"type": "boolean"}, "boolean"),
        ({}, "unknown"),
        ({"type": "null"}, "null"),
        ({"$ref": "#/components/schemas/MediaCacheResponse"}, "MediaCacheResponse"),
        ({"type": "array", "items": {"type": "string"}}, "string[]"),
        ({"type": "array", "items": {"$ref": "#/components/schemas/CacheEntry"}}, "CacheEntry[]"),
        ({"enum": ["video", "audio", "image"]}, '"video" | "audio" | "image"'),
        ({"type": "object", "additionalProperties": {"type": "string"}}, "Record<string, string>"),
        ({"type": "object", "additionalProperties": True}, "Record<string, unknown>"),
        ({"const": "preview"}, '"preview"'),
    ],
)
def test_a_schema_becomes_the_type_a_caller_would_have_written(
    schema: dict[str, Any], expected: str
) -> None:
    assert codegen_contract.ts_type(schema) == expected


def test_a_optional_field_stays_nullable_and_checkable() -> None:
    """`anyOf: [T, null]` is how Pydantic spells optional, and mapping `null` to
    `unknown` would make the whole union `unknown` — a field nobody can use."""
    schema = {"anyOf": [{"type": "string"}, {"type": "null"}]}
    assert codegen_contract.ts_type(schema) == "string | null"


def test_an_array_of_nullables_is_nested_not_flattened() -> None:
    schema = {"anyOf": [{"type": "array", "items": {"type": "string"}}, {"type": "null"}]}
    assert codegen_contract.ts_type(schema) == "string[] | null"


def test_a_union_is_deduplicated_in_order() -> None:
    schema = {"anyOf": [{"type": "string"}, {"type": "null"}, {"type": "string"}]}
    assert codegen_contract.ts_type(schema) == "string | null"


def test_a_property_outside_required_is_optional() -> None:
    required = codegen_contract.member_line("total", {"type": "integer"}, required=True)
    optional = codegen_contract.member_line("detail", {"type": "string"}, required=False)
    assert required == "total: number;"
    assert optional == "detail?: string;"


def test_a_name_that_is_not_an_identifier_is_quoted() -> None:
    assert codegen_contract.member_line("in-out", {"type": "string"}, required=True) == (
        '"in-out": string;'
    )


def test_a_docstring_travels_with_the_field() -> None:
    line = codegen_contract.member_line(
        "size_bytes", {"type": "integer", "description": "Bytes."}, required=True
    )
    assert line == "/** Bytes. */\nsize_bytes: number;"


def test_a_comment_that_would_close_the_block_cannot() -> None:
    comment = codegen_contract.doc_comment("how to end a block: */")
    assert "*/" not in comment.split("* /")[0].replace("/**", "")
    assert comment.startswith("/**")
    assert comment.endswith("*/")


# -- naming operations --------------------------------------------------------


def test_a_fastapi_operation_id_becomes_a_name_a_caller_can_type() -> None:
    key = codegen_contract.operation_key(
        "ensure_media_api_v1_projects__project_id__media_ensure_post",
        "/api/v1/projects/{project_id}/media/ensure",
        set(),
    )
    assert key == "ensureMedia"


def test_an_operation_outside_the_api_prefix_keeps_its_whole_name() -> None:
    key = codegen_contract.operation_key("healthz", "/healthz", set())
    assert key == "healthz"


def test_two_handlers_with_one_name_do_not_overwrite_each_other() -> None:
    path = "/api/v1/projects/{project_id}/media/ensure"
    first = codegen_contract.operation_key("ensure_media_api_v1_x_post", path, set())
    second = codegen_contract.operation_key("ensure_media_api_v1_y_post", path, {first})
    assert first != second


@pytest.mark.parametrize(
    ("snake", "expected"),
    [("ensure_media", "ensureMedia"), ("healthz", "healthz"), ("", ""), ("a_b_c", "aBC")],
)
def test_camel_case(snake: str, expected: str) -> None:
    assert codegen_contract.camel_case(snake) == expected


# -- the document -------------------------------------------------------------


@pytest.fixture
def document() -> dict[str, Any]:
    return json.loads(CONTRACT.read_text(encoding="utf-8"))


def test_every_schema_and_operation_reaches_the_file(document: dict[str, Any]) -> None:
    rendered = codegen_contract.render(document)
    for name in document["components"]["schemas"]:
        assert f"export type {name} =" in rendered or f"export interface {name} {{" in rendered
    for operation in codegen_contract.collect_operations(document):
        assert f'    path: "{operation.path}",' in rendered


def test_the_operations_table_describes_the_route_it_calls(document: dict[str, Any]) -> None:
    operations = {
        operation.key: operation for operation in codegen_contract.collect_operations(document)
    }
    ensure = operations["ensureMedia"]
    assert ensure.method == "post"
    assert ensure.path == "/api/v1/projects/{project_id}/media/ensure"
    assert ensure.path_params == ("project_id",)
    assert ensure.request_body == "EnsureMediaRequest"
    assert ensure.response == "EnsureMediaResponse"
    assert ensure.success == 202


def test_a_route_that_answers_a_picture_is_not_a_document(document: dict[str, Any]) -> None:
    """FastAPI documents an extra `application/json` entry for the same status;
    preferring it would tell the generated client to parse a JPEG."""
    operations = {
        operation.key: operation for operation in codegen_contract.collect_operations(document)
    }
    assert operations["previewFrame"].response_format == "blob"
    assert operations["previewFrame"].response is None


def test_rendering_is_deterministic(document: dict[str, Any]) -> None:
    """A generated file that changed every run would make every commit a diff."""
    assert codegen_contract.render(document) == codegen_contract.render(document)


def test_the_committed_types_match_the_committed_contract(document: dict[str, Any]) -> None:
    """The whole point: a route changed without `make contract` fails here."""
    assert GENERATED.is_file(), "run `make contract`"
    assert GENERATED.read_text(encoding="utf-8") == codegen_contract.render(document)


# -- the command --------------------------------------------------------------


def test_check_fails_when_the_file_is_stale(tmp_path: Path, document: dict[str, Any]) -> None:
    out = tmp_path / "contract.ts"
    assert codegen_contract.main(["--contract", str(CONTRACT), "--out", str(out)]) == 0
    assert codegen_contract.main(["--contract", str(CONTRACT), "--out", str(out), "--check"]) == 0
    out.write_text("export type HandWritten = string;\n", encoding="utf-8")
    assert codegen_contract.main(["--contract", str(CONTRACT), "--out", str(out), "--check"]) == 1


def test_check_fails_when_there_is_no_file_yet(tmp_path: Path) -> None:
    assert (
        codegen_contract.main(
            ["--contract", str(CONTRACT), "--out", str(tmp_path / "missing.ts"), "--check"]
        )
        == 1
    )
