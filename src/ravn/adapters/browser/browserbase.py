"""BrowserbaseAdapter — cloud browser backend via Browserbase.

Activated automatically when ``BROWSERBASE_API_KEY`` is set (or via config).
Falls back gracefully to an error if the ``playwright`` package is not installed.

See: https://docs.browserbase.com/reference/api/create-a-session
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

from ravn.adapters.browser.local import _PREVIEW_MAX_CHARS, _serialise_ax_tree
from ravn.ports.browser import PageSummary

logger = logging.getLogger(__name__)

_DEFAULT_CONNECT_URL = "wss://connect.browserbase.com"


class BrowserbaseAdapter:
    """Browser backend that executes in Browserbase's cloud infrastructure.

    Supports stealth mode and CAPTCHA solving (configured via the Browserbase
    project settings — no extra kwargs required here).

    Args:
        api_key:    Browserbase API key. Falls back to ``BROWSERBASE_API_KEY`` env var.
        project_id: Browserbase project ID. Falls back to ``BROWSERBASE_PROJECT_ID``.
        stealth:    Enable stealth mode (anti-bot fingerprint masking).
        headless:   Local browser headless flag (used for the CDP proxy connection).
        timeout_ms: Default navigation / action timeout in milliseconds.
    """

    def __init__(
        self,
        *,
        api_key: str = "",
        project_id: str = "",
        stealth: bool = False,
        headless: bool = True,
        timeout_ms: int = 30_000,
    ) -> None:
        self._api_key = api_key or os.environ.get("BROWSERBASE_API_KEY", "")
        self._project_id = project_id or os.environ.get("BROWSERBASE_PROJECT_ID", "")
        self._stealth = stealth
        self._headless = headless
        self._timeout_ms = timeout_ms

        self._playwright: Any = None
        self._browser: Any = None
        self._page: Any = None
        self._session_id: str = ""
        self._handle_map: dict[str, Any] = {}

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def _ensure_browser(self) -> None:
        """Create a Browserbase session and connect via CDP."""
        if self._page is not None:
            return

        if not self._api_key:
            raise RuntimeError(
                "Browserbase API key is not set. "
                "Set BROWSERBASE_API_KEY or configure browser.browserbase.api_key_env."
            )

        try:
            import httpx
            from playwright.async_api import async_playwright
        except ImportError as exc:
            raise RuntimeError(
                "playwright is not installed. "
                "Install it with: pip install 'ravn[browser]' && playwright install chromium"
            ) from exc

        # Create a remote Browserbase session via the REST API.
        async with httpx.AsyncClient(timeout=30.0) as client:
            payload: dict[str, Any] = {"projectId": self._project_id}
            if self._stealth:
                payload["browserSettings"] = {"fingerprint": {"devices": ["desktop"]}}
            resp = await client.post(
                "https://www.browserbase.com/v1/sessions",
                json=payload,
                headers={"X-BB-API-Key": self._api_key, "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            session_data = resp.json()

        self._session_id = session_data["id"]
        connect_url = session_data.get("connectUrl") or (
            f"{_DEFAULT_CONNECT_URL}?apiKey={self._api_key}&sessionId={self._session_id}"
        )

        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.connect_over_cdp(connect_url)
        if self._browser.contexts:
            context = self._browser.contexts[0]
        else:
            context = await self._browser.new_context()
        self._page = context.pages[0] if context.pages else await context.new_page()
        self._page.set_default_timeout(self._timeout_ms)
        logger.debug(
            "Browserbase session created (id=%s, stealth=%s)", self._session_id, self._stealth
        )

    async def close(self) -> None:
        """Close the Browserbase session and clean up resources."""
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
        logger.debug("Browserbase session closed (id=%s)", self._session_id)

    # ------------------------------------------------------------------
    # BrowserPort implementation
    # ------------------------------------------------------------------

    async def navigate(self, url: str, *, wait_for: str = "domcontentloaded") -> PageSummary:
        """Navigate to *url* and return a summary of the loaded page."""
        await self._ensure_browser()
        response = await self._page.goto(url, wait_until=wait_for)
        status = response.status if response else 0
        title = await self._page.title()
        try:
            body_text = await self._page.evaluate(
                "() => document.body ? document.body.innerText : ''"
            )
        except Exception:  # noqa: BLE001
            body_text = ""
        preview = re.sub(r"\s{2,}", " ", body_text).strip()[:_PREVIEW_MAX_CHARS]
        return PageSummary(url=self._page.url, title=title, status=status, text_preview=preview)

    async def snapshot(self) -> str:
        """Return the accessibility tree as compact ``[role "label" @eN]`` text."""
        await self._ensure_browser()
        ax_tree = await self._page.accessibility.snapshot()
        if ax_tree is None:
            return "(empty page)"
        text, handle_map = _serialise_ax_tree(ax_tree)
        self._handle_map = handle_map
        return text or "(no interactive elements)"

    async def click(self, selector: str) -> None:
        """Click the element identified by *selector* or ``@eN`` handle."""
        await self._ensure_browser()
        if selector in self._handle_map:
            node = self._handle_map[selector]
            name = node.get("name", "")
            if name:
                await self._page.get_by_role(node["role"], name=name).first.click()
                return
        await self._page.click(selector)

    async def type(self, selector: str, text: str) -> None:
        """Type *text* into the element identified by *selector* or ``@eN`` handle."""
        await self._ensure_browser()
        if selector in self._handle_map:
            node = self._handle_map[selector]
            placeholder = node.get("placeholder", "")
            name = node.get("name", "")
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
        from ravn.adapters.browser.local import _SCROLL_AMOUNT_PX

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
