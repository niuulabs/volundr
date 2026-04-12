"""Unit tests for mimir.compiled_truth (NIU-573).

Covers:
- parse_page: frontmatter extraction, compiled-truth zone, timeline entries
- validate_page: all four error codes
- append_timeline_entry: safe append without disturbing existing content
- rewrite_compiled_truth: zone replacement while preserving timeline
- extract_wikilinks: deduplication, ordering
- resolve_wikilink: existing and missing files
- CompiledTruthPage, ValidationError, TimelineEntry data classes
- MimirPageMeta new frontmatter fields (PageType, PageConfidence, EntityType)
"""

from __future__ import annotations

import textwrap
from pathlib import Path

from mimir.compiled_truth import (
    ValidationError,
    append_timeline_entry,
    extract_wikilinks,
    parse_page,
    resolve_wikilink,
    rewrite_compiled_truth,
    validate_page,
)
from niuu.domain.mimir import (
    EntityType,
    PageConfidence,
    PageType,
)

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

WELL_FORMED_PAGE = textwrap.dedent("""\
    ---
    type: entity
    confidence: high
    entity_type: person
    related_entities: [project-niuu]
    source_ids: [src_abc123]
    ---

    # Andrej Karpathy

    ## Compiled Truth

    ### Key Facts
    - AI researcher.

    ### Relationships
    - [[project-niuu]] — inspiration.

    ### Assessment
    High signal.

    ## Timeline

    - 2026-03-10: Shared post about LLMs. [Source: @karpathy, X/Twitter, 2026-03-10]
    - 2026-04-01: Published blog post. [Source: karpathy.github.io, web, 2026-04-01]
""")

NO_FRONTMATTER_PAGE = textwrap.dedent("""\
    # Plain Page

    ## Compiled Truth

    Some facts here.

    ## Timeline

    - 2026-01-01: Initial entry. [Source: notes, internal, 2026-01-01]
""")

ENTITY_PAGE_MISSING_SECTIONS = textwrap.dedent("""\
    ---
    type: entity
    entity_type: person
    ---

    # Bare Entity Page

    Some random text here.
""")

ENTITY_PAGE_MISSING_ENTITY_TYPE = textwrap.dedent("""\
    ---
    type: entity
    confidence: medium
    ---

    # Entity Without entity_type

    ## Compiled Truth

    Something.

    ## Timeline

    - 2026-01-01: Entry. [Source: internal, 2026-01-01]
""")

TIMELINE_ENTRY_NO_SOURCE = textwrap.dedent("""\
    ---
    type: entity
    entity_type: concept
    ---

    ## Compiled Truth

    Facts.

    ## Timeline

    - 2026-01-01: No source here.
    - 2026-02-01: Has source. [Source: person, channel, 2026-02-01]
""")

DIRECTIVE_PAGE = textwrap.dedent("""\
    ---
    type: directive
    confidence: high
    ---

    ## Compiled Truth

    Always do X.

    ## Timeline

    - 2026-01-01: Directive created. [Source: team, slack, 2026-01-01]
""")


# ---------------------------------------------------------------------------
# parse_page
# ---------------------------------------------------------------------------


