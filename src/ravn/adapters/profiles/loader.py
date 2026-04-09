"""Profile loader for Ravn — loads and parses RavnProfile YAML definitions.

Profiles define the deployment identity of a Ravn node: its name, location,
which persona it runs, what infrastructure it connects to, and how it behaves
operationally.

Lookup order for :meth:`ProfileLoader.load`:
  1. ``profiles_dir/<name>.yaml``  (user-defined overrides / custom nodes)
  2. Built-in profiles bundled with Ravn

Profile YAML format::

    name: tanngrisnir
    rune: ᚱ
    location: gimle
    deployment: k8s
    persona: autonomous-agent
    system_prompt_extra: |
      You are operating on Valaskjalf cluster.
      Cluster context and tooling are available.
    specialisations:
      - infrastructure
      - coding
      - research
    fallback_model: ""
    mcp_servers:
      - linear
      - gmail
    gateway_channels:
      - skuld
      - telegram
    sleipnir_topics: []
    output_mode: ambient
    mimir_mounts:
      - name: gimle-wiki
        role: primary
        priority: 10
    mimir_write_routing:
      "wiki/": gimle-wiki
    cascade_mode: networked
    trigger_names:
      - morning-review
      - on-deploy-event
    checkpoint_enabled: true
    checkpoint_strategy: on_milestone
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ravn.domain.profile import MimirMountRef, RavnProfile

_DEFAULT_PROFILES_DIR = Path.home() / ".ravn" / "profiles"

# ---------------------------------------------------------------------------
# Built-in profiles for known Ravens
# ---------------------------------------------------------------------------

_BUILTIN_PROFILES: dict[str, RavnProfile] = {
    "local": RavnProfile(
        name="local",
        rune="ᚱ",
        location="local",
        deployment="ephemeral",
        persona="autonomous-agent",
        specialisations=["general"],
        output_mode="ambient",
        checkpoint_enabled=False,
    ),
    "tanngrisnir": RavnProfile(
        name="tanngrisnir",
        rune="ᚱ",
        location="gimle",
        deployment="k8s",
        persona="autonomous-agent",
        specialisations=["infrastructure", "coding", "research"],
        cascade_mode="networked",
        checkpoint_enabled=True,
        checkpoint_strategy="on_milestone",
        output_mode="ambient",
    ),
    "huginn": RavnProfile(
        name="huginn",
        rune="ᚱ",
        location="iphone",
        deployment="mobile",
        persona="coding-agent",
        specialisations=["coding"],
        output_mode="surface",
        checkpoint_enabled=False,
        cascade_mode="local",
    ),
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_bool(val: Any, default: bool = False) -> bool:
    """Convert *val* to bool, returning *default* on unexpected types."""
    if isinstance(val, bool):
        return val
    if isinstance(val, int):
        return val != 0
    if isinstance(val, str):
        return val.lower() in {"true", "yes", "1"}
    return default


def _safe_int(val: Any, default: int = 0) -> int:
    """Convert *val* to int, returning *default* on failure."""
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------


class ProfileLoader:
    """Loads :class:`~ravn.domain.profile.RavnProfile` from YAML files or the built-in set.

    Lookup order for :meth:`load`:
      1. ``profiles_dir/<name>.yaml``  (user-defined overrides)
      2. Built-in profiles

    Args:
        profiles_dir: Directory to search for profile YAML files.
                      Defaults to ``~/.ravn/profiles``.
    """

    def __init__(self, profiles_dir: Path | None = None) -> None:
        self._profiles_dir = profiles_dir or _DEFAULT_PROFILES_DIR

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load(self, name: str) -> RavnProfile | None:
        """Load a profile by name.

        Returns the profile from ``profiles_dir/<name>.yaml`` if it exists,
        otherwise falls back to the built-in set.  Returns ``None`` when the
        name cannot be resolved.
        """
        file_path = self._profiles_dir / f"{name}.yaml"
        if file_path.is_file():
            return self.load_from_file(file_path)
        return _BUILTIN_PROFILES.get(name)

    def load_from_file(self, path: Path) -> RavnProfile | None:
        """Parse a profile YAML file.

        Returns ``None`` when the file is unreadable or malformed rather than
        raising, so callers can treat missing profiles as a soft error.
        """
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None
        return self.parse(text)

    def list_builtin_names(self) -> list[str]:
        """Return a sorted list of built-in profile names."""
        return sorted(_BUILTIN_PROFILES)

    # ------------------------------------------------------------------
    # Static helpers
    # ------------------------------------------------------------------

    @staticmethod
    def parse(text: str) -> RavnProfile | None:
        """Parse a profile YAML *text* string.

        Returns ``None`` on empty input or parse failure.
        """
        import yaml  # PyYAML — present via pydantic-settings[yaml]

        if not text.strip():
            return None

        try:
            raw = yaml.safe_load(text)
        except Exception:
            return None

        if not isinstance(raw, dict):
            return None

        name = str(raw.get("name", "")).strip()
        if not name:
            return None

        mimir_mounts: list[MimirMountRef] = []
        for m in raw.get("mimir_mounts") or []:
            if not isinstance(m, dict) or not m.get("name"):
                continue
            mimir_mounts.append(
                MimirMountRef(
                    name=str(m["name"]),
                    role=str(m.get("role", "primary")),
                    priority=_safe_int(m.get("priority", 10), 10),
                )
            )

        mimir_write_routing: dict[str, str] = {}
        raw_routing = raw.get("mimir_write_routing")
        if isinstance(raw_routing, dict):
            mimir_write_routing = {str(k): str(v) for k, v in raw_routing.items()}

        return RavnProfile(
            name=name,
            rune=str(raw.get("rune", "ᚱ")),
            location=str(raw.get("location", "")),
            deployment=str(raw.get("deployment", "ephemeral")),
            persona=str(raw.get("persona", "autonomous-agent")),
            system_prompt_extra=str(raw.get("system_prompt_extra", "")),
            specialisations=list(raw.get("specialisations") or []),
            fallback_model=str(raw.get("fallback_model", "")),
            mcp_servers=list(raw.get("mcp_servers") or []),
            gateway_channels=list(raw.get("gateway_channels") or []),
            sleipnir_topics=list(raw.get("sleipnir_topics") or []),
            output_mode=str(raw.get("output_mode", "ambient")),
            mimir_mounts=mimir_mounts,
            mimir_write_routing=mimir_write_routing,
            cascade_mode=str(raw.get("cascade_mode", "local")),
            trigger_names=list(raw.get("trigger_names") or []),
            checkpoint_enabled=_safe_bool(raw.get("checkpoint_enabled", False)),
            checkpoint_strategy=str(raw.get("checkpoint_strategy", "on_milestone")),
        )

    @staticmethod
    def to_yaml(profile: RavnProfile) -> str:
        """Serialise *profile* to a YAML string.

        Suitable for writing to ``~/.ravn/profiles/<name>.yaml``, storing in
        Mímir under ``self/ravn-profiles/``, or including in a Sleipnir
        ``odin.ravn.announce`` payload.
        """
        import yaml

        return yaml.dump(
            profile.to_dict(),
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        )
