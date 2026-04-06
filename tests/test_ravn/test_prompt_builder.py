"""Tests for PromptBuilder and PromptCache (ravn.prompt_builder)."""

from __future__ import annotations

import json

import pytest

from ravn.prompt_builder import (
    _NON_CLAUDE_GUIDANCE,
    PromptBuilder,
    PromptCache,
    PromptSection,
    _build_manifest,
    _content_hash,
    _format_tool_schemas,
    _is_claude,
    _manifest_valid,
)

# ---------------------------------------------------------------------------
# Helper fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def builder():
    return PromptBuilder()


@pytest.fixture
def cached_builder(tmp_path):
    cache = PromptCache(max_entries=4, cache_dir=tmp_path)
    return PromptBuilder(cache=cache)


# ---------------------------------------------------------------------------
# PromptSection
# ---------------------------------------------------------------------------


class TestPromptSection:
    def test_defaults(self):
        s = PromptSection(name="identity", content="You are Ravn.")
        assert s.cacheable is True

    def test_not_cacheable(self):
        s = PromptSection(name="memory", content="ctx", cacheable=False)
        assert not s.cacheable


# ---------------------------------------------------------------------------
# PromptBuilder — section setters
# ---------------------------------------------------------------------------


class TestPromptBuilderSections:
    def test_set_identity(self, builder):
        builder.set_identity("You are Ravn.")
        sections = {s.name: s for s in builder._sections}
        assert "identity" in sections
        assert sections["identity"].cacheable

    def test_set_memory_context_not_cacheable(self, builder):
        builder.set_memory_context("past episodes")
        sections = {s.name: s for s in builder._sections}
        assert not sections["memory_context"].cacheable

    def test_set_project_context_cacheable(self, builder, tmp_path):
        f = tmp_path / "RAVN.md"
        f.write_text("# RAVN Project: test")
        builder.set_project_context("project context", source_files=[f])
        sections = {s.name: s for s in builder._sections}
        assert sections["project_context"].cacheable
        assert f in builder._source_files

    def test_set_tool_schemas(self, builder):
        tools = [{"name": "bash", "description": "Run commands", "input_schema": {}}]
        builder.set_tool_schemas(tools)
        sections = {s.name: s for s in builder._sections}
        assert "tool_schemas" in sections
        assert "bash" in sections["tool_schemas"].content

    def test_set_guidance_claude_empty(self, builder):
        builder.set_guidance("claude-sonnet-4-6")
        sections = {s.name: s for s in builder._sections}
        assert sections["guidance"].content == ""

    def test_set_guidance_non_claude(self, builder):
        builder.set_guidance("gpt-4o")
        sections = {s.name: s for s in builder._sections}
        assert _NON_CLAUDE_GUIDANCE in sections["guidance"].content

    def test_set_shared_context_not_cacheable(self, builder):
        builder.set_shared_context("parent context")
        sections = {s.name: s for s in builder._sections}
        assert not sections["shared_context"].cacheable

    def test_replace_existing_section(self, builder):
        builder.set_identity("v1")
        builder.set_identity("v2")
        assert len([s for s in builder._sections if s.name == "identity"]) == 1
        assert builder._sections[0].content == "v2"


# ---------------------------------------------------------------------------
# PromptBuilder — render()
# ---------------------------------------------------------------------------


class TestPromptBuilderRender:
    def test_empty(self, builder):
        assert builder.render() == ""

    def test_single_section(self, builder):
        builder.set_identity("You are Ravn.")
        assert builder.render() == "You are Ravn."

    def test_multiple_sections_joined(self, builder):
        builder.set_identity("Identity.")
        builder.set_guidance("gpt-4o")
        result = builder.render()
        assert "Identity." in result
        assert _NON_CLAUDE_GUIDANCE in result

    def test_empty_sections_excluded(self, builder):
        builder.set_identity("Identity.")
        builder.set_guidance("claude-sonnet-4-6")  # Empty for Claude
        result = builder.render()
        assert result == "Identity."

    def test_sections_include_dynamic(self, builder):
        builder.set_identity("Static.")
        builder.set_memory_context("Dynamic.")
        result = builder.render()
        assert "Static." in result
        assert "Dynamic." in result