class TestParsePage:
    def test_parses_frontmatter(self) -> None:
        page = parse_page(WELL_FORMED_PAGE)
        assert page.frontmatter["type"] == "entity"
        assert page.frontmatter["confidence"] == "high"
        assert page.frontmatter["entity_type"] == "person"

    def test_page_type_enum(self) -> None:
        page = parse_page(WELL_FORMED_PAGE)
        assert page.page_type == PageType.entity

    def test_confidence_enum(self) -> None:
        page = parse_page(WELL_FORMED_PAGE)
        assert page.confidence == PageConfidence.high

    def test_entity_type_enum(self) -> None:
        page = parse_page(WELL_FORMED_PAGE)
        assert page.entity_type == EntityType.person

    def test_related_entities(self) -> None:
        page = parse_page(WELL_FORMED_PAGE)
        assert page.related_entities == ["project-niuu"]

    def test_source_ids(self) -> None:
        page = parse_page(WELL_FORMED_PAGE)
        assert page.source_ids == ["src_abc123"]

    def test_compiled_truth_extracted(self) -> None:
        page = parse_page(WELL_FORMED_PAGE)
        assert "AI researcher" in page.compiled_truth
        assert "High signal" in page.compiled_truth

    def test_timeline_entry_count(self) -> None:
        page = parse_page(WELL_FORMED_PAGE)
        assert len(page.timeline_entries) == 2

    def test_first_timeline_entry_date(self) -> None:
        page = parse_page(WELL_FORMED_PAGE)
        assert page.timeline_entries[0].date == "2026-03-10"

    def test_first_timeline_entry_source(self) -> None:
        page = parse_page(WELL_FORMED_PAGE)
        assert "@karpathy" in page.timeline_entries[0].source

    def test_second_timeline_entry_date(self) -> None:
        page = parse_page(WELL_FORMED_PAGE)
        assert page.timeline_entries[1].date == "2026-04-01"

    def test_timeline_entry_has_source_true(self) -> None:
        page = parse_page(WELL_FORMED_PAGE)
        assert page.timeline_entries[0].has_source is True

    def test_no_frontmatter_returns_empty_dict(self) -> None:
        page = parse_page(NO_FRONTMATTER_PAGE)
        assert page.frontmatter == {}
        assert page.page_type is None

    def test_no_frontmatter_extracts_zones(self) -> None:
        page = parse_page(NO_FRONTMATTER_PAGE)
        assert "Some facts" in page.compiled_truth
        assert len(page.timeline_entries) == 1

    def test_raw_content_preserved(self) -> None:
        page = parse_page(WELL_FORMED_PAGE)
        assert page.raw_content == WELL_FORMED_PAGE

    def test_empty_related_entities_defaults(self) -> None:
        content = "---\ntype: topic\n---\n\n# Hello\n"
        page = parse_page(content)
        assert page.related_entities == []

    def test_empty_source_ids_defaults(self) -> None:
        content = "---\ntype: topic\n---\n\n# Hello\n"
        page = parse_page(content)
        assert page.source_ids == []

    def test_unknown_type_returns_none(self) -> None:
        content = "---\ntype: unknown_value\n---\n\n# Hello\n"
        page = parse_page(content)
        assert page.page_type is None

    def test_unknown_confidence_returns_none(self) -> None:
        content = "---\nconfidence: ultra\n---\n\n# Hello\n"
        page = parse_page(content)
        assert page.confidence is None

    def test_all_page_types_parse(self) -> None:
        for pt in PageType:
            content = f"---\ntype: {pt.value}\n---\n\n# Test\n"
            page = parse_page(content)
            assert page.page_type == pt

    def test_all_confidence_values_parse(self) -> None:
        for conf in PageConfidence:
            content = f"---\nconfidence: {conf.value}\n---\n\n# Test\n"
            page = parse_page(content)
            assert page.confidence == conf

    def test_all_entity_types_parse(self) -> None:
        for et in EntityType:
            content = f"---\nentity_type: {et.value}\n---\n\n# Test\n"
            page = parse_page(content)
            assert page.entity_type == et

    def test_directive_type_parses(self) -> None:
        page = parse_page(DIRECTIVE_PAGE)
        assert page.page_type == PageType.directive

    def test_decision_type_parses(self) -> None:
        content = "---\ntype: decision\n---\n\n# Test\n"
        page = parse_page(content)
        assert page.page_type == PageType.decision

    def test_empty_page(self) -> None:
        page = parse_page("")
        assert page.frontmatter == {}
        assert page.compiled_truth == ""
        assert page.timeline_entries == []


# ---------------------------------------------------------------------------
# validate_page
# ---------------------------------------------------------------------------


