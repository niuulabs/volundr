"""LocalPlaywrightAdapter — headless Chromium browser backend via Playwright."""

from __future__ import annotations

import logging

from ravn.adapters.browser._base import _ax_node_to_line, _PlaywrightBrowserBase, _serialise_ax_tree

__all__ = ["LocalPlaywrightAdapter", "_ax_node_to_line", "_serialise_ax_tree"]

logger = logging.getLogger(__name__)


class LocalPlaywrightAdapter(_PlaywrightBrowserBase):
    """Browser backend using a local headless Chromium instance via Playwright.

    This adapter is instantiated lazily — the browser is not launched until
    the first call to ``navigate()``.

    Args:
        headless:    Launch browser headlessly (default True).
        timeout_ms:  Default navigation / action timeout in milliseconds.
    """

    def __init__(self, *, headless: bool = True, timeout_ms: int = 30_000) -> None:
        super().__init__(timeout_ms=timeout_ms)
        self._headless = headless

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
