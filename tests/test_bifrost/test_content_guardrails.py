"""Tests for NIU-479 content guardrail conditions and actions.

Covers:
 - New content conditions: content_matches, system_prompt_matches,
   message_count, has_image
 - New actions: tag, strip_images
 - ImageBlock model and _strip_image_blocks domain helper
 - apply_rules() handling of tag and strip_images
 - YamlRuleEngine content condition matching
 - Config validation for new fields
"""

from __future__ import annotations

import pytest

from bifrost.adapters.rules.yaml_engine import (
    YamlRuleEngine,
    _extract_message_text,
    _extract_system_text,
    _request_has_image,
)
from bifrost.config import BifrostConfig, ProviderConfig, RuleCondition, RuleConfig
from bifrost.domain.routing import _strip_image_blocks, apply_rules
from bifrost.ports.rules import RoutingContext, RuleAction, RuleEnginePort, RuleMatch
from bifrost.translation.models import (
    AnthropicRequest,
    ImageBlock,
    ImageSource,
    Message,
    TextBlock,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _req(
    model: str = "claude-sonnet-4-6",
    messages: list[Message] | None = None,
    system: str | list[TextBlock] | None = None,
) -> AnthropicRequest:
    if messages is None:
        messages = [Message(role="user", content="hello")]
    return AnthropicRequest(
        model=model,
        max_tokens=1024,
        messages=messages,
        system=system,
    )


def _image_block() -> ImageBlock:
    return ImageBlock(source=ImageSource(type="base64", media_type="image/png", data="abc123"))


def _cfg() -> BifrostConfig:
    return BifrostConfig(
        providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
        rules=[],
    )


def _engine(rules: list[RuleConfig]) -> YamlRuleEngine:
    return YamlRuleEngine(rules=rules, config=_cfg())


# ---------------------------------------------------------------------------
# ImageBlock model
# ---------------------------------------------------------------------------


class TestImageBlock:
    def test_image_block_base64(self):
        block = ImageBlock(
            source=ImageSource(type="base64", media_type="image/jpeg", data="deadbeef")
        )
        assert block.type == "image"
        assert block.source.type == "base64"
        assert block.source.data == "deadbeef"

    def test_image_block_url(self):
        block = ImageBlock(source=ImageSource(type="url", url="https://example.com/img.png"))
        assert block.source.type == "url"
        assert block.source.url == "https://example.com/img.png"

    def test_image_block_in_message_content(self):
        img = _image_block()
        msg = Message(role="user", content=[img])
        assert isinstance(msg.content[0], ImageBlock)

    def test_anthropic_request_parses_image_content(self):
        img = _image_block()
        req = AnthropicRequest(
            model="claude-sonnet-4-6",
            max_tokens=100,
            messages=[Message(role="user", content=[img, TextBlock(text="describe this")])],
        )
        assert isinstance(req.messages[0].content[0], ImageBlock)
        assert isinstance(req.messages[0].content[1], TextBlock)


# ---------------------------------------------------------------------------
# _extract_message_text
# ---------------------------------------------------------------------------


class TestExtractMessageText:
    def test_string_content(self):
        req = _req(messages=[Message(role="user", content="hello world")])
        assert _extract_message_text(req) == "hello world"

    def test_text_block_content(self):
        req = _req(messages=[Message(role="user", content=[TextBlock(text="block text")])])
        assert _extract_message_text(req) == "block text"

    def test_multiple_messages_joined(self):
        req = _req(
            messages=[
                Message(role="user", content="first"),
                Message(role="assistant", content="second"),
            ]
        )
        assert _extract_message_text(req) == "first\nsecond"

    def test_image_blocks_skipped(self):
        req = _req(
            messages=[Message(role="user", content=[_image_block(), TextBlock(text="text only")])]
        )
        assert _extract_message_text(req) == "text only"

    def test_empty_messages(self):
        req = AnthropicRequest(model="m", max_tokens=10, messages=[])
        assert _extract_message_text(req) == ""


# ---------------------------------------------------------------------------
# _extract_system_text
# ---------------------------------------------------------------------------


class TestExtractSystemText:
    def test_none_system(self):
        req = _req(system=None)
        assert _extract_system_text(req) == ""

    def test_string_system(self):
        req = _req(system="You are a helpful assistant.")
        assert _extract_system_text(req) == "You are a helpful assistant."

    def test_list_of_text_blocks(self):
        req = _req(system=[TextBlock(text="part1"), TextBlock(text="part2")])
        assert _extract_system_text(req) == "part1\npart2"


# ---------------------------------------------------------------------------
# _request_has_image
# ---------------------------------------------------------------------------


class TestRequestHasImage:
    def test_no_image(self):
        req = _req(messages=[Message(role="user", content="plain text")])
        assert _request_has_image(req) is False

    def test_has_image_in_first_message(self):
        req = _req(messages=[Message(role="user", content=[_image_block()])])
        assert _request_has_image(req) is True

    def test_has_image_mixed_content(self):
        req = _req(
            messages=[
                Message(role="user", content=[TextBlock(text="what is this?"), _image_block()])
            ]
        )
        assert _request_has_image(req) is True

    def test_image_in_second_message(self):
        req = _req(
            messages=[
                Message(role="user", content="text only"),
                Message(role="assistant", content=[_image_block()]),
            ]
        )
        assert _request_has_image(req) is True

    def test_string_content_no_image(self):
        req = _req(messages=[Message(role="user", content="some text")])
        assert _request_has_image(req) is False


# ---------------------------------------------------------------------------
# _strip_image_blocks
# ---------------------------------------------------------------------------


class TestStripImageBlocks:
    def test_no_images_unchanged(self):
        req = _req(messages=[Message(role="user", content="text")])
        result = _strip_image_blocks(req)
        assert result.messages[0].content == "text"

    def test_strips_image_from_content_list(self):
        img = _image_block()
        txt = TextBlock(text="describe this")
        req = _req(messages=[Message(role="user", content=[img, txt])])
        result = _strip_image_blocks(req)
        content = result.messages[0].content
        assert isinstance(content, list)
        assert len(content) == 1
        assert isinstance(content[0], TextBlock)

    def test_strips_image_only_message_gets_placeholder(self):
        req = _req(messages=[Message(role="user", content=[_image_block()])])
        result = _strip_image_blocks(req)
        content = result.messages[0].content
        assert isinstance(content, list)
        assert len(content) == 1
        assert isinstance(content[0], TextBlock)
        assert content[0].text == "[image removed]"

    def test_original_request_not_mutated(self):
        img = _image_block()
        txt = TextBlock(text="hi")
        req = _req(messages=[Message(role="user", content=[img, txt])])
        _strip_image_blocks(req)
        # original still has image
        assert len(req.messages[0].content) == 2

    def test_string_content_messages_unchanged(self):
        req = _req(messages=[Message(role="user", content="plain")])
        result = _strip_image_blocks(req)
        assert result.messages[0].content == "plain"

    def test_multiple_messages_strips_only_images(self):
        req = AnthropicRequest(
            model="m",
            max_tokens=10,
            messages=[
                Message(role="user", content=[_image_block(), TextBlock(text="look")]),
                Message(role="assistant", content="response"),
                Message(role="user", content=[_image_block(), TextBlock(text="another")]),
            ],
        )
        result = _strip_image_blocks(req)
        assert len(result.messages[0].content) == 1
        assert result.messages[1].content == "response"
        assert len(result.messages[2].content) == 1


# ---------------------------------------------------------------------------
# YamlRuleEngine — content_matches condition
# ---------------------------------------------------------------------------


class TestContentMatchesCondition:
    def test_matches_simple_pattern(self):
        engine = _engine(
            [RuleConfig(name="r", when=RuleCondition(content_matches="hello"), action="log")]
        )
        req = _req(messages=[Message(role="user", content="say hello world")])
        assert engine.evaluate(req, RoutingContext()) is not None

    def test_does_not_match_absent_pattern(self):
        engine = _engine(
            [RuleConfig(name="r", when=RuleCondition(content_matches="secret"), action="log")]
        )
        req = _req(messages=[Message(role="user", content="no sensitive data here")])
        assert engine.evaluate(req, RoutingContext()) is None

    def test_matches_ssn_regex(self):
        engine = _engine(
            [
                RuleConfig(
                    name="block-ssn",
                    when=RuleCondition(content_matches=r"\b\d{3}-\d{2}-\d{4}\b"),
                    action="reject",
                    message="PII detected",
                )
            ]
        )
        req = _req(messages=[Message(role="user", content="my SSN is 123-45-6789")])
        result = engine.evaluate(req, RoutingContext())
        assert result is not None
        assert result.action == RuleAction.REJECT

    def test_no_match_ssn_regex_without_ssn(self):
        engine = _engine(
            [
                RuleConfig(
                    name="block-ssn",
                    when=RuleCondition(content_matches=r"\b\d{3}-\d{2}-\d{4}\b"),
                    action="reject",
                    message="PII detected",
                )
            ]
        )
        req = _req(messages=[Message(role="user", content="hello, how are you?")])
        assert engine.evaluate(req, RoutingContext()) is None

    def test_matches_across_multiple_messages(self):
        engine = _engine(
            [RuleConfig(name="r", when=RuleCondition(content_matches="confidential"), action="log")]
        )
        req = _req(
            messages=[
                Message(role="user", content="what is the"),
                Message(role="assistant", content="this document is confidential"),
            ]
        )
        assert engine.evaluate(req, RoutingContext()) is not None

    def test_matches_text_block_content(self):
        engine = _engine(
            [RuleConfig(name="r", when=RuleCondition(content_matches="private"), action="log")]
        )
        req = _req(
            messages=[Message(role="user", content=[TextBlock(text="this is private data")])]
        )
        assert engine.evaluate(req, RoutingContext()) is not None


# ---------------------------------------------------------------------------
# YamlRuleEngine — system_prompt_matches condition
# ---------------------------------------------------------------------------


class TestSystemPromptMatchesCondition:
    def test_matches_string_system(self):
        engine = _engine(
            [
                RuleConfig(
                    name="r",
                    when=RuleCondition(system_prompt_matches="internal"),
                    action="log",
                )
            ]
        )
        req = _req(system="You are an internal tool.")
        assert engine.evaluate(req, RoutingContext()) is not None

    def test_does_not_match_absent_pattern(self):
        engine = _engine(
            [
                RuleConfig(
                    name="r",
                    when=RuleCondition(system_prompt_matches="secret"),
                    action="log",
                )
            ]
        )
        req = _req(system="You are a helpful assistant.")
        assert engine.evaluate(req, RoutingContext()) is None

    def test_does_not_match_when_no_system_prompt(self):
        engine = _engine(
            [
                RuleConfig(
                    name="r",
                    when=RuleCondition(system_prompt_matches="anything"),
                    action="log",
                )
            ]
        )
        req = _req(system=None)
        assert engine.evaluate(req, RoutingContext()) is None

    def test_matches_list_of_text_blocks(self):
        engine = _engine(
            [
                RuleConfig(
                    name="r",
                    when=RuleCondition(system_prompt_matches="block content"),
                    action="log",
                )
            ]
        )
        req = _req(system=[TextBlock(text="this is block content")])
        assert engine.evaluate(req, RoutingContext()) is not None


# ---------------------------------------------------------------------------
# YamlRuleEngine — message_count condition
# ---------------------------------------------------------------------------


class TestMessageCountCondition:
    def test_matches_exact_count(self):
        engine = _engine(
            [RuleConfig(name="r", when=RuleCondition(message_count="1"), action="log")]
        )
        req = _req(messages=[Message(role="user", content="hi")])
        assert engine.evaluate(req, RoutingContext()) is not None

    def test_matches_gte_expression(self):
        engine = _engine(
            [RuleConfig(name="r", when=RuleCondition(message_count=">= 5"), action="log")]
        )
        messages = [Message(role="user", content=f"msg {i}") for i in range(6)]
        req = _req(messages=messages)
        assert engine.evaluate(req, RoutingContext()) is not None

    def test_does_not_match_gte_expression_below(self):
        engine = _engine(
            [RuleConfig(name="r", when=RuleCondition(message_count=">= 10"), action="log")]
        )
        req = _req(messages=[Message(role="user", content="hi")])
        assert engine.evaluate(req, RoutingContext()) is None

    def test_matches_lte_expression(self):
        engine = _engine(
            [RuleConfig(name="r", when=RuleCondition(message_count="<= 3"), action="log")]
        )
        req = _req(messages=[Message(role="user", content="hi")])
        assert engine.evaluate(req, RoutingContext()) is not None


# ---------------------------------------------------------------------------
# YamlRuleEngine — has_image condition
# ---------------------------------------------------------------------------


class TestHasImageCondition:
    def test_matches_has_image_true(self):
        engine = _engine([RuleConfig(name="r", when=RuleCondition(has_image=True), action="log")])
        req = _req(messages=[Message(role="user", content=[_image_block()])])
        assert engine.evaluate(req, RoutingContext()) is not None

    def test_does_not_match_has_image_true_no_image(self):
        engine = _engine([RuleConfig(name="r", when=RuleCondition(has_image=True), action="log")])
        req = _req(messages=[Message(role="user", content="no images here")])
        assert engine.evaluate(req, RoutingContext()) is None

    def test_matches_has_image_false_no_image(self):
        engine = _engine([RuleConfig(name="r", when=RuleCondition(has_image=False), action="log")])
        req = _req(messages=[Message(role="user", content="no images")])
        assert engine.evaluate(req, RoutingContext()) is not None

    def test_does_not_match_has_image_false_with_image(self):
        engine = _engine([RuleConfig(name="r", when=RuleCondition(has_image=False), action="log")])
        req = _req(messages=[Message(role="user", content=[_image_block()])])
        assert engine.evaluate(req, RoutingContext()) is None


# ---------------------------------------------------------------------------
# YamlRuleEngine — strip_images action
# ---------------------------------------------------------------------------


class TestStripImagesAction:
    def test_strip_images_returns_correct_match(self):
        engine = _engine(
            [RuleConfig(name="strip", when=RuleCondition(has_image=True), action="strip_images")]
        )
        req = _req(messages=[Message(role="user", content=[_image_block()])])
        result = engine.evaluate(req, RoutingContext())
        assert result is not None
        assert result.action == RuleAction.STRIP_IMAGES
        assert result.rule_name == "strip"


# ---------------------------------------------------------------------------
# YamlRuleEngine — tag action
# ---------------------------------------------------------------------------


class TestTagAction:
    def test_tag_action_returns_correct_match(self):
        engine = _engine(
            [
                RuleConfig(
                    name="tag-pii",
                    when=RuleCondition(content_matches=r"\d{3}-\d{2}-\d{4}"),
                    action="tag",
                    tags={"pii": "ssn", "severity": "high"},
                )
            ]
        )
        req = _req(messages=[Message(role="user", content="SSN: 123-45-6789")])
        result = engine.evaluate(req, RoutingContext())
        assert result is not None
        assert result.action == RuleAction.TAG
        assert result.tags == {"pii": "ssn", "severity": "high"}

    def test_tag_action_with_empty_tags(self):
        engine = _engine([RuleConfig(name="t", when=RuleCondition(), action="tag")])
        result = engine.evaluate(_req(), RoutingContext())
        assert result is not None
        assert result.tags == {}


# ---------------------------------------------------------------------------
# apply_rules — tag action
# ---------------------------------------------------------------------------


class FakeRuleEngine(RuleEnginePort):
    def __init__(self, match: RuleMatch | None = None) -> None:
        self._match = match

    def evaluate(self, request: AnthropicRequest, context: RoutingContext) -> RuleMatch | None:
        return self._match


class TestApplyRulesTagAction:
    def test_tag_returns_request_unchanged(self):
        req = _req()
        match = RuleMatch(
            rule_name="tag-rule",
            action=RuleAction.TAG,
            tags={"category": "pii"},
        )
        result = apply_rules(req, RoutingContext(), engine=FakeRuleEngine(match=match))
        assert result is req

    def test_tag_does_not_raise(self):
        req = _req()
        match = RuleMatch(rule_name="t", action=RuleAction.TAG)
        result = apply_rules(req, RoutingContext(), engine=FakeRuleEngine(match=match))
        assert result is req


# ---------------------------------------------------------------------------
# apply_rules — strip_images action
# ---------------------------------------------------------------------------


class TestApplyRulesStripImagesAction:
    def test_strip_images_removes_image_blocks(self):
        img = _image_block()
        txt = TextBlock(text="look at this")
        req = AnthropicRequest(
            model="m",
            max_tokens=10,
            messages=[Message(role="user", content=[img, txt])],
        )
        match = RuleMatch(rule_name="strip", action=RuleAction.STRIP_IMAGES)
        result = apply_rules(req, RoutingContext(), engine=FakeRuleEngine(match=match))
        assert isinstance(result.messages[0].content, list)
        assert len(result.messages[0].content) == 1
        assert isinstance(result.messages[0].content[0], TextBlock)

    def test_strip_images_does_not_mutate_original(self):
        img = _image_block()
        req = AnthropicRequest(
            model="m",
            max_tokens=10,
            messages=[Message(role="user", content=[img])],
        )
        match = RuleMatch(rule_name="strip", action=RuleAction.STRIP_IMAGES)
        result = apply_rules(req, RoutingContext(), engine=FakeRuleEngine(match=match))
        # original still has image; result has placeholder
        assert isinstance(req.messages[0].content[0], ImageBlock)
        assert isinstance(result.messages[0].content[0], TextBlock)

    def test_strip_images_no_images_returns_equivalent_request(self):
        req = _req(messages=[Message(role="user", content="no images")])
        match = RuleMatch(rule_name="strip", action=RuleAction.STRIP_IMAGES)
        result = apply_rules(req, RoutingContext(), engine=FakeRuleEngine(match=match))
        assert result.messages[0].content == "no images"


# ---------------------------------------------------------------------------
# Combined conditions (AND semantics)
# ---------------------------------------------------------------------------


class TestCombinedContentConditions:
    def test_has_image_and_provider_must_both_match(self):
        cfg = BifrostConfig(
            providers={"ollama": ProviderConfig(models=["llama3"])},
            rules=[],
        )
        engine = YamlRuleEngine(
            rules=[
                RuleConfig(
                    name="strip-for-ollama",
                    when=RuleCondition(has_image=True, provider="ollama"),
                    action="strip_images",
                )
            ],
            config=cfg,
        )
        # has image + correct provider → match
        req_with_img = AnthropicRequest(
            model="llama3",
            max_tokens=100,
            messages=[Message(role="user", content=[_image_block()])],
        )
        assert engine.evaluate(req_with_img, RoutingContext()) is not None

    def test_has_image_and_provider_only_image_no_match(self):
        # has image but provider is anthropic, rule requires ollama → no match
        req_with_img = AnthropicRequest(
            model="llama3",
            max_tokens=100,
            messages=[Message(role="user", content=[_image_block()])],
        )
        cfg2 = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["llama3"])},
            rules=[],
        )
        engine2 = YamlRuleEngine(
            rules=[
                RuleConfig(
                    name="strip-for-ollama",
                    when=RuleCondition(has_image=True, provider="ollama"),
                    action="strip_images",
                )
            ],
            config=cfg2,
        )
        assert engine2.evaluate(req_with_img, RoutingContext()) is None

    def test_content_matches_and_message_count(self):
        engine = _engine(
            [
                RuleConfig(
                    name="r",
                    when=RuleCondition(content_matches="urgent", message_count=">= 3"),
                    action="log",
                )
            ]
        )
        # Both match
        long_req = _req(
            messages=[
                Message(role="user", content="this is urgent"),
                Message(role="assistant", content="ok"),
                Message(role="user", content="please respond"),
            ]
        )
        assert engine.evaluate(long_req, RoutingContext()) is not None

        # Only content_matches matches
        short_req = _req(messages=[Message(role="user", content="this is urgent")])
        assert engine.evaluate(short_req, RoutingContext()) is None