# ---------------------------------------------------------------------------
# PromptBuilder — render_blocks()
# ---------------------------------------------------------------------------


class TestPromptBuilderRenderBlocks:
    def test_empty(self, builder):
        assert builder.render_blocks() == []

    def test_static_blocks_have_cache_control(self, builder):
        builder.set_identity("You are Ravn.")
        blocks = builder.render_blocks()
        assert len(blocks) == 1
        assert blocks[0]["cache_control"] == {"type": "ephemeral"}

    def test_dynamic_blocks_no_cache_control(self, builder):
        builder.set_identity("Static.")
        builder.set_memory_context("Dynamic context.")
        blocks = builder.render_blocks()
        # Static block first (with cache_control), dynamic block second (no cache_control)
        static = [b for b in blocks if "cache_control" in b]
        dynamic = [b for b in blocks if "cache_control" not in b]
        assert len(static) == 1
        assert len(dynamic) == 1
        assert dynamic[0]["text"] == "Dynamic context."

    def test_empty_sections_excluded(self, builder):
        builder.set_identity("Static.")
        builder.set_guidance("claude-sonnet-4-6")  # Empty
        blocks = builder.render_blocks()
        texts = [b["text"] for b in blocks]
        assert "Static." in texts
        assert "" not in texts

    def test_blocks_structure(self, builder):
        builder.set_identity("Identity.")
        blocks = builder.render_blocks()
        assert all("type" in b for b in blocks)
        assert all(b["type"] == "text" for b in blocks)

    def test_with_cache_stores_static(self, cached_builder):
        cached_builder.set_identity("You are Ravn.")
        blocks1 = cached_builder.render_blocks()
        # Second call should hit cache
        blocks2 = cached_builder.render_blocks()
        assert blocks1 == blocks2

    def test_cache_miss_on_content_change(self, cached_builder):
        cached_builder.set_identity("v1")
        blocks1 = cached_builder.render_blocks()
        cached_builder.set_identity("v2")
        blocks2 = cached_builder.render_blocks()
        assert blocks1[0]["text"] == "v1"
        assert blocks2[0]["text"] == "v2"


# ---------------------------------------------------------------------------
# PromptCache
# ---------------------------------------------------------------------------