class TestValidatePage:
    def test_well_formed_page_has_no_errors(self) -> None:
        errors = validate_page(WELL_FORMED_PAGE)
        assert errors == []

    def test_directive_well_formed_no_errors(self) -> None:
        errors = validate_page(DIRECTIVE_PAGE)
        assert errors == []

    def test_missing_compiled_truth_for_entity(self) -> None:
        errors = validate_page(ENTITY_PAGE_MISSING_SECTIONS)
        codes = {e.code for e in errors}
        assert "MISSING_COMPILED_TRUTH" in codes

    def test_missing_timeline_for_entity(self) -> None:
        errors = validate_page(ENTITY_PAGE_MISSING_SECTIONS)
        codes = {e.code for e in errors}
        assert "MISSING_TIMELINE" in codes

    def test_entity_type_mismatch(self) -> None:
        errors = validate_page(ENTITY_PAGE_MISSING_ENTITY_TYPE)
        codes = {e.code for e in errors}
        assert "ENTITY_TYPE_MISMATCH" in codes

    def test_timeline_entry_no_source(self) -> None:
        errors = validate_page(TIMELINE_ENTRY_NO_SOURCE)
        codes = [e.code for e in errors]
        assert "TIMELINE_ENTRY_NO_SOURCE" in codes

    def test_no_source_error_includes_entry_text(self) -> None:
        errors = validate_page(TIMELINE_ENTRY_NO_SOURCE)
        no_src = [e for e in errors if e.code == "TIMELINE_ENTRY_NO_SOURCE"]
        assert len(no_src) == 1
        assert "No source here" in no_src[0].message

    def test_non_mandatory_type_no_zone_errors(self) -> None:
        content = "---\ntype: topic\n---\n\n# Topic\n\nSome text.\n"
        errors = validate_page(content)
        codes = {e.code for e in errors}
        assert "MISSING_COMPILED_TRUTH" not in codes
        assert "MISSING_TIMELINE" not in codes

    def test_missing_compiled_truth_for_directive(self) -> None:
        content = textwrap.dedent("""\
            ---
            type: directive
            ---

            ## Timeline

            - 2026-01-01: Entry. [Source: team, 2026-01-01]
        """)
        errors = validate_page(content)
        codes = {e.code for e in errors}
        assert "MISSING_COMPILED_TRUTH" in codes

    def test_missing_timeline_for_decision(self) -> None:
        content = textwrap.dedent("""\
            ---
            type: decision
            ---

            ## Compiled Truth

            We decided to do X.
        """)
        errors = validate_page(content)
        codes = {e.code for e in errors}
        assert "MISSING_TIMELINE" in codes

    def test_errors_are_validation_error_instances(self) -> None:
        errors = validate_page(ENTITY_PAGE_MISSING_SECTIONS)
        for e in errors:
            assert isinstance(e, ValidationError)
            assert isinstance(e.code, str)
            assert isinstance(e.message, str)

    def test_multiple_no_source_entries(self) -> None:
        content = textwrap.dedent("""\
            ---
            type: entity
            entity_type: concept
            ---

            ## Compiled Truth

            Facts.

            ## Timeline

            - 2026-01-01: No source.
            - 2026-01-02: Also no source.
        """)
        errors = validate_page(content)
        no_src = [e for e in errors if e.code == "TIMELINE_ENTRY_NO_SOURCE"]
        assert len(no_src) == 2

    def test_no_frontmatter_page_no_zone_errors(self) -> None:
        # Pages without frontmatter have no page_type → no mandatory zones
        errors = validate_page(NO_FRONTMATTER_PAGE)
        codes = {e.code for e in errors}
        assert "MISSING_COMPILED_TRUTH" not in codes
        assert "MISSING_TIMELINE" not in codes


# ---------------------------------------------------------------------------
# append_timeline_entry
# ---------------------------------------------------------------------------


