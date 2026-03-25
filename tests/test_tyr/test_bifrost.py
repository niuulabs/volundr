"""Tests for BifröstAdapter — LLM spec decomposition."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from tyr.adapters.bifrost import (
    ANTHROPIC_API_VERSION,
    DECOMPOSITION_PROMPT,
    BifrostAdapter,
    DecompositionError,
)
from tyr.domain.models import RaidSpec, SagaStructure
from tyr.domain.validation import ValidationError, parse_and_validate, validate_raid

# ---------------------------------------------------------------------------
# Valid fixture data
# ---------------------------------------------------------------------------

# Default bounds (matching LLMConfig defaults)
DEFAULT_MIN = 2.0
DEFAULT_MAX = 8.0

VALID_RAID = {
    "name": "Add user model",
    "description": "Create the User dataclass and persistence layer",
    "acceptance_criteria": ["Unit tests pass", "Coverage > 85%"],
    "declared_files": ["src/models/user.py", "tests/test_user.py"],
    "estimate_hours": 3.0,
    "confidence": 0.85,
}

VALID_RESPONSE = {
    "name": "User Management Saga",
    "phases": [
        {
            "name": "Phase 1 — Models",
            "raids": [VALID_RAID],
        }
    ],
}

API_URL = "http://bifrost.test/v1/messages"


def _api_response(payload: dict) -> dict:
    """Wrap payload as an Anthropic-style response."""
    return {
        "content": [{"type": "text", "text": json.dumps(payload)}],
    }


# ---------------------------------------------------------------------------
# parse_and_validate
# ---------------------------------------------------------------------------


class TestParseAndValidate:
    def test_valid_response(self) -> None:
        raw = json.dumps(VALID_RESPONSE)
        result = parse_and_validate(raw)
        assert isinstance(result, SagaStructure)
        assert result.name == "User Management Saga"
        assert len(result.phases) == 1
        assert result.phases[0].name == "Phase 1 — Models"
        assert len(result.phases[0].raids) == 1
        raid = result.phases[0].raids[0]
        assert raid.name == "Add user model"
        assert raid.confidence == 0.85
        assert raid.estimate_hours == 3.0

    def test_strips_markdown_fences(self) -> None:
        raw = "```json\n" + json.dumps(VALID_RESPONSE) + "\n```"
        result = parse_and_validate(raw)
        assert result.name == "User Management Saga"

    def test_strips_plain_fences(self) -> None:
        raw = "```\n" + json.dumps(VALID_RESPONSE) + "\n```"
        result = parse_and_validate(raw)
        assert result.name == "User Management Saga"

    def test_invalid_json(self) -> None:
        with pytest.raises(json.JSONDecodeError):
            parse_and_validate("not json at all")

    def test_not_a_dict(self) -> None:
        with pytest.raises(ValidationError, match="JSON object"):
            parse_and_validate(json.dumps([1, 2, 3]))

    def test_missing_name(self) -> None:
        data = {**VALID_RESPONSE, "name": ""}
        with pytest.raises(ValidationError, match="'name'"):
            parse_and_validate(json.dumps(data))

    def test_missing_phases(self) -> None:
        data = {**VALID_RESPONSE, "phases": []}
        with pytest.raises(ValidationError, match="non-empty list"):
            parse_and_validate(json.dumps(data))

    def test_phases_not_list(self) -> None:
        data = {**VALID_RESPONSE, "phases": "nope"}
        with pytest.raises(ValidationError, match="non-empty list"):
            parse_and_validate(json.dumps(data))

    def test_phase_not_dict(self) -> None:
        data = {"name": "S", "phases": ["not a dict"]}
        with pytest.raises(ValidationError, match="Phase 0 must be an object"):
            parse_and_validate(json.dumps(data))

    def test_phase_missing_name(self) -> None:
        data = {"name": "S", "phases": [{"raids": [VALID_RAID]}]}
        with pytest.raises(ValidationError, match="Phase 0.*'name'"):
            parse_and_validate(json.dumps(data))

    def test_phase_empty_raids(self) -> None:
        data = {"name": "S", "phases": [{"name": "P1", "raids": []}]}
        with pytest.raises(ValidationError, match="non-empty list"):
            parse_and_validate(json.dumps(data))

    def test_multiple_phases_and_raids(self) -> None:
        raid2 = {**VALID_RAID, "name": "Second raid"}
        data = {
            "name": "Multi",
            "phases": [
                {"name": "P1", "raids": [VALID_RAID]},
                {"name": "P2", "raids": [raid2]},
            ],
        }
        result = parse_and_validate(json.dumps(data))
        assert len(result.phases) == 2
        assert result.phases[1].raids[0].name == "Second raid"

    def test_integer_estimate_accepted(self) -> None:
        raid = {**VALID_RAID, "estimate_hours": 4}
        data = {"name": "S", "phases": [{"name": "P", "raids": [raid]}]}
        result = parse_and_validate(json.dumps(data))
        assert result.phases[0].raids[0].estimate_hours == 4.0

    def test_integer_confidence_accepted(self) -> None:
        raid = {**VALID_RAID, "confidence": 1}
        data = {"name": "S", "phases": [{"name": "P", "raids": [raid]}]}
        result = parse_and_validate(json.dumps(data))
        assert result.phases[0].raids[0].confidence == 1.0

    def test_custom_estimate_bounds(self) -> None:
        raid = {**VALID_RAID, "estimate_hours": 1.0}
        data = {"name": "S", "phases": [{"name": "P", "raids": [raid]}]}
        # Default bounds reject 1.0
        with pytest.raises(ValidationError, match="below minimum"):
            parse_and_validate(json.dumps(data))
        # Custom bounds accept 1.0
        result = parse_and_validate(
            json.dumps(data), min_estimate_hours=0.5, max_estimate_hours=10.0
        )
        assert result.phases[0].raids[0].estimate_hours == 1.0


# ---------------------------------------------------------------------------
# validate_raid
# ---------------------------------------------------------------------------


class TestValidateRaid:
    def test_valid_raid(self) -> None:
        result = validate_raid(VALID_RAID, "P1", 0)
        assert isinstance(result, RaidSpec)
        assert result.name == "Add user model"

    def test_raid_not_dict(self) -> None:
        with pytest.raises(ValidationError, match="must be an object"):
            validate_raid("not a dict", "P1", 0)

    def test_missing_name(self) -> None:
        data = {**VALID_RAID, "name": ""}
        with pytest.raises(ValidationError, match="'name'"):
            validate_raid(data, "P1", 0)

    def test_missing_description(self) -> None:
        data = {**VALID_RAID, "description": ""}
        with pytest.raises(ValidationError, match="'description'"):
            validate_raid(data, "P1", 0)

    def test_empty_acceptance_criteria(self) -> None:
        data = {**VALID_RAID, "acceptance_criteria": []}
        with pytest.raises(ValidationError, match="acceptance_criteria"):
            validate_raid(data, "P1", 0)

    def test_blank_criterion(self) -> None:
        data = {**VALID_RAID, "acceptance_criteria": ["valid", "  "]}
        with pytest.raises(ValidationError, match="acceptance_criteria"):
            validate_raid(data, "P1", 0)

    def test_empty_declared_files(self) -> None:
        data = {**VALID_RAID, "declared_files": []}
        with pytest.raises(ValidationError, match="declared_files"):
            validate_raid(data, "P1", 0)

    def test_blank_declared_file(self) -> None:
        data = {**VALID_RAID, "declared_files": ["valid.py", ""]}
        with pytest.raises(ValidationError, match="declared_files"):
            validate_raid(data, "P1", 0)

    def test_estimate_not_number(self) -> None:
        data = {**VALID_RAID, "estimate_hours": "three"}
        with pytest.raises(ValidationError, match="estimate_hours"):
            validate_raid(data, "P1", 0)

    def test_estimate_too_low(self) -> None:
        data = {**VALID_RAID, "estimate_hours": 1.0}
        with pytest.raises(ValidationError, match="below minimum"):
            validate_raid(data, "P1", 0)

    def test_estimate_too_high(self) -> None:
        data = {**VALID_RAID, "estimate_hours": 10.0}
        with pytest.raises(ValidationError, match="exceeds maximum"):
            validate_raid(data, "P1", 0)

    def test_estimate_at_min_boundary(self) -> None:
        data = {**VALID_RAID, "estimate_hours": DEFAULT_MIN}
        result = validate_raid(data, "P1", 0)
        assert result.estimate_hours == DEFAULT_MIN

    def test_estimate_at_max_boundary(self) -> None:
        data = {**VALID_RAID, "estimate_hours": DEFAULT_MAX}
        result = validate_raid(data, "P1", 0)
        assert result.estimate_hours == DEFAULT_MAX

    def test_custom_estimate_bounds(self) -> None:
        data = {**VALID_RAID, "estimate_hours": 1.0}
        result = validate_raid(data, "P1", 0, min_estimate_hours=0.5, max_estimate_hours=10.0)
        assert result.estimate_hours == 1.0

    def test_confidence_not_number(self) -> None:
        data = {**VALID_RAID, "confidence": "high"}
        with pytest.raises(ValidationError, match="confidence"):
            validate_raid(data, "P1", 0)

    def test_confidence_out_of_range_low(self) -> None:
        data = {**VALID_RAID, "confidence": -0.1}
        with pytest.raises(ValidationError, match="between 0.0 and 1.0"):
            validate_raid(data, "P1", 0)

    def test_confidence_out_of_range_high(self) -> None:
        data = {**VALID_RAID, "confidence": 1.1}
        with pytest.raises(ValidationError, match="between 0.0 and 1.0"):
            validate_raid(data, "P1", 0)

    def test_confidence_at_boundaries(self) -> None:
        for val in [0.0, 1.0]:
            data = {**VALID_RAID, "confidence": val}
            result = validate_raid(data, "P1", 0)
            assert result.confidence == val

    def test_criteria_not_list(self) -> None:
        data = {**VALID_RAID, "acceptance_criteria": "just a string"}
        with pytest.raises(ValidationError, match="acceptance_criteria"):
            validate_raid(data, "P1", 0)

    def test_files_not_list(self) -> None:
        data = {**VALID_RAID, "declared_files": "single.py"}
        with pytest.raises(ValidationError, match="declared_files"):
            validate_raid(data, "P1", 0)


# ---------------------------------------------------------------------------
# BifrostAdapter
# ---------------------------------------------------------------------------


class TestBifrostAdapter:
    @pytest.fixture
    def adapter(self) -> BifrostAdapter:
        return BifrostAdapter(base_url="http://bifrost.test")

    @pytest.mark.asyncio
    @respx.mock
    async def test_decompose_spec_success(self, adapter: BifrostAdapter) -> None:
        respx.post(API_URL).mock(
            return_value=httpx.Response(200, json=_api_response(VALID_RESPONSE))
        )
        result = await adapter.decompose_spec(
            "Build user management", "org/repo", model="claude-sonnet-4-6"
        )
        assert isinstance(result, SagaStructure)
        assert result.name == "User Management Saga"
        assert len(result.phases) == 1

    @pytest.mark.asyncio
    @respx.mock
    async def test_decompose_spec_retries_on_bad_json(self, adapter: BifrostAdapter) -> None:
        respx.post(API_URL).mock(
            return_value=httpx.Response(
                200, json={"content": [{"type": "text", "text": "not valid json"}]}
            )
        )
        with pytest.raises(DecompositionError, match="Failed to decompose"):
            await adapter.decompose_spec("spec", "repo", model="claude-sonnet-4-6")

    @pytest.mark.asyncio
    @respx.mock
    async def test_decompose_spec_retries_on_validation_error(
        self, adapter: BifrostAdapter
    ) -> None:
        invalid_data = {"name": "S", "phases": []}
        respx.post(API_URL).mock(return_value=httpx.Response(200, json=_api_response(invalid_data)))
        with pytest.raises(DecompositionError):
            await adapter.decompose_spec("spec", "repo", model="claude-sonnet-4-6")

    @pytest.mark.asyncio
    @respx.mock
    async def test_decompose_retries_then_succeeds(self, adapter: BifrostAdapter) -> None:
        route = respx.post(API_URL)
        route.side_effect = [
            httpx.Response(200, json={"content": [{"type": "text", "text": "bad"}]}),
            httpx.Response(200, json=_api_response(VALID_RESPONSE)),
        ]
        result = await adapter.decompose_spec("spec", "repo", model="claude-sonnet-4-6")
        assert result.name == "User Management Saga"
        assert route.call_count == 2

    @pytest.mark.asyncio
    @respx.mock
    async def test_non_retryable_http_error_propagates(self, adapter: BifrostAdapter) -> None:
        respx.post(API_URL).mock(return_value=httpx.Response(401))
        with pytest.raises(httpx.HTTPStatusError):
            await adapter.decompose_spec("spec", "repo", model="claude-sonnet-4-6")

    @pytest.mark.asyncio
    @respx.mock
    async def test_retryable_http_500_retries(self, adapter: BifrostAdapter) -> None:
        route = respx.post(API_URL)
        route.side_effect = [
            httpx.Response(500),
            httpx.Response(200, json=_api_response(VALID_RESPONSE)),
        ]
        result = await adapter.decompose_spec("spec", "repo", model="m")
        assert result.name == "User Management Saga"
        assert route.call_count == 2

    @pytest.mark.asyncio
    @respx.mock
    async def test_retryable_http_429_retries(self) -> None:
        adapter = BifrostAdapter(base_url="http://bifrost.test", max_retries=2)
        route = respx.post(API_URL)
        route.side_effect = [
            httpx.Response(429),
            httpx.Response(200, json=_api_response(VALID_RESPONSE)),
        ]
        result = await adapter.decompose_spec("spec", "repo", model="m")
        assert result.name == "User Management Saga"
        assert route.call_count == 2

    @pytest.mark.asyncio
    @respx.mock
    async def test_retryable_http_503_exhausts_retries(self) -> None:
        adapter = BifrostAdapter(base_url="http://bifrost.test", max_retries=2)
        respx.post(API_URL).mock(return_value=httpx.Response(503))
        with pytest.raises(DecompositionError, match="2 attempts"):
            await adapter.decompose_spec("spec", "repo", model="m")

    @pytest.mark.asyncio
    @respx.mock
    async def test_sends_correct_payload(self, adapter: BifrostAdapter) -> None:
        route = respx.post(API_URL).mock(
            return_value=httpx.Response(200, json=_api_response(VALID_RESPONSE))
        )
        await adapter.decompose_spec("my spec", "org/repo", model="claude-opus-4-6")
        assert route.called
        req = route.calls.last.request
        body = json.loads(req.content)
        assert body["model"] == "claude-opus-4-6"
        assert body["max_tokens"] == 8192
        assert len(body["messages"]) == 1
        assert "my spec" in body["messages"][0]["content"]
        assert "org/repo" in body["messages"][0]["content"]

    @pytest.mark.asyncio
    @respx.mock
    async def test_sends_anthropic_headers(self, adapter: BifrostAdapter) -> None:
        route = respx.post(API_URL).mock(
            return_value=httpx.Response(200, json=_api_response(VALID_RESPONSE))
        )
        await adapter.decompose_spec("spec", "repo", model="m")
        req = route.calls.last.request
        assert req.headers["anthropic-version"] == ANTHROPIC_API_VERSION
        assert req.headers["content-type"] == "application/json"

    @pytest.mark.asyncio
    @respx.mock
    async def test_sends_api_key_header_when_set(self) -> None:
        adapter = BifrostAdapter(base_url="http://bifrost.test", api_key="sk-test-123")
        route = respx.post(API_URL).mock(
            return_value=httpx.Response(200, json=_api_response(VALID_RESPONSE))
        )
        await adapter.decompose_spec("spec", "repo", model="m")
        req = route.calls.last.request
        assert req.headers["x-api-key"] == "sk-test-123"

    @pytest.mark.asyncio
    @respx.mock
    async def test_no_api_key_header_when_empty(self, adapter: BifrostAdapter) -> None:
        route = respx.post(API_URL).mock(
            return_value=httpx.Response(200, json=_api_response(VALID_RESPONSE))
        )
        await adapter.decompose_spec("spec", "repo", model="m")
        req = route.calls.last.request
        assert "x-api-key" not in req.headers

    @pytest.mark.asyncio
    @respx.mock
    async def test_extracts_text_blocks(self, adapter: BifrostAdapter) -> None:
        respx.post(API_URL).mock(
            return_value=httpx.Response(
                200,
                json={
                    "content": [
                        {"type": "text", "text": '{"name": "S",'},
                        {"type": "thinking", "text": "ignore this"},
                        {
                            "type": "text",
                            "text": ' "phases": [{"name": "P", "raids": [',
                        },
                        {
                            "type": "text",
                            "text": json.dumps(VALID_RAID) + "]}]}",
                        },
                    ]
                },
            )
        )
        result = await adapter.decompose_spec("spec", "repo", model="claude-sonnet-4-6")
        assert result.name == "S"

    def test_adapter_strips_trailing_slash(self) -> None:
        adapter = BifrostAdapter(base_url="http://bifrost.test/")
        assert adapter._base_url == "http://bifrost.test"

    def test_default_base_url(self) -> None:
        adapter = BifrostAdapter()
        assert adapter._base_url == "https://api.anthropic.com"

    def test_default_estimate_bounds(self) -> None:
        adapter = BifrostAdapter()
        assert adapter._min_estimate_hours == DEFAULT_MIN
        assert adapter._max_estimate_hours == DEFAULT_MAX

    def test_custom_estimate_bounds(self) -> None:
        adapter = BifrostAdapter(min_estimate_hours=1.0, max_estimate_hours=12.0)
        assert adapter._min_estimate_hours == 1.0
        assert adapter._max_estimate_hours == 12.0

    @pytest.mark.asyncio
    @respx.mock
    async def test_custom_max_tokens(self) -> None:
        adapter = BifrostAdapter(base_url="http://bifrost.test", max_tokens=4096)
        route = respx.post(API_URL).mock(
            return_value=httpx.Response(200, json=_api_response(VALID_RESPONSE))
        )
        await adapter.decompose_spec("spec", "repo", model="m")
        body = json.loads(route.calls.last.request.content)
        assert body["max_tokens"] == 4096

    @pytest.mark.asyncio
    @respx.mock
    async def test_custom_max_retries(self) -> None:
        adapter = BifrostAdapter(base_url="http://bifrost.test", max_retries=1)
        respx.post(API_URL).mock(
            return_value=httpx.Response(200, json={"content": [{"type": "text", "text": "bad"}]})
        )
        with pytest.raises(DecompositionError, match="1 attempts"):
            await adapter.decompose_spec("spec", "repo", model="m")

    @pytest.mark.asyncio
    async def test_close_shuts_down_client(self) -> None:
        adapter = BifrostAdapter(base_url="http://bifrost.test")
        assert not adapter._client.is_closed
        await adapter.close()
        assert adapter._client.is_closed


# ---------------------------------------------------------------------------
# Decomposition prompt
# ---------------------------------------------------------------------------


class TestDecompositionPrompt:
    def test_prompt_contains_placeholders(self) -> None:
        prompt = DECOMPOSITION_PROMPT.format(spec="test spec", repo="org/repo")
        assert "test spec" in prompt
        assert "org/repo" in prompt

    def test_prompt_mentions_constraints(self) -> None:
        assert "2–6 hours" in DECOMPOSITION_PROMPT
        assert "8 hours" in DECOMPOSITION_PROMPT
        assert "declared_files" in DECOMPOSITION_PROMPT
        assert "acceptance_criteria" in DECOMPOSITION_PROMPT
        assert "confidence" in DECOMPOSITION_PROMPT
        lower_prompt = DECOMPOSITION_PROMPT.lower()
        assert "no markdown fences" in lower_prompt or "no markdown" in lower_prompt

    def test_default_max_retries(self) -> None:
        adapter = BifrostAdapter()
        assert adapter._max_retries == 2

    def test_default_max_tokens(self) -> None:
        adapter = BifrostAdapter()
        assert adapter._max_tokens == 8192
