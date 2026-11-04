"""`api/routers/events.py` — the same stream the socket carries, as a REST read.

This endpoint exists because the socket cannot serve every caller that needs
recent events: a command-line tool, a Playwright test, and the frontend's own
"am I behind?" check all want the tail of history without holding a connection
open, and making them open one would put a socket in the way of a question.

What is being pinned is the honesty of the answer. A client that asks for events
older than the retained history must be told *that they are gone* — with a 416
that names the oldest sequence — rather than be handed a partial window that
looks like the whole truth. A gap nobody admits to is how a timeline silently
goes stale.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from tests.api.conftest import build_app, client_for

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

    from nova_studio.api.state import SessionState
    from nova_studio.core.events import EventBus

pytestmark = pytest.mark.unit


def publish(bus: EventBus, count: int, topic: str = "test.tick") -> None:
    """Publish `count` distinguishable events."""
    for index in range(count):
        bus.publish(topic, {"index": index}, source="test")


class TestReadingTheTail:
    def test_the_service_announced_itself(self, client: TestClient, auth: dict[str, str]) -> None:
        """Lifespan publishes `api.started`, so a client can wait for it."""
        body = client.get("/api/v1/events", headers=auth).json()
        assert [event["topic"] for event in body["events"]] == ["api.started"]

    def test_it_returns_what_was_published(
        self, client: TestClient, auth: dict[str, str], bus: EventBus
    ) -> None:
        bus.publish("timeline.clip.moved", {"clip_id": "c1"}, source="test")
        body = client.get("/api/v1/events", headers=auth).json()
        assert "timeline.clip.moved" in [event["topic"] for event in body["events"]]

    def test_since_skips_what_the_client_already_has(
        self, client: TestClient, auth: dict[str, str], bus: EventBus
    ) -> None:
        bus.publish("test.one", {"n": 1})
        bus.publish("test.two", {"n": 2})
        body = client.get("/api/v1/events?since=2", headers=auth).json()
        assert [event["topic"] for event in body["events"]] == ["test.two"]

    def test_the_limit_is_honoured(
        self, client: TestClient, auth: dict[str, str], bus: EventBus
    ) -> None:
        publish(bus, 10)
        body = client.get("/api/v1/events?limit=3", headers=auth).json()
        assert body["count"] == 3
        assert len(body["events"]) == 3

    def test_everything_kept_is_returned_by_default(
        self, client: TestClient, auth: dict[str, str], bus: EventBus
    ) -> None:
        """The default is bounded by the bus's history, not by the endpoint."""
        publish(bus, 5)
        body = client.get("/api/v1/events", headers=auth).json()
        assert body["count"] == 6  # the five published, plus `api.started`

    def test_it_reports_where_the_stream_is(
        self, client: TestClient, auth: dict[str, str], bus: EventBus
    ) -> None:
        publish(bus, 3)
        body = client.get("/api/v1/events", headers=auth).json()
        assert body["last_seq"] == bus.last_seq
        assert body["oldest_seq"] == bus.oldest_seq

    def test_every_event_carries_a_sequence_number(
        self, client: TestClient, auth: dict[str, str], bus: EventBus
    ) -> None:
        """The sequence is what makes a gap detectable at all."""
        publish(bus, 3)
        sequences = [
            event["seq"] for event in client.get("/api/v1/events", headers=auth).json()["events"]
        ]
        assert sequences == sorted(sequences)
        assert sequences == list(range(sequences[0], sequences[0] + len(sequences)))

    def test_the_wire_shape_matches_the_socket(
        self, client: TestClient, auth: dict[str, str], bus: EventBus
    ) -> None:
        bus.publish("test.shape", {"a": 1}, source="test")
        event = client.get("/api/v1/events", headers=auth).json()["events"][-1]
        assert event["type"] == "event"
        assert event["topic"] == "test.shape"
        assert event["payload"] == {"a": 1}
        assert event["source"] == "test"
        assert isinstance(event["ts"], int)


class TestAGapIsAdmitted:
    def test_a_request_older_than_history_is_refused(
        self, client: TestClient, auth: dict[str, str], bus: EventBus
    ) -> None:
        publish(bus, 40)  # history holds 32
        response = client.get("/api/v1/events?since=1", headers=auth)
        assert response.status_code == 416

    def test_the_refusal_names_the_oldest_sequence_kept(
        self, client: TestClient, auth: dict[str, str], bus: EventBus
    ) -> None:
        publish(bus, 40)
        detail = client.get("/api/v1/events?since=1", headers=auth).json()["detail"]
        assert str(bus.oldest_seq) in detail

    def test_a_request_inside_history_succeeds(
        self, client: TestClient, auth: dict[str, str], bus: EventBus
    ) -> None:
        publish(bus, 40)
        assert client.get(f"/api/v1/events?since={bus.oldest_seq}", headers=auth).status_code == 200

    def test_zero_means_everything_kept(
        self, client: TestClient, auth: dict[str, str], bus: EventBus
    ) -> None:
        publish(bus, 5)
        assert client.get("/api/v1/events?since=0", headers=auth).status_code == 200


class TestTheQueryStringIsValidated:
    @pytest.mark.parametrize("query", ["limit=0", "limit=2001", "since=-1", "limit=abc"])
    def test_a_nonsense_query_is_a_validation_problem(
        self, client: TestClient, auth: dict[str, str], query: str
    ) -> None:
        response = client.get(f"/api/v1/events?{query}", headers=auth)
        assert response.status_code == 422
        assert response.json()["code"] == "NS-VALIDATION-4220"

    def test_the_problem_names_the_field(self, client: TestClient, auth: dict[str, str]) -> None:
        body = client.get("/api/v1/events?limit=0", headers=auth).json()
        assert [item["field"] for item in body["fields"]] == ["limit"]


class TestLifeSpan:
    def test_stopping_announces_itself(
        self, bus: EventBus, session: SessionState, auth: dict[str, str]
    ) -> None:
        """A shell that has just been told the service is going away does not
        keep polling it."""
        with client_for(build_app(bus, session)) as client:
            client.get("/healthz")
        topics = [envelope.topic for envelope in bus.replay_from(0)]
        assert "api.started" in topics
        assert "api.stopped" in topics
        assert topics.index("api.started") < topics.index("api.stopped")
