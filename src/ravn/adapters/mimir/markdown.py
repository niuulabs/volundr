"""MarkdownMimirAdapter — moved to src/mimir/adapters/markdown.py (NIU-548).

Import from ``mimir.adapters.markdown`` directly.
"""

from mimir.adapters.markdown import (  # noqa: F401
    MarkdownMimirAdapter,
    PathSecurityError,
    _extract_summary,
    _extract_title,
)

__all__ = ["MarkdownMimirAdapter", "PathSecurityError", "_extract_summary", "_extract_title"]
