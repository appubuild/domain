"""Generate the frontend's view of the API contract from the OpenAPI document.

ADR-0001 chose a monorepo because *the API contract is the tightest coupling in
the system*: a backend DTO, its frontend type and the test that pins them must
be one atomic change. This script is that coupling, made mechanical.

    python scripts/codegen_contract.py --check

It reads `docs/architecture/api-contract.json` — which `python -m nova_studio
openapi` writes from the *routes*, so it cannot drift from the code — and emits
`frontend/src/core/api/contract.ts`:

* one TypeScript type per schema, with the backend's own docstrings as JSDoc;
* a table of every operation: method, path template, which parameters go in the
  path and which in the query, the request and response schema names, and the
  success status.

What it deliberately does **not** generate: a client. Transport is a policy —
timeouts, retries, cancellation, how a `problem+json` becomes a toast — and a
policy belongs in hand-written code (`frontend/src/core/api/client.ts`) that is
reviewed and tested like any other. A generated client is a client nobody
reviews and everybody works around.

**Determinism is a requirement, not a nicety.** Schema and operation order is
sorted, output is byte-stable, and `--check` fails when the committed file is
stale — the same rule the Python side applies to the contract itself, so a
pull request cannot change the API without changing the types that call it.

Usage:
    python scripts/codegen_contract.py [--contract PATH] [--out PATH] [--check]
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO_ROOT: Path = Path(__file__).resolve().parent.parent
DEFAULT_CONTRACT: Path = REPO_ROOT / "docs" / "architecture" / "api-contract.json"
DEFAULT_OUT: Path = REPO_ROOT / "frontend" / "src" / "core" / "api" / "contract.ts"

#: The marker every generated file starts with, so a reader knows where it came
#: from and a linter knows not to complain about its shape.
HEADER: str = "@generated"

__all__ = [
    "Operation",
    "main",
    "render",
]


# -- the OpenAPI → TypeScript vocabulary -------------------------------------


@dataclass(frozen=True, slots=True)
class Operation:
    """One endpoint, as the frontend needs to see it."""

    key: str
    method: str
    path: str
    summary: str
    path_params: tuple[str, ...]
    query_params: tuple[str, ...]
    request_body: str | None
    response: str | None
    success: int
    #: `json` or `blob` — a preview frame is a picture, not a document.
    response_format: str

    @property
    def is_json(self) -> bool:
        return self.response_format == "json"


def ts_literal(value: Any) -> str:
    """One JSON value as one TypeScript literal."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    escaped = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def ts_type(schema: dict[str, Any]) -> str:
    """One JSON Schema node as one TypeScript type.

    Handles what FastAPI actually emits: `$ref`, `enum`, `anyOf` (which is how
    Pydantic spells `T | None`), arrays, `additionalProperties` for the
    `dict[str, T]` fields, and the primitives. Anything else collapses to
    `unknown` rather than to `any` — an unrecognised shape should be visible at
    the call site, not silently assignable.
    """
    if not schema:
        return "unknown"

    if "$ref" in schema:
        return ref_name(str(schema["$ref"]))

    if "const" in schema:
        return ts_literal(schema["const"])

    if "enum" in schema:
        members = [ts_literal(member) for member in schema["enum"]]
        return " | ".join(members) if members else "never"

    for keyword in ("anyOf", "oneOf"):
        if keyword in schema:
            members = [ts_type(member) for member in schema[keyword]]
            # `T | null | null` reads badly and means nothing; dedupe in order.
            unique = list(dict.fromkeys(members))
            return " | ".join(unique) if unique else "never"

    if "allOf" in schema:
        return " & ".join(ts_type(member) for member in schema["allOf"])

    kind = schema.get("type")
    if isinstance(kind, list):
        # OpenAPI 3.1 allows a list, which is what `type: [string, null]` means.
        return " | ".join(ts_type({**schema, "type": one}) for one in kind)

    if kind == "array":
        item = ts_type(schema.get("items") or {})
        return f"Array<{item}>" if " " in item else f"{item}[]"

    if kind == "object" or "properties" in schema or "additionalProperties" in schema:
        extra = schema.get("additionalProperties")
        if isinstance(extra, dict):
            value = ts_type(extra)
            return f"Record<string, {value}>"
        if extra is True:
            return "Record<string, unknown>"
        if "properties" in schema:
            return render_object(schema)
        return "Record<string, unknown>"

    return {
        "string": "string",
        "integer": "number",
        "number": "number",
        "boolean": "boolean",
        # OpenAPI 3.1 writes `{"type": "null"}`, which is how Pydantic spells
        # `None`. Mapping it to `unknown` would make every optional field a
        # lie: `string | unknown` is `unknown`, and the field stops being
        # checkable anywhere it is used.
        "null": "null",
    }.get(str(kind), "unknown")