class TestAppendTimelineEntry:
    def test_appends_to_existing_timeline(self) -> None:
        new_entry = "- 2026-05-01: New event. [Source: me, notes, 2026-05-01]"
        result = append_timeline_entry(WELL_FORMED_PAGE, new_entry)
        assert new_entry in result

    def test_existing_entries_preserved(self) -> None:
        new_entry = "- 2026-05-01: New event. [Source: me, notes, 2026-05-01]"
        result = append_timeline_entry(WELL_FORMED_PAGE, new_entry)
        assert "Shared post about LLMs" in result
        assert "Published blog post" in result

    def test_compiled_truth_preserved(self) -> None:
        new_entry = "- 2026-05-01: New event. [Source: me, notes, 2026-05-01]"
        result = append_timeline_entry(WELL_FORMED_PAGE, new_entry)
        assert "AI researcher" in result
        assert "High signal" in result

    def test_new_entry_after_existing_entries(self) -> None:
        new_entry = "- 2026-05-01: New event. [Source: me, notes, 2026-05-01]"
        result = append_timeline_entry(WELL_FORMED_PAGE, new_entry)
        old_idx = result.index("Published blog post")
        new_idx = result.index("New event")
        assert new_idx > old_idx

    def test_appends_to_page_without_timeline(self) -> None:
        content = "---\ntype: topic\n---\n\n# Hello\n"
        new_entry = "- 2026-01-01: Entry. [Source: me, notes, 2026-01-01]"
        result = append_timeline_entry(content, new_entry)
        assert "## Timeline" in result
        assert new_entry in result

    def test_appends_to_page_without_timeline_preserves_existing(self) -> None:
        content = "---\ntype: topic\n---\n\n# Hello\n"
        new_entry = "- 2026-01-01: Entry. [Source: me, notes, 2026-01-01]"
        result = append_timeline_entry(content, new_entry)
        assert "# Hello" in result

    def test_round_trip_parse_after_append(self) -> None:
        new_entry = "- 2026-05-01: New event. [Source: me, notes, 2026-05-01]"
        result = append_timeline_entry(WELL_FORMED_PAGE, new_entry)
        page = parse_page(result)
        assert len(page.timeline_entries) == 3

    def test_entry_not_duplicated(self) -> None:
        new_entry = "- 2026-05-01: New event. [Source: me, notes, 2026-05-01]"
        result = append_timeline_entry(WELL_FORMED_PAGE, new_entry)
        assert result.count(new_entry) == 1

    def test_trailing_newline_stripped_from_entry(self) -> None:
        new_entry = "- 2026-05-01: New event. [Source: me, notes, 2026-05-01]\n"
        result = append_timeline_entry(WELL_FORMED_PAGE, new_entry)
        assert "New event" in result

    def test_empty_timeline_section_append(self) -> None:
        content = textwrap.dedent("""\
            ---
            type: entity
            entity_type: concept
            ---

            ## Compiled Truth

            Facts.

            ## Timeline
        """)
        new_entry = "- 2026-01-01: Entry. [Source: internal, 2026-01-01]"
        result = append_timeline_entry(content, new_entry)
        page = parse_page(result)
        assert len(page.timeline_entries) == 1


# ---------------------------------------------------------------------------
# rewrite_compiled_truth
# ---------------------------------------------------------------------------


