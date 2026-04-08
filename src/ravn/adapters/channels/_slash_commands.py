"""Shared slash command → agent prompt mapping for Ravn gateway adapters.

Each adapter imports :data:`GATEWAY_SLASH_PROMPTS` and may extend it with
platform-specific command aliases (e.g. Slack's ``/ravn-`` prefix variants).
"""

from __future__ import annotations

GATEWAY_SLASH_PROMPTS: dict[str, str] = {
    "/compact": "Please compact and summarise the current context.",
    "/budget": "How many iterations have you used and how many remain in your budget?",
    "/status": "What is your current task status? Summarise briefly.",
    "/stop": "Please acknowledge that you are stopping and summarise what you were working on.",
    "/todo": "List your current todo items.",
}
