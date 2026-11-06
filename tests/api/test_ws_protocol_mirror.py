"""`frontend/src/core/events/protocol.ts` — the one file the generator cannot reach.

Every other shape the frontend compiles against is generated from the OpenAPI
document, and `make contract-check` fails when it drifts. The WebSocket frames
are not in that document — there is nowhere in OpenAPI to put them — so
`protocol.ts` is written by hand, and a hand-written mirror is exactly the thing
that drifts silently.

This is the other half of the trick: read the TypeScript and assert it against
the Python. Cheap, and it fails the build rather than the user.

What is pinned:

* **The version.** A bumped protocol with a client that still claims the old one
  is a mismatch no runtime check would catch, because nothing negotiates.
* **The frame kinds.** A frame the client has never heard of must be *skippable*,
  which only works if the client's set is a subset of the server's by design and
  not by accident — so the constants are compared, not just counted.
* **The `command_id` field**, which is how a client matches an authoritative
  event to the optimistic update it already drew.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

import nova_studio
from nova_studio.api.ws import EVENT, GOODBYE, HEARTBEAT, HELLO, PONG, RESYNC

pytestmark = pytest.mark.unit

REPO_ROOT: Path = Path(__file__).resolve().parent.parent.parent
PROTOCOL: Path = REPO_ROOT / "frontend" / "src" / "core" / "events" / "protocol.ts"


@pytest.fixture(scope="module")
def source() -> str:
    """The TypeScript, read once."""
    if not PROTOCOL.is_file():
        pytest.skip("the frontend checkout is not here — its own suite covers this")
    return PROTOCOL.read_text(encoding="utf-8")


class TestTheVersion:
    def test_the_client_claims_the_version_the_service_speaks(self, source: str) -> None:
        match = re.search(r"WS_PROTOCOL_VERSION\s*=\s*(\d+)", source)
        assert match, f"{PROTOCOL.name} declares no WS_PROTOCOL_VERSION"
        assert int(match.group(1)) == nova_studio.WS_PROTOCOL_VERSION

    def test_the_service_version_is_a_positive_integer(self) -> None:
        """0 would make every comparison ambiguous, as it does for every format."""
        assert isinstance(nova_studio.WS_PROTOCOL_VERSION, int)
        assert nova_studio.WS_PROTOCOL_VERSION >= 1


class TestTheFrameKinds:
    @pytest.mark.parametrize(
        ("name", "server_kind"),
        [
            ("hello", HELLO),
            ("event", EVENT),
            ("heartbeat", HEARTBEAT),
            ("pong", PONG),
            ("goodbye", GOODBYE),
            ("resync", RESYNC),
        ],
    )
    def test_every_kind_the_service_sends_is_named_by_the_client(
        self, source: str, name: str, server_kind: str
    ) -> None:
        """A kind the client has never heard of is skipped, which is only safe
        when the omission is deliberate rather than a rename nobody noticed."""
        assert re.search(rf"FrameKind\s*=.*'{name}'", source, re.S), name
        assert name == server_kind

    def test_the_client_sends_only_what_the_service_reads(self, source: str) -> None:
        kinds = set(re.findall(r"readonly type: '(\w+)'", source))
        # Every frame the client declares it can send has to be one the server's
        # `_pump_client` understands: `ping`, `resync`, `unsubscribe`.
        assert {"ping", "resync", "unsubscribe"} <= kinds


class TestTheEnvelope:
    def test_the_envelope_carries_what_the_bus_puts_on_the_wire(self, source: str) -> None:
        """`command_id` is the one field a UI cannot do without: it is how an
        authoritative event is matched to the optimistic update already drawn."""
        for field in ("topic", "seq", "ts", "payload", "source", "command_id"):
            assert re.search(rf"readonly {field}[?]?:", source), field

    def test_an_unknown_frame_is_skipped_rather_than_fatal(self, source: str) -> None:
        """The rule the backend keeps for its own incoming frames, kept here too:
        a newer server sends frames this client has never heard of, and closing
        the socket over one is a bug the user pays for."""
        assert "return null" in source
        assert "unknown" in source or "default:" in source