# ---------------------------------------------------------------------------
# RuleConfig validation for new fields
# ---------------------------------------------------------------------------


class TestRuleConfigNewFields:
    def test_tag_action_valid(self):
        rule = RuleConfig(
            name="t",
            when=RuleCondition(),
            action="tag",
            tags={"key": "value"},
        )
        assert rule.action == "tag"
        assert rule.tags == {"key": "value"}

    def test_strip_images_action_valid(self):
        rule = RuleConfig(
            name="s",
            when=RuleCondition(has_image=True),
            action="strip_images",
        )
        assert rule.action == "strip_images"

    def test_default_tags_is_empty_dict(self):
        rule = RuleConfig(name="r", when=RuleCondition(), action="log")
        assert rule.tags == {}

    def test_content_matches_condition(self):
        rule = RuleConfig(
            name="r",
            when=RuleCondition(content_matches=r"\bSSN\b"),
            action="reject",
            message="PII blocked",
        )
        assert rule.when.content_matches == r"\bSSN\b"

    def test_system_prompt_matches_condition(self):
        rule = RuleConfig(
            name="r",
            when=RuleCondition(system_prompt_matches="confidential"),
            action="log",
        )
        assert rule.when.system_prompt_matches == "confidential"

    def test_message_count_condition(self):
        rule = RuleConfig(
            name="r",
            when=RuleCondition(message_count=">= 10"),
            action="log",
        )
        assert rule.when.message_count == ">= 10"

    def test_has_image_condition(self):
        rule = RuleConfig(
            name="r",
            when=RuleCondition(has_image=True),
            action="strip_images",
        )
        assert rule.when.has_image is True

    def test_full_config_deserialization(self):
        """Validate the NIU-479 example YAML structure."""
        cfg = BifrostConfig.model_validate(
            {
                "providers": {},
                "rules": [
                    {
                        "name": "block-ssn-patterns",
                        "when": {"content_matches": r"\b\d{3}-\d{2}-\d{4}\b"},
                        "action": "reject",
                        "message": "Request blocked: possible PII detected",
                    },
                    {
                        "name": "strip-images-for-ollama",
                        "when": {"has_image": True, "provider": "ollama"},
                        "action": "strip_images",
                    },
                ],
            }
        )
        assert len(cfg.rules) == 2
        assert cfg.rules[0].when.content_matches == r"\b\d{3}-\d{2}-\d{4}\b"
        assert cfg.rules[0].action == "reject"
        assert cfg.rules[1].when.has_image is True
        assert cfg.rules[1].action == "strip_images"


