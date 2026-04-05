"""Shared FastAPI dependencies for Bifrost inbound adapters."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from bifrost.ports.provider import LLMProviderPort


def _get_provider(request: Request) -> LLMProviderPort:
    return request.app.state.provider  # type: ignore[no-any-return]


ProviderDep = Annotated[LLMProviderPort, Depends(_get_provider)]