def render_object(schema: dict[str, Any]) -> str:
    """An inline object literal, for a nested model with no name of its own."""
    return "{\n" + _members(schema, indent="  ") + "\n}"


def _members(schema: dict[str, Any], *, indent: str) -> str:
    """The body of an object type: one documented property per line."""
    required = set(schema.get("required") or ())
    blocks: list[str] = []
    for name, member in sorted((schema.get("properties") or {}).items()):
        blocks.append(member_line(name, member or {}, required=name in required, indent=indent))
    return "\n".join(block for block in blocks if block)


def member_line(name: str, schema: dict[str, Any], *, required: bool, indent: str = "") -> str:
    """One property of an object type, with its docstring above it."""
    optional = "" if required else "?"
    field = name if _is_identifier(name) else f'"{name}"'
    comment = doc_comment(schema.get("description"), indent=indent)
    prefix = f"{comment}\n" if comment else ""
    return f"{prefix}{indent}{field}{optional}: {ts_type(schema)};"


def ref_name(ref: str) -> str:
    """`#/components/schemas/MediaCacheResponse` → `MediaCacheResponse`."""
    return ref.rsplit("/", 1)[-1]


def doc_comment(description: Any, *, indent: str = "") -> str:
    """A schema's description as a JSDoc block, or empty when it has none.

    The backend writes these for the same reason the frontend keeps them: a
    type nobody can hover is a type everybody has to go and read the source of.
    """
    if not isinstance(description, str) or not description.strip():
        return ""
    text = description.replace("*/", "* /").strip()
    lines = [line.rstrip() for line in text.splitlines()]
    if len(lines) == 1:
        return f"{indent}/** {lines[0]} */"
    body = "\n".join(f"{indent} * {line}".rstrip() for line in lines)
    return f"{indent}/**\n{body}\n{indent} */"


def _is_identifier(name: str) -> bool:
    return name.replace("_", "a").isidentifier() and not name[0].isdigit()


# -- operations ---------------------------------------------------------------


def camel_case(snake: str) -> str:
    """`ensure_media` → `ensureMedia`; already-camel names are left alone."""
    parts = [part for part in snake.split("_") if part]
    if not parts:
        return snake
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


def operation_key(operation_id: str, path: str, taken: set[str]) -> str:
    """A short, stable name for one operation.

    FastAPI names operations `<handler>_<sanitised path>_<method>`, which is
    precise and unusable: `ensure_media_api_v1_projects__project_id__media_ensure_post`.
    The handler's own name is everything before the path, so that is the key —
    `ensureMedia`. Two handlers sharing a name would collide, so the second one
    keeps its full name rather than silently overwriting the first.
    """
    prefix, separator, _rest = operation_id.partition("_api_v1")
    candidate = (
        camel_case(prefix) if separator and path.startswith("/api/v1") else camel_case(operation_id)
    )
    if candidate not in taken:
        return candidate
    return camel_case(operation_id)