class TestRewriteCompiledTruth:
    NEW_TRUTH = textwrap.dedent("""\
        ### Key Facts
        - Updated fact one.
        - Updated fact two.

        ### Assessment
        Revised synthesis.
    """)

    def test_compiled_truth_replaced(self) -> None:
        result = rewrite_compiled_truth(WELL_FORMED_PAGE, self.NEW_TRUTH)
        assert "Updated fact one" in result
        assert "Updated fact two" in result

    def test_old_compiled_truth_removed(self) -> None:
        result = rewrite_compiled_truth(WELL_FORMED_PAGE, self.NEW_TRUTH)
        assert "AI researcher" not in result

    def test_timeline_preserved(self) -> None:
        result = rewrite_compiled_truth(WELL_FORMED_PAGE, self.NEW_TRUTH)
        assert "Shared post about LLMs" in result
        assert "Published blog post" in result

    def test_frontmatter_preserved(self) -> None:
        result = rewrite_compiled_truth(WELL_FORMED_PAGE, self.NEW_TRUTH)
        page = parse_page(result)
        assert page.page_type == PageType.entity
        assert page.confidence == PageConfidence.high

    def test_timeline_heading_still_present(self) -> None:
        result = rewrite_compiled_truth(WELL_FORMED_PAGE, self.NEW_TRUTH)
        assert "## Timeline" in result

    def test_round_trip_validate_after_rewrite(self) -> None:
        result = rewrite_compiled_truth(WELL_FORMED_PAGE, self.NEW_TRUTH)
        errors = validate_page(result)
        assert errors == []

    def test_rewrite_creates_section_if_absent(self) -> None:
        content = "---\ntype: topic\n---\n\n# Hello\n"
        result = rewrite_compiled_truth(content, "New truth.\n")
        assert "## Compiled Truth" in result
        assert "New truth" in result

    def test_rewrite_inserts_before_timeline_if_no_compiled_truth(self) -> None:
        content = textwrap.dedent("""\
            ---
            type: topic
            ---

            # Hello

            ## Timeline

            - 2026-01-01: Entry. [Source: me, 2026-01-01]
        """)
        result = rewrite_compiled_truth(content, "New truth.\n")
        ct_idx = result.index("## Compiled Truth")
        tl_idx = result.index("## Timeline")
        assert ct_idx < tl_idx

    def test_rewrite_multiple_times(self) -> None:
        r1 = rewrite_compiled_truth(WELL_FORMED_PAGE, "First rewrite.\n")
        r2 = rewrite_compiled_truth(r1, "Second rewrite.\n")
        assert "Second rewrite" in r2
        assert "First rewrite" not in r2
        assert "## Timeline" in r2


# ---------------------------------------------------------------------------
# extract_wikilinks
# ---------------------------------------------------------------------------


class TestExtractWikilinks:
    def test_extracts_single_wikilink(self) -> None:
        content = "See [[project-niuu]] for context."
        assert extract_wikilinks(content) == ["project-niuu"]

    def test_extracts_multiple_wikilinks(self) -> None:
        content = "See [[project-niuu]] and [[person-karpathy]]."
        assert extract_wikilinks(content) == ["project-niuu", "person-karpathy"]

    def test_deduplicates_wikilinks(self) -> None:
        content = "[[project-niuu]] and again [[project-niuu]]."
        assert extract_wikilinks(content) == ["project-niuu"]

    def test_preserves_first_occurrence_order(self) -> None:
        content = "[[b]] then [[a]] then [[b]] then [[c]]."
        assert extract_wikilinks(content) == ["b", "a", "c"]

    def test_no_wikilinks_returns_empty(self) -> None:
        assert extract_wikilinks("No links here.") == []

    def test_wikilinks_from_well_formed_page(self) -> None:
        links = extract_wikilinks(WELL_FORMED_PAGE)
        assert "project-niuu" in links

    def test_empty_content(self) -> None:
        assert extract_wikilinks("") == []

    def test_strips_whitespace_from_slug(self) -> None:
        content = "[[ project-niuu ]]"
        assert extract_wikilinks(content) == ["project-niuu"]

    def test_ignores_malformed_single_bracket(self) -> None:
        content = "[not-a-link] but [[real-link]] works."
        assert extract_wikilinks(content) == ["real-link"]

    def test_wikilinks_in_frontmatter_also_extracted(self) -> None:
        content = "---\ntype: entity\n---\n\nSee [[concept-foo]].\n"
        assert extract_wikilinks(content) == ["concept-foo"]


# ---------------------------------------------------------------------------
# resolve_wikilink
# ---------------------------------------------------------------------------


