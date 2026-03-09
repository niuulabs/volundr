"""Tests for the Bifröst proxy core."""

from __future__ import annotations

import json

import pytest
import starlette.requests
from starlette.testclient import TestClient

from volundr.bifrost.config import BifrostConfig
from volundr.bifrost.proxy import (
    METRICS_TOPIC,
    BifrostProxy,
    _extract_turn_from_json,
    _extract_turn_from_sse,
    _mutate_model,
)
from volundr.bifrost.router import ModelRouter, RouteConfig
from volundr.bifrost.rules import DefaultRule, RuleEngine
from volundr.bifrost.upstream_registry import UpstreamRegistry

from .conftest import (
    MockSynapse,
    MockUpstreamProvider,
    make_non_streaming_response,
    make_streaming_chunks,
)

MODEL = "claude-sonnet-4-5-20250929"
OPUS = "claude-opus-4-5-20250929"
REQUEST_BODY = {
    "model": MODEL,
    "messages": [{"role": "user", "content": "hi"}],
}


def _make_proxy(
    upstream: MockUpstreamProvider,
    synapse: MockSynapse,
) -> BifrostProxy:
    registry = UpstreamRegistry({"default": upstream})
    rule_engine = RuleEngine([DefaultRule()])
    router = ModelRouter({"default": RouteConfig()})
    config = BifrostConfig()
    return BifrostProxy(registry, synapse, rule_engine, router, config)


def _make_test_app(proxy: BifrostProxy):
    from fastapi import FastAPI

    app = FastAPI()

    @app.post("/v1/messages")
    async def messages(request: starlette.requests.Request):
        return await proxy.handle_request(request)

    return app


# ------------------------------------------------------------------
# Unit tests for response parsing helpers
# ------------------------------------------------------------------


class TestExtractTurnFromJson:
    def test_extracts_usage_and_model(self):
        body = make_non_streaming_response(
            model=OPUS,
            input_tokens=200,
            output_tokens=80,
            stop_reason="end_turn",
        )
        turn = _extract_turn_from_json(body, OPUS, 42.0)

        assert turn.response_model == OPUS
        assert turn.input_tokens == 200
        assert turn.output_tokens == 80
        assert turn.stop_reason == "end_turn"
        assert turn.latency_ms == 42.0
        assert turn.streamed is False

    def test_handles_malformed_json(self):
        turn = _extract_turn_from_json(b"not json", "model", 10.0)
        assert turn.input_tokens == 0
        assert turn.output_tokens == 0
        assert turn.response_model is None

    def test_handles_missing_usage(self):
        body = json.dumps({"model": "test", "content": []}).encode()
        turn = _extract_turn_from_json(body, "test", 5.0)
        assert turn.input_tokens == 0
        assert turn.output_tokens == 0


class TestExtractTurnFromSse:
    def test_extracts_from_stream_events(self):
        chunks = make_streaming_chunks(
            model=MODEL,
            input_tokens=150,
            output_tokens=60,
        )
        buffer = bytearray(b"".join(chunks))
        turn = _extract_turn_from_sse(buffer, MODEL, 100.0)

        assert turn.response_model == MODEL
        assert turn.input_tokens == 150
        assert turn.output_tokens == 60
        assert turn.stop_reason == "end_turn"
        assert turn.latency_ms == 100.0
        assert turn.streamed is True

    def test_handles_empty_buffer(self):
        turn = _extract_turn_from_sse(bytearray(), "model", 5.0)
        assert turn.input_tokens == 0
        assert turn.output_tokens == 0
        assert turn.response_model is None

    def test_handles_malformed_sse_lines(self):
        buf = bytearray(b"event: message_start\ndata: not json\n\n")
        turn = _extract_turn_from_sse(buf, "model", 5.0)
        assert turn.input_tokens == 0


# ------------------------------------------------------------------
# Unit test for _mutate_model
# ------------------------------------------------------------------


class TestMutateModel:
    def test_replaces_model_field(self):
        body = json.dumps({"model": "old", "messages": []}).encode()
        result = _mutate_model(body, "new-model")
        assert json.loads(result)["model"] == "new-model"

    def test_preserves_other_fields(self):
        body = json.dumps(
            {
                "model": "old",
                "messages": [{"role": "user"}],
                "stream": True,
            }
        ).encode()
        result = json.loads(_mutate_model(body, "new"))
        assert result["model"] == "new"
        assert result["stream"] is True
        assert result["messages"] == [{"role": "user"}]

    def test_handles_malformed_json(self):
        body = b"not json"
        result = _mutate_model(body, "new")
        assert result == body