def schema_of(content: dict[str, Any]) -> tuple[str | None, str]:
    """The response schema name and format for one response's media types.

    A route that answers a *picture* is documented twice by FastAPI: once as the
    `image/jpeg` the handler sends, and once as a ghost `application/json` entry
    with nothing in it. Preferring the ghost would tell a generated client to
    parse a JPEG as a document, so a named schema always wins, and an unnamed
    non-JSON entry is read as bytes.
    """
    for entry in content.values():
        schema = (entry or {}).get("schema") or {}
        if "$ref" in schema:
            return ref_name(str(schema["$ref"])), "json"
    for media_type, entry in content.items():
        schema = (entry or {}).get("schema") or {}
        if media_type != "application/json" and (
            schema.get("format") == "binary" or schema.get("type") == "string"
        ):
            return None, "blob"
    return None, "json"


def collect_operations(doc: dict[str, Any]) -> tuple[Operation, ...]:
    """Every operation in the document, keyed and sorted for a stable file."""
    taken: set[str] = set()
    found: list[Operation] = []
    for path, methods in sorted((doc.get("paths") or {}).items()):
        for method, body in sorted((methods or {}).items()):
            if method.lower() not in {"get", "post", "put", "patch", "delete", "head"}:
                continue
            operation_id = str(body.get("operationId") or f"{method}_{path}")
            key = operation_key(operation_id, path, taken)
            taken.add(key)

            path_params: list[str] = []
            query_params: list[str] = []
            for parameter in body.get("parameters") or ():
                name = str(parameter.get("name"))
                if str(parameter.get("in")) == "path":
                    path_params.append(name)
                elif str(parameter.get("in")) == "query":
                    query_params.append(name)

            request_body: str | None = None
            content = (body.get("requestBody") or {}).get("content") or {}
            if "application/json" in content:
                schema = content["application/json"].get("schema") or {}
                if "$ref" in schema:
                    request_body = ref_name(str(schema["$ref"]))

            responses = body.get("responses") or {}
            success = min(
                (int(status) for status in responses if str(status).startswith("2")), default=200
            )
            response, response_format = schema_of(
                (responses.get(str(success)) or {}).get("content") or {}
            )

            found.append(
                Operation(
                    key=key,
                    method=method.lower(),
                    path=str(path),
                    summary=str(body.get("summary") or ""),
                    path_params=tuple(path_params),
                    query_params=tuple(query_params),
                    request_body=request_body,
                    response=response,
                    success=success,
                    response_format=response_format,
                )
            )
    return tuple(sorted(found, key=lambda operation: operation.key))


# -- rendering ----------------------------------------------------------------