class TestPromptCache:
    def test_get_miss(self):
        cache = PromptCache()
        assert cache.get("no-such-key", {}) is None

    def test_put_and_get(self):
        cache = PromptCache()
        blocks = [{"type": "text", "text": "hello"}]
        cache.put("key1", {}, blocks)
        assert cache.get("key1", {}) == blocks

    def test_lru_eviction(self):
        cache = PromptCache(max_entries=2)
        cache.put("k1", {}, [{"text": "1"}])
        cache.put("k2", {}, [{"text": "2"}])
        cache.put("k3", {}, [{"text": "3"}])  # evicts k1
        assert cache.get("k1", {}) is None
        assert cache.get("k2", {}) is not None
        assert cache.get("k3", {}) is not None

    def test_lru_promotes_on_access(self):
        cache = PromptCache(max_entries=2)
        cache.put("k1", {}, [{"text": "1"}])
        cache.put("k2", {}, [{"text": "2"}])
        # Access k1 to promote it
        cache.get("k1", {})
        cache.put("k3", {}, [{"text": "3"}])  # should evict k2 not k1
        assert cache.get("k1", {}) is not None
        assert cache.get("k2", {}) is None

    def test_manifest_invalidation(self, tmp_path):
        cache = PromptCache()
        f = tmp_path / "test.txt"
        f.write_text("original")
        manifest = _build_manifest([f])
        blocks = [{"type": "text", "text": "cached"}]
        cache.put("key", manifest, blocks)

        # Simulate file change by modifying the manifest
        stale_manifest = {str(f): (0.0, 0)}  # wrong mtime/size
        assert cache.get("key", stale_manifest) is None

    def test_disk_cache_write_and_read(self, tmp_path):
        cache = PromptCache(cache_dir=tmp_path)
        blocks = [{"type": "text", "text": "stored on disk"}]
        cache.put("disk-key", {}, blocks)

        # New cache instance (empty LRU) should hit disk
        cache2 = PromptCache(cache_dir=tmp_path)
        result = cache2.get("disk-key", {})
        assert result == blocks

    def test_disk_cache_manifest_stored(self, tmp_path):
        cache = PromptCache(cache_dir=tmp_path)
        f = tmp_path / "source.md"
        f.write_text("content")
        manifest = _build_manifest([f])
        blocks = [{"type": "text", "text": "data"}]
        cache.put("m-key", manifest, blocks)

        # Verify disk file contains manifest
        disk_file = tmp_path / "m-key.json"
        raw = json.loads(disk_file.read_text())
        assert "manifest" in raw

    def test_clear_lru(self):
        cache = PromptCache()
        cache.put("k", {}, [{"text": "x"}])
        cache.clear()
        assert cache.get("k", {}) is None

    def test_invalid_disk_file_returns_none(self, tmp_path):
        cache = PromptCache(cache_dir=tmp_path)
        # Write corrupt JSON
        (tmp_path / "bad.json").write_text("not-json")
        assert cache.get("bad", {}) is None


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------


class TestHelpers:
    def test_content_hash_deterministic(self):
        h1 = _content_hash("hello")
        h2 = _content_hash("hello")
        assert h1 == h2

    def test_content_hash_different(self):
        assert _content_hash("hello") != _content_hash("world")

    def test_content_hash_length(self):
        assert len(_content_hash("test")) == 16

    def test_build_manifest_existing_file(self, tmp_path):
        f = tmp_path / "a.txt"
        f.write_text("data")
        m = _build_manifest([f])
        assert str(f) in m
        mtime, size = m[str(f)]
        assert size == 4

    def test_build_manifest_missing_file(self, tmp_path):
        f = tmp_path / "missing.txt"
        m = _build_manifest([f])
        assert str(f) not in m

    def test_manifest_valid_empty(self):
        assert _manifest_valid({}, {}) is True

    def test_manifest_valid_match(self, tmp_path):
        f = tmp_path / "b.txt"
        f.write_text("data")
        m = _build_manifest([f])
        assert _manifest_valid(m, m) is True

    def test_manifest_invalid_different_mtime(self, tmp_path):
        f = tmp_path / "c.txt"
        f.write_text("data")
        stored = {str(f): (0.0, 4)}  # wrong mtime
        current = _build_manifest([f])
        assert _manifest_valid(stored, current) is False

    def test_manifest_invalid_missing_file(self, tmp_path):
        f = tmp_path / "d.txt"
        stored = {str(f): (1234.0, 10)}
        assert _manifest_valid(stored, {}) is False

    def test_is_claude_true(self):
        assert _is_claude("claude-sonnet-4-6")
        assert _is_claude("CLAUDE-opus-4")
        assert _is_claude("claude-haiku-4-5-20251001")

    def test_is_claude_false(self):
        assert not _is_claude("gpt-4o")
        assert not _is_claude("gemini-pro")
        assert not _is_claude("")

    def test_format_tool_schemas_empty(self):
        assert _format_tool_schemas([]) == ""

    def test_format_tool_schemas_with_tools(self):
        tools = [
            {"name": "bash", "description": "Run bash commands"},
            {"name": "read_file", "description": "Read a file"},
        ]
        result = _format_tool_schemas(tools)
        assert "bash" in result
        assert "read_file" in result
        assert "Run bash commands" in result