class TestResolveWikilink:
    def test_returns_path_when_file_exists(self, tmp_path: Path) -> None:
        entities_dir = tmp_path / "entities"
        entities_dir.mkdir()
        (entities_dir / "person-karpathy.md").write_text("content", encoding="utf-8")
        result = resolve_wikilink("person-karpathy", tmp_path)
        assert result is not None
        assert result.name == "person-karpathy.md"

    def test_returns_none_when_file_missing(self, tmp_path: Path) -> None:
        result = resolve_wikilink("nonexistent-slug", tmp_path)
        assert result is None

    def test_resolves_to_entities_subdir(self, tmp_path: Path) -> None:
        entities_dir = tmp_path / "entities"
        entities_dir.mkdir()
        (entities_dir / "project-niuu.md").write_text("content", encoding="utf-8")
        result = resolve_wikilink("project-niuu", tmp_path)
        assert result == entities_dir / "project-niuu.md"

    def test_returns_none_for_empty_entities_dir(self, tmp_path: Path) -> None:
        (tmp_path / "entities").mkdir()
        result = resolve_wikilink("some-slug", tmp_path)
        assert result is None


# ---------------------------------------------------------------------------
# MimirPageMeta new frontmatter fields
# ---------------------------------------------------------------------------


class TestMimirPageMetaNewFields:
    """Verify the new compiled-truth fields added to MimirPageMeta."""

    def _make_meta(self, **overrides):
        from datetime import UTC, datetime

        from niuu.domain.mimir import MimirPageMeta

        defaults = dict(
            path="entities/person-karpathy.md",
            title="Andrej Karpathy",
            summary="AI researcher",
            category="entities",
            updated_at=datetime(2026, 4, 12, tzinfo=UTC),
        )
        defaults.update(overrides)
        return MimirPageMeta(**defaults)

    def test_page_type_defaults_none(self) -> None:
        assert self._make_meta().page_type is None

    def test_confidence_defaults_none(self) -> None:
        assert self._make_meta().confidence is None

    def test_entity_type_defaults_none(self) -> None:
        assert self._make_meta().entity_type is None

    def test_related_entities_defaults_empty(self) -> None:
        assert self._make_meta().related_entities == []

    def test_page_type_set(self) -> None:
        meta = self._make_meta(page_type=PageType.entity)
        assert meta.page_type == PageType.entity

    def test_confidence_set(self) -> None:
        meta = self._make_meta(confidence=PageConfidence.high)
        assert meta.confidence == PageConfidence.high

    def test_entity_type_set(self) -> None:
        meta = self._make_meta(entity_type=EntityType.person)
        assert meta.entity_type == EntityType.person

    def test_related_entities_set(self) -> None:
        meta = self._make_meta(related_entities=["project-niuu", "concept-foo"])
        assert meta.related_entities == ["project-niuu", "concept-foo"]

    def test_all_new_fields_together(self) -> None:
        meta = self._make_meta(
            page_type=PageType.entity,
            confidence=PageConfidence.medium,
            entity_type=EntityType.technology,
            related_entities=["concept-bar"],
        )
        assert meta.page_type == PageType.entity
        assert meta.confidence == PageConfidence.medium
        assert meta.entity_type == EntityType.technology
        assert meta.related_entities == ["concept-bar"]


# ---------------------------------------------------------------------------
# PageType / PageConfidence / EntityType enums
# ---------------------------------------------------------------------------


class TestPageTypeEnum:
    def test_all_values(self) -> None:
        values = {pt.value for pt in PageType}
        assert values == {
            "directive",
            "decision",
            "goal",
            "preference",
            "observation",
            "entity",
            "topic",
        }

    def test_str_enum_comparison(self) -> None:
        assert PageType.entity == "entity"

    def test_round_trip(self) -> None:
        for pt in PageType:
            assert PageType(pt.value) is pt


class TestPageConfidenceEnum:
    def test_all_values(self) -> None:
        values = {c.value for c in PageConfidence}
        assert values == {"high", "medium", "low"}

    def test_str_enum_comparison(self) -> None:
        assert PageConfidence.high == "high"


class TestEntityTypeEnum:
    def test_all_values(self) -> None:
        values = {et.value for et in EntityType}
        assert values == {"person", "project", "concept", "technology", "organization", "strategy"}

    def test_str_enum_comparison(self) -> None:
        assert EntityType.person == "person"