def render(doc: dict[str, Any]) -> str:
    """The whole generated file, as one string."""
    source = Path(str(doc.get("__source__") or "docs/architecture/api-contract.json")).as_posix()
    version = str((doc.get("info") or {}).get("version") or "0.0.0")
    schemas: dict[str, Any] = (doc.get("components") or {}).get("schemas") or {}

    lines: list[str] = [
        "/**",
        f" * {HEADER} by scripts/codegen_contract.py from {source}.",
        " *",
        " * Do not edit. Edit the route, run `make contract`, and commit the two",
        " * together: the frontend's view of the API is generated from the routes",
        " * themselves, so a type that disagrees with the backend is a build that",
        " * has not been run yet.",
        " */",
        "",
        "/* eslint-disable */",
        "",
        "/** The service version this contract was generated from. */",
        f'export const CONTRACT_VERSION = "{version}";',
        "",
    ]

    for name in sorted(schemas):
        schema = schemas[name] or {}
        description = schema.get("description")
        enum_members = schema.get("enum")
        if enum_members is not None:
            lines.append(doc_comment(description))
            members = " | ".join(ts_literal(member) for member in enum_members)
            lines.append(f"export type {name} = {members};")
        elif "properties" in schema:
            lines.append(doc_comment(description))
            lines.append(f"export interface {name} {{")
            lines.append(_members(schema, indent="  "))
            lines.append("}")
        else:
            # A bare alias: `dict[str, str]`, a union, anything unnamed.
            lines.append(doc_comment(description))
            lines.append(f"export type {name} = {ts_type(schema)};")
        lines.append("")

    lines.append("/** Every schema in the contract, by name — how an operation's")
    lines.append(" *  `requestBody` and `response` strings become types. */")
    lines.append("export interface Schemas {")
    lines.extend(f"  readonly {name}: {name};" for name in sorted(schemas))
    lines.append("}")
    lines.append("")

    lines.append("/** What one endpoint needs, as data rather than as a function, so")
    lines.append(" *  that transport stays a policy and the table stays reviewable. */")
    lines.append("export interface OperationSpec {")
    lines.append('  readonly method: "get" | "post" | "put" | "patch" | "delete";')
    lines.append("  readonly path: string;")
    lines.append("  readonly summary: string;")
    lines.append("  readonly pathParams: readonly string[];")
    lines.append("  readonly queryParams: readonly string[];")
    lines.append("  readonly requestBody: keyof Schemas | null;")
    lines.append("  readonly response: keyof Schemas | null;")
    lines.append("  readonly success: number;")
    lines.append('  readonly responseFormat: "json" | "blob";')
    lines.append("}")
    lines.append("")

    lines.append("/** Every endpoint the service offers, keyed by the handler that")
    lines.append(' *  serves it. `client.run("ensureMedia", …)` is typed from this. */')
    lines.append("export const OPERATIONS = {")
    for operation in collect_operations(doc):
        lines.append(f"  {_quote_key(operation.key)}: {{")
        lines.append(f'    method: "{operation.method}",')
        lines.append(f'    path: "{operation.path}",')
        lines.append(f"    summary: {ts_literal(operation.summary)},")
        lines.append(f"    pathParams: {_array(operation.path_params)},")
        lines.append(f"    queryParams: {_array(operation.query_params)},")
        lines.append(f"    requestBody: {ts_literal(operation.request_body)},")
        lines.append(f"    response: {ts_literal(operation.response)},")
        lines.append(f"    success: {operation.success},")
        lines.append(f'    responseFormat: "{operation.response_format}",')
        lines.append("  },")
    lines.append("} as const satisfies Record<string, OperationSpec>;")
    lines.append("")
    return "\n".join(lines)


def _array(values: tuple[str, ...]) -> str:
    if not values:
        return "[]"
    return "[" + ", ".join(ts_literal(value) for value in values) + "]"


def _quote_key(key: str) -> str:
    return key if _is_identifier(key) else f'"{key}"'


# -- entry point --------------------------------------------------------------


def _display(path: Path) -> str:
    """A path for a human, relative to the repository when it can be.

    A `--out` outside the repo is legal — a test writes to `tmp_path` — and
    crashing while formatting the success message is a spectacular way to
    report success.
    """
    try:
        return path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return str(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--contract", type=Path, default=DEFAULT_CONTRACT, help="the OpenAPI document to read"
    )
    parser.add_argument(
        "--out", type=Path, default=DEFAULT_OUT, help="the TypeScript file to write"
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail when the committed file is stale, instead of writing it",
    )
    arguments = parser.parse_args(argv)

    document = json.loads(arguments.contract.read_text(encoding="utf-8"))
    document["__source__"] = arguments.contract.relative_to(REPO_ROOT).as_posix()
    rendered = render(document)

    if arguments.check:
        current = arguments.out.read_text(encoding="utf-8") if arguments.out.is_file() else ""
        if current != rendered:
            print(
                f"{_display(arguments.out)} is stale — run `make contract`",
                file=sys.stderr,
            )
            return 1
        print("frontend contract is up to date")
        return 0

    arguments.out.parent.mkdir(parents=True, exist_ok=True)
    arguments.out.write_text(rendered, encoding="utf-8")
    print(f"wrote {_display(arguments.out)} ({len(rendered.encode('utf-8'))} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
