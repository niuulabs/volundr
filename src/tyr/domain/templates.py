"""Saga template dataclasses and YAML loader.

Templates describe predefined saga workflows as YAML files.  The loader
parses a template, substitutes ``{event.field}`` placeholders, validates the
structure, and returns a :class:`SagaTemplate` ready for execution.

Template format (YAML)::

    name: "Review: {event.repo}#{event.pr_number}"
    feature_branch: "{event.branch}"
    base_branch: "{event.base_branch}"
    repos:
      - "{event.repo}"
    phases:
      - name: Code Review
        raids:
          - name: "Review PR #{event.pr_number}"
            description: "..."
            acceptance_criteria:
              - "All files reviewed"
            declared_files: []
            estimate_hours: 1.0
            persona: reviewer
            prompt: |
              ...
      - name: Human Approval
        needs_approval: true
        raids:
          - name: "Approve PR #{event.pr_number}"
            description: "Human sign-off gate."
            acceptance_criteria: []
            declared_files: []
            estimate_hours: 0.0
            persona: ""
            prompt: ""
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

# Regex matching {event.field_name} placeholders in template strings.
_EVENT_PLACEHOLDER_RE = re.compile(r"\{event\.([^}]+)\}")


# ---------------------------------------------------------------------------
# Template data classes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TemplateRaid:
    """A single raid within a template phase."""

    name: str
    description: str
    acceptance_criteria: list[str]
    declared_files: list[str]
    estimate_hours: float
    prompt: str
    persona: str = ""


@dataclass(frozen=True)
class TemplatePhase:
    """A phase within a saga template."""

    name: str
    raids: list[TemplateRaid]
    needs_approval: bool = False


@dataclass(frozen=True)
class SagaTemplate:
    """A fully-loaded and interpolated saga template."""

    name: str
    feature_branch: str
    base_branch: str
    repos: list[str]
    phases: list[TemplatePhase]


# ---------------------------------------------------------------------------
# Interpolation
# ---------------------------------------------------------------------------


def _interpolate(text: str, payload: dict) -> str:
    """Replace ``{event.field}`` placeholders with values from *payload*.

    Unknown fields are left as-is so templates remain renderable even when
    some payload keys are absent.
    """

    def _replace(m: re.Match) -> str:
        key = m.group(1)
        value = payload.get(key)
        if value is None:
            return m.group(0)
        return str(value)

    return _EVENT_PLACEHOLDER_RE.sub(_replace, text)


def _interpolate_value(value: Any, payload: dict) -> Any:
    """Recursively interpolate ``{event.*}`` placeholders in parsed YAML data.

    Operates on already-parsed Python objects (dicts, lists, strings) so that
    payload values containing YAML metacharacters cannot alter the document
    structure.
    """
    if isinstance(value, str):
        return _interpolate(value, payload)
    if isinstance(value, dict):
        return {k: _interpolate_value(v, payload) for k, v in value.items()}
    if isinstance(value, list):
        return [_interpolate_value(item, payload) for item in value]
    return value


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _validate_template(data: dict) -> None:
    """Validate parsed (and interpolated) template data.

    :raises ValueError: When mandatory fields are missing or the template
        structure is invalid.
    """
    if not data.get("name"):
        raise ValueError("Template is missing required field 'name'")

    phases = data.get("phases", [])
    for phase_idx, phase in enumerate(phases):
        phase_name = phase.get("name") or f"phase[{phase_idx}]"
        if not phase.get("name"):
            raise ValueError(f"Phase at index {phase_idx} is missing required field 'name'")
        raids = phase.get("raids", [])
        if not raids:
            raise ValueError(
                f"Phase '{phase_name}' has no raids — every phase must have at least one raid"
            )
        for raid_idx, raid in enumerate(raids):
            raid_name = raid.get("name") or f"raid[{raid_idx}]"
            if not raid.get("name"):
                raise ValueError(
                    f"Raid at index {raid_idx} in phase '{phase_name}'"
                    " is missing required field 'name'"
                )
            if not raid.get("persona"):
                raise ValueError(
                    f"Raid '{raid_name}' in phase '{phase_name}'"
                    " is missing required field 'persona'"
                )


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------

# Path to bundled templates shipped with the package.
BUNDLED_TEMPLATES_DIR = Path(__file__).parent.parent / "templates"


def load_template(name: str, templates_dir: Path, payload: dict) -> SagaTemplate:
    """Load and interpolate a YAML saga template.

    :param name: Template name without extension (e.g. ``"review"``).
    :param templates_dir: Directory to search first; falls back to bundled dir.
    :param payload: Sleipnir event payload used for ``{event.*}`` substitution.
    :raises FileNotFoundError: When the template cannot be found.
    :raises ValueError: When the template fails validation.
    """
    candidates = [
        templates_dir / f"{name}.yaml",
        BUNDLED_TEMPLATES_DIR / f"{name}.yaml",
    ]
    path = next((p for p in candidates if p.exists()), None)
    if path is None:
        raise FileNotFoundError(
            f"Saga template {name!r} not found in {templates_dir} or bundled templates"
        )

    raw = path.read_text(encoding="utf-8")
    # Parse YAML first, then interpolate — prevents payload values with YAML
    # metacharacters from altering the document structure.
    data = _interpolate_value(yaml.safe_load(raw), payload)

    _validate_template(data)

    phases = [
        TemplatePhase(
            name=p["name"],
            needs_approval=bool(p.get("needs_approval", False)),
            raids=[
                TemplateRaid(
                    name=r["name"],
                    description=r.get("description", ""),
                    acceptance_criteria=r.get("acceptance_criteria", []),
                    declared_files=r.get("declared_files", []),
                    estimate_hours=float(r.get("estimate_hours", 2.0)),
                    prompt=r.get("prompt", ""),
                    persona=r.get("persona", ""),
                )
                for r in p.get("raids", [])
            ],
        )
        for p in data.get("phases", [])
    ]

    return SagaTemplate(
        name=data["name"],
        feature_branch=data.get("feature_branch", "main"),
        base_branch=data.get("base_branch", "main"),
        repos=data.get("repos", []),
        phases=phases,
    )
