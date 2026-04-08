"""LocalPlaywrightAdapter — headless Chromium browser backend via Playwright."""

from __future__ import annotations

import logging
import re
from typing import Any

from ravn.ports.browser import PageSummary

logger = logging.getLogger(__name__)

# Maximum characters of visible text included in the page summary preview.
_PREVIEW_MAX_CHARS = 500

# Pixel amounts per scroll step for the four directions.
_SCROLL_AMOUNT_PX = 300


def _ax_node_to_line(node: dict, counter: list[int]) -> str | None:
    """Convert a single accessibility node to a compact text line.

    Returns None for nodes that should be skipped (generic containers with
    no useful label and no role worth surfacing).
    """
    role = node.get("role", "")
    name = node.get("name", "").strip()

    skip_roles = {"none", "presentation", "generic", "group"}
    if role in skip_roles and not name:
        return None

    counter[0] += 1
    handle = f"@e{counter[0]}"

    extra: list[str] = []

    if "level" in node:
        extra.append(f"level={node['level']}")
    if "type" in node:
        extra.append(f"type={node['type']}")
    if "placeholder" in node:
        extra.append(f"placeholder=\"{node['placeholder']}\"")
    if node.get("checked") is not None:
        extra.append(f"checked={str(node['checked']).lower()}")
    if node.get("disabled"):
        extra.append("disabled")

    parts = [role]
    parts.extend(extra)
    if name:
        parts.append(f'"{name}"')
    parts.append(handle)

    return f"[{' '.join(parts)}]"


def _serialise_ax_tree(tree: dict) -> tuple[str, dict[str, Any]]:
    """Walk the Playwright accessibility tree and return compact text + handle map.

    Returns:
        (snapshot_text, handle_map) where handle_map maps ``@eN`` → node dict.
    """
    lines: list[str] = []
    handles: dict[str, Any] = {}
    counter = [0]

    def _walk(node: dict) -> None:
        line = _ax_node_to_line(node, counter)
        if line is not None:
            handle_key = f"@e{counter[0]}"
            handles[handle_key] = node
            lines.append(line)
        for child in node.get("children", []):
            _walk(child)

    _walk(tree)
    return "\n".join(lines), handles


class LocalPlaywrightAdapter:
    """Browser backend using a local headless Chromium instance via Playwright.

    This adapter is instantiated lazily — the browser is not launched until
    the first call to ``navigate()``.

    Args:
        headless:    Launch browser headlessly (default True).
        timeout_ms:  Default navigation / action timeout in milliseconds.
    """

    def __init__(self, *, headless: bool = True, timeout_ms: int = 30_000) -> None:
        self._headless = headless
        self._timeout_ms = timeout_ms
        self._playwright: Any = None
        self._browser: Any = None
        self._page: Any = None
        # Maps @eN → accessibility node dict for the current page snapshot.
        self._handle_map: dict[str, Any] = {}

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def _ensure_browser(self) -> None:
        """Launch browser if not already running."""
        if self._page is not None:
            return

        try:
            from playwright.async_api import async_playwright
        except ImportError as exc:
            raise RuntimeError(
                "playwright is not installed. "
                "Install it with: pip install 'ravn[browser]' && playwright install chromium"
            ) from exc

        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(headless=self._headless)
        self._page = await self._browser.new_page()
        self._page.set_default_timeout(self._timeout_ms)
        logger.debug("Local Chromium browser launched (headless=%s)", self._headless)

    async def close(self) -> None:
        """Close the browser and clean up Playwright resources."""
        if self._page is not None:
            await self._page.close()
            self._page = None
        if self._browser is not None:
            await self._browser.close()
            self._browser = None
        if self._playwright is not None:
            await self._playwright.stop()
            self._playwright = None
        self._handle_map = {}
        logger.debug("Local Chromium browser closed")

    # ------------------------------------------------------------------
    # BrowserPort implementation
    # ------------------------------------------------------------------

    async def navigate(self, url: str, *, wait_for: str = "domcontentloaded") -> PageSummary:
        """Navigate to *url* and return a summary of the loaded page."""
        await self._ensure_browser()
        response = await self._page.goto(url, wait_until=wait_for)
        status = response.status if response else 0
        title = await self._page.title()
        # Extract a short text preview from the page body.
        try:
            body_text = await self._page.evaluate(
                "() => document.body ? document.body.innerText : ''"
            )
        except Exception:  # noqa: BLE001
            body_text = ""
        preview = re.sub(r"\s{2,}", " ", body_text).strip()[:_PREVIEW_MAX_CHARS]
        logger.debug("Navigated to %s (status=%d)", url, status)
        return PageSummary(url=self._page.url, title=title, status=status, text_preview=preview)

    async def snapshot(self) -> str:
        """Return the accessibility tree as compact ``[role "label" @eN]`` text."""
        await self._ensure_browser()
        ax_tree = await self._page.accessibility.snapshot()
        if ax_tree is None:
            return "(empty page)"
        text, handle_map = _serialise_ax_tree(ax_tree)
        # Store for selector resolution in click / type calls.
        self._handle_map = handle_map
        return text or "(no interactive elements)"

    async def click(self, selector: str) -> None:
        """Click the element identified by *selector* or ``@eN`` handle."""
        await self._ensure_browser()
        if selector in self._handle_map:
            node = self._handle_map[selector]
            name = node.get("name", "")
            # Use the node name as a text locator when available.
            if name:
                await self._page.get_by_role(node["role"], name=name).first.click()
                return
        await self._page.click(selector)

    async def type(self, selector: str, text: str) -> None:
        """Type *text* into the element identified by *selector* or ``@eN`` handle."""
        await self._ensure_browser()
        if selector in self._handle_map:
            node = self._handle_map[selector]
            name = node.get("name", "")
            placeholder = node.get("placeholder", "")
            if placeholder:
                await self._page.get_by_placeholder(placeholder).fill(text)
                return
            if name:
                await self._page.get_by_role(node["role"], name=name).first.fill(text)
                return
        await self._page.fill(selector, text)

    async def scroll(self, direction: str, amount: int = 3) -> None:
        """Scroll the page in *direction* by *amount* steps."""
        await self._ensure_browser()
        delta_map = {
            "down": (0, _SCROLL_AMOUNT_PX),
            "up": (0, -_SCROLL_AMOUNT_PX),
            "right": (_SCROLL_AMOUNT_PX, 0),
            "left": (-_SCROLL_AMOUNT_PX, 0),
        }
        dx, dy = delta_map.get(direction, (0, _SCROLL_AMOUNT_PX))
        for _ in range(amount):
            await self._page.mouse.wheel(dx, dy)

    async def screenshot(self) -> bytes:
        """Capture a full-page screenshot and return raw PNG bytes."""
        await self._ensure_browser()
        return await self._page.screenshot(full_page=True)

    async def evaluate(self, js: str) -> Any:
        """Evaluate a JavaScript expression and return the result."""
        await self._ensure_browser()
        return await self._page.evaluate(js)