# ---------------------------------------------------------------------------
# RuleCondition defaults for new fields
# ---------------------------------------------------------------------------


class TestRuleConditionNewFieldDefaults:
    def test_content_matches_defaults_to_none(self):
        assert RuleCondition().content_matches is None

    def test_system_prompt_matches_defaults_to_none(self):
        assert RuleCondition().system_prompt_matches is None

    def test_message_count_defaults_to_none(self):
        assert RuleCondition().message_count is None

    def test_has_image_defaults_to_none(self):
        assert RuleCondition().has_image is None


# ---------------------------------------------------------------------------
# RuleCondition regex validation (Finding 1)
# ---------------------------------------------------------------------------


class TestRuleConditionRegexValidation:
    def test_valid_content_matches_accepted(self):
        cond = RuleCondition(content_matches=r"\bSSN\b")
        assert cond.content_matches == r"\bSSN\b"

    def test_invalid_content_matches_raises_validation_error(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError, match="Invalid regex in content_matches"):
            RuleCondition(content_matches="[invalid")

    def test_valid_system_prompt_matches_accepted(self):
        cond = RuleCondition(system_prompt_matches="confidential")
        assert cond.system_prompt_matches == "confidential"

    def test_invalid_system_prompt_matches_raises_validation_error(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError, match="Invalid regex in system_prompt_matches"):
            RuleCondition(system_prompt_matches="(?P<bad")

    def test_invalid_regex_in_rule_config_raises_at_load_time(self):
        """Config load (not request time) raises for bad regex."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            RuleConfig(
                name="bad",
                when=RuleCondition(content_matches="[unclosed"),
                action="log",
            )


# ---------------------------------------------------------------------------
# YamlRuleEngine pre-compilation (Finding 2)
# ---------------------------------------------------------------------------


class TestYamlRuleEnginePreCompilation:
    def test_patterns_pre_compiled_at_init(self):
        engine = _engine(
            [
                RuleConfig(
                    name="r",
                    when=RuleCondition(content_matches=r"\d{3}-\d{2}-\d{4}"),
                    action="log",
                )
            ]
        )
        import re

        assert 0 in engine._content_patterns
        assert isinstance(engine._content_patterns[0], re.Pattern)

    def test_system_patterns_pre_compiled_at_init(self):
        engine = _engine(
            [
                RuleConfig(
                    name="r",
                    when=RuleCondition(system_prompt_matches="internal"),
                    action="log",
                )
            ]
        )
        import re

        assert 0 in engine._system_patterns
        assert isinstance(engine._system_patterns[0], re.Pattern)

    def test_rules_without_regex_have_no_compiled_entries(self):
        engine = _engine([RuleConfig(name="r", when=RuleCondition(has_image=True), action="log")])
        assert len(engine._content_patterns) == 0
        assert len(engine._system_patterns) == 0

    def test_correct_index_used_for_multiple_rules(self):
        engine = _engine(
            [
                RuleConfig(name="r0", when=RuleCondition(has_tools=True), action="log"),
                RuleConfig(
                    name="r1",
                    when=RuleCondition(content_matches="secret"),
                    action="reject",
                    message="blocked",
                ),
                RuleConfig(name="r2", when=RuleCondition(has_image=True), action="log"),
            ]
        )
        # Only rule at index 1 has content_matches
        assert 0 not in engine._content_patterns
        assert 1 in engine._content_patterns
        assert 2 not in engine._content_patterns


# ---------------------------------------------------------------------------
# _strip_image_blocks placeholder (Finding 5)
# ---------------------------------------------------------------------------


class TestStripImageBlocksPlaceholder:
    def test_image_only_message_gets_placeholder(self):
        req = _req(messages=[Message(role="user", content=[_image_block()])])
        result = _strip_image_blocks(req)
        content = result.messages[0].content
        assert len(content) == 1
        assert isinstance(content[0], TextBlock)
        assert content[0].text == "[image removed]"

    def test_mixed_content_keeps_text_no_placeholder(self):
        req = _req(messages=[Message(role="user", content=[_image_block(), TextBlock(text="hi")])])
        result = _strip_image_blocks(req)
        content = result.messages[0].content
        assert len(content) == 1
        assert isinstance(content[0], TextBlock)
        assert content[0].text == "hi"
