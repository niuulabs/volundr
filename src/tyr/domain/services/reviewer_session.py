"""Reviewer session service — spawns LLM-powered review sessions for raids.

When a raid enters REVIEW, the ReviewEngine delegates to this service to spawn
a lightweight reviewer session (using the skuld-planner chart). The reviewer
reads the PR diff, checks project rules, scores confidence, and reports back.

The reviewer session replaces deterministic signal-based review with an
LLM-powered review that understands code context, architecture, and quality.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from tyr.config import ReviewConfig
from tyr.domain.models import PRStatus, Raid
from tyr.ports.volundr import SpawnRequest, VolundrFactory, VolundrSession

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ReviewerResult:
    """Outcome of a reviewer session."""

    session_id: str
    confidence: float
    summary: str
    issues: list[str]
    approved: bool


def build_reviewer_initial_prompt(
    raid: Raid,
    pr_status: PRStatus | None,
    changed_files: list[str],
    diff_summary: str,
) -> str:
    """Build the initial prompt sent to the reviewer session."""
    lines = [
        "## Review Request",
        "",
        f"**Ticket**: {raid.tracker_id}",
        f"**Raid**: {raid.name}",
        f"**Description**: {raid.description}",
    ]

    if raid.acceptance_criteria:
        lines.append("")
        lines.append("**Acceptance Criteria**:")
        for criterion in raid.acceptance_criteria:
            lines.append(f"- {criterion}")

    if pr_status:
        lines.extend(
            [
                "",
                f"**PR**: {pr_status.url}",
                f"**PR State**: {pr_status.state}",
                f"**CI Passed**: {pr_status.ci_passed}",
                f"**Mergeable**: {pr_status.mergeable}",
            ]
        )

    if changed_files:
        lines.extend(
            [
                "",
                f"**Changed Files** ({len(changed_files)}):",
            ]
        )
        for f in changed_files:
            lines.append(f"- `{f}`")

    if diff_summary:
        lines.extend(
            [
                "",
                "**Diff Summary**:",
                diff_summary,
            ]
        )

    lines.extend(
        [
            "",
            "## Instructions",
            "",
            "1. Read the full diff for this PR",
            "2. Check every changed file against ALL project rules",
            "3. Verify the implementation matches the acceptance criteria above",
            "4. Score your confidence from 0.0 to 1.0",
            "5. Report your findings as JSON in this exact format:",
            "",
            "```json",
            "{",
            '  "confidence": <score>,',
            '  "approved": <true|false>,',
            '  "summary": "<one-line summary>",',
            '  "issues": ["<issue 1>", "<issue 2>"]',
            "}",
            "```",
        ]
    )

    return "\n".join(lines)


def _try_parse_json(text: str) -> ReviewerResult | None:
    """Attempt to parse the reviewer response as JSON."""
    # Extract JSON from markdown code fences if present
    cleaned = text.strip()
    for prefix in ("```json", "```"):
        if prefix in cleaned:
            start = cleaned.index(prefix) + len(prefix)
            end = cleaned.index("```", start) if "```" in cleaned[start:] else len(cleaned)
            cleaned = cleaned[start:end].strip()
            break

    try:
        data = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        return None

    if not isinstance(data, dict):
        return None

    confidence = data.get("confidence", 0.0)
    if not isinstance(confidence, (int, float)):
        return None
    confidence = max(0.0, min(1.0, float(confidence)))

    approved = bool(data.get("approved", False))
    summary = str(data.get("summary", ""))
    raw_issues = data.get("issues", [])
    issues = [str(i) for i in raw_issues] if isinstance(raw_issues, list) else []

    if not summary and confidence == 0.0:
        return None

    return ReviewerResult(
        session_id="",
        confidence=confidence,
        summary=summary,
        issues=issues,
        approved=approved,
    )


def _try_parse_text(text: str) -> ReviewerResult | None:
    """Parse the text-based CONFIDENCE:/APPROVED:/SUMMARY:/ISSUES: format."""
    confidence = 0.0
    approved = False
    summary = ""
    issues: list[str] = []
    in_issues = False

    for line in text.splitlines():
        stripped = line.strip()

        if stripped.upper().startswith("CONFIDENCE:"):
            try:
                confidence = float(stripped.split(":", 1)[1].strip())
                confidence = max(0.0, min(1.0, confidence))
            except (ValueError, IndexError):
                pass
            in_issues = False
            continue

        if stripped.upper().startswith("APPROVED:"):
            val = stripped.split(":", 1)[1].strip().lower()
            approved = val in ("yes", "true", "1")
            in_issues = False
            continue

        if stripped.upper().startswith("SUMMARY:"):
            summary = stripped.split(":", 1)[1].strip()
            in_issues = False
            continue

        if stripped.upper().startswith("ISSUES:"):
            in_issues = True
            continue

        if in_issues and stripped.startswith("- "):
            issues.append(stripped[2:].strip())
            continue

    if not summary and confidence == 0.0:
        return None

    return ReviewerResult(
        session_id="",
        confidence=confidence,
        summary=summary,
        issues=issues,
        approved=approved,
    )


def parse_reviewer_response(text: str) -> ReviewerResult | None:
    """Parse the structured response from a reviewer session.

    Tries JSON first, falls back to the text-based format.
    Returns None if the response cannot be parsed.
    """
    result = _try_parse_json(text)
    if result is not None:
        return result
    return _try_parse_text(text)


class ReviewerSessionService:
    """Spawns and manages LLM-powered reviewer sessions.

    Responsibilities:
    - Build the reviewer system prompt and initial prompt
    - Spawn a reviewer session via Volundr
    - Parse the reviewer's confidence score and feedback
    - Send feedback to the working session when issues are found
    """

    def __init__(
        self,
        volundr_factory: VolundrFactory,
        review_config: ReviewConfig,
    ) -> None:
        self._volundr_factory = volundr_factory
        self._cfg = review_config

    async def spawn_reviewer(
        self,
        raid: Raid,
        owner_id: str,
        pr_status: PRStatus | None,
        changed_files: list[str],
        integration_ids: list[str] | None = None,
        working_session: VolundrSession | None = None,
    ) -> VolundrSession | None:
        """Spawn a reviewer session for a raid in REVIEW state.

        Returns the VolundrSession if spawned successfully, None otherwise.
        """
        adapters = await self._volundr_factory.for_owner(owner_id)
        if not adapters:
            logger.error(
                "No authenticated Volundr adapter for owner %s — "
                "user must configure a CODE_FORGE integration with a valid PAT",
                owner_id[:8],
            )
            return None

        # Find the Volundr instance hosting the working session
        volundr = adapters[0]
        if raid.session_id and len(adapters) > 1:
            for adapter in adapters:
                try:
                    session = await adapter.get_session(raid.session_id)
                    if session is not None:
                        volundr = adapter
                        break
                except Exception:
                    continue

        diff_summary = self._get_diff_summary(raid)

        initial_prompt = build_reviewer_initial_prompt(
            raid=raid,
            pr_status=pr_status,
            changed_files=changed_files,
            diff_summary=diff_summary,
        )

        request = SpawnRequest(
            name=f"review-{(raid.identifier or raid.tracker_id[:8]).lower()}",
            repo=working_session.repo if working_session else "",
            branch=working_session.name if working_session else "",
            base_branch=working_session.branch if working_session else "main",
            model=self._cfg.reviewer_model,
            tracker_issue_id=raid.tracker_id,
            tracker_issue_url=raid.pr_url or "",
            system_prompt=self._cfg.reviewer_system_prompt,
            initial_prompt=initial_prompt,
            workload_type="reviewer",
            profile=self._cfg.reviewer_profile,
            integration_ids=integration_ids or [],
        )

        logger.info(
            "Spawning reviewer: repo=%s branch=%s model=%s profile=%s integrations=%d",
            working_session.repo if working_session else "?",
            working_session.branch if working_session else "?",
            self._cfg.reviewer_model,
            self._cfg.reviewer_profile,
            len(integration_ids or []),
        )
        try:
            session = await volundr.spawn_session(request)
            logger.info(
                "Spawned reviewer session %s for raid %s",
                session.id,
                raid.tracker_id,
            )
            return session
        except Exception:
            logger.warning(
                "Failed to spawn reviewer session for raid %s",
                raid.tracker_id,
                exc_info=True,
            )
            return None

    async def send_feedback_to_working_session(
        self,
        raid: Raid,
        owner_id: str,
        result: ReviewerResult,
    ) -> None:
        """Send reviewer feedback to the working session that produced the PR."""
        if not raid.session_id:
            return

        if not result.issues:
            return

        adapters = await self._volundr_factory.for_owner(owner_id)
        if not adapters:
            logger.warning(
                "No authenticated Volundr adapter for owner %s — cannot send feedback",
                owner_id[:8],
            )
            return

        volundr = adapters[0]

        feedback_lines = [
            f"## Review Feedback (confidence: {result.confidence:.2f})",
            "",
            f"**Summary**: {result.summary}",
            "",
            "**Issues to address**:",
        ]
        for issue in result.issues:
            feedback_lines.append(f"- {issue}")

        try:
            await volundr.send_message(raid.session_id, "\n".join(feedback_lines))
            logger.info(
                "Sent reviewer feedback to session %s (%d issues)",
                raid.session_id,
                len(result.issues),
            )
        except Exception:
            logger.warning(
                "Failed to send reviewer feedback to session %s",
                raid.session_id,
                exc_info=True,
            )

    def _get_diff_summary(self, raid: Raid) -> str:
        """Get a diff summary from the raid's chronicle summary."""
        if not raid.chronicle_summary:
            return ""
        return raid.chronicle_summary