# ------------------------------------------------------------------
# Integration tests for BifrostProxy (with mocks)
# ------------------------------------------------------------------


class TestBifrostProxyNonStreaming:
    @pytest.fixture
    def setup(
        self,
        mock_upstream: MockUpstreamProvider,
        mock_synapse: MockSynapse,
    ):
        resp_body = make_non_streaming_response(
            input_tokens=100,
            output_tokens=50,
        )
        mock_upstream.response_body = resp_body
        mock_upstream.response_headers = {
            "content-type": "application/json",
        }
        proxy = _make_proxy(mock_upstream, mock_synapse)
        return _make_test_app(proxy), mock_upstream, mock_synapse

    @pytest.fixture
    def client(self, setup):
        app, _, _ = setup
        return TestClient(app)

    def test_forwards_request_and_returns_response(self, setup, client):
        _, upstream, _ = setup
        resp = client.post("/v1/messages", json=REQUEST_BODY)

        assert resp.status_code == 200
        assert len(upstream.forward_calls) == 1
        assert resp.json()["model"] == MODEL

    def test_publishes_metrics(self, setup, client):
        _, _, synapse = setup
        client.post("/v1/messages", json=REQUEST_BODY)

        assert len(synapse.published) == 1
        topic, envelope = synapse.published[0]
        assert topic == METRICS_TOPIC
        assert envelope.payload["input_tokens"] == 100
        assert envelope.payload["output_tokens"] == 50

    def test_metrics_include_label(self, setup, client):
        _, _, synapse = setup
        client.post("/v1/messages", json=REQUEST_BODY)

        _, envelope = synapse.published[0]
        assert envelope.payload["label"] == "default"

    def test_upstream_error_forwarded(self, setup, client):
        _, upstream, _ = setup
        upstream.status = 429
        upstream.response_body = json.dumps(
            {
                "type": "error",
                "error": {
                    "type": "rate_limit_error",
                    "message": "slow",
                },
            }
        ).encode()

        resp = client.post("/v1/messages", json=REQUEST_BODY)

        assert resp.status_code == 429
        assert resp.json()["type"] == "error"


class TestBifrostProxyStreaming:
    @pytest.fixture
    def setup(
        self,
        mock_upstream: MockUpstreamProvider,
        mock_synapse: MockSynapse,
    ):
        chunks = make_streaming_chunks(
            input_tokens=100,
            output_tokens=50,
        )
        mock_upstream.stream_chunks = chunks
        mock_upstream.response_headers = {
            "content-type": "text/event-stream",
        }
        proxy = _make_proxy(mock_upstream, mock_synapse)
        return _make_test_app(proxy), mock_upstream, mock_synapse

    @pytest.fixture
    def client(self, setup):
        app, _, _ = setup
        return TestClient(app)

    def test_streams_response_chunks(self, setup, client):
        _, upstream, _ = setup
        body = {**REQUEST_BODY, "stream": True}

        resp = client.post("/v1/messages", json=body)

        assert resp.status_code == 200
        assert len(upstream.stream_forward_calls) == 1
        assert b"message_start" in resp.content
        assert b"message_delta" in resp.content

    def test_publishes_metrics_after_stream(self, setup, client):
        _, _, synapse = setup
        body = {**REQUEST_BODY, "stream": True}

        client.post("/v1/messages", json=body)

        assert len(synapse.published) == 1
        _, envelope = synapse.published[0]
        assert envelope.payload["input_tokens"] == 100
        assert envelope.payload["output_tokens"] == 50


class TestBifrostProxyErrors:
    def test_upstream_unreachable_returns_502(
        self,
        mock_synapse: MockSynapse,
    ):
        upstream = MockUpstreamProvider(
            error=ConnectionError("refused"),
        )
        proxy = _make_proxy(upstream, mock_synapse)
        app = _make_test_app(proxy)

        client = TestClient(app)
        resp = client.post("/v1/messages", json=REQUEST_BODY)

        assert resp.status_code == 502
        assert resp.json()["error"]["type"] == "proxy_error"

    def test_streaming_upstream_unreachable_returns_502(
        self,
        mock_synapse: MockSynapse,
    ):
        upstream = MockUpstreamProvider(
            error=ConnectionError("refused"),
        )
        proxy = _make_proxy(upstream, mock_synapse)
        app = _make_test_app(proxy)

        client = TestClient(app)
        body = {**REQUEST_BODY, "stream": True}

        resp = client.post("/v1/messages", json=body)

        assert resp.status_code == 502
