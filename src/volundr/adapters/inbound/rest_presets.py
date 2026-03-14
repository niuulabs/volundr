"""FastAPI REST adapter for presets."""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from volundr.domain.models import Preset
from volundr.domain.services.preset import (
    PresetDuplicateNameError,
    PresetNotFoundError,
    PresetService,
)

logger = logging.getLogger(__name__)


# --- Request/Response models ---


class PresetCreate(BaseModel):
    """Request model for creating a preset."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="")
    is_default: bool = Field(default=False)
    cli_tool: str = Field(default="")
    workload_type: str = Field(default="session")
    model: str | None = Field(default=None, max_length=100)
    system_prompt: str | None = Field(default=None)
    resource_config: dict = Field(default_factory=dict)
    mcp_servers: list[dict] = Field(default_factory=list)
    terminal_sidecar: dict = Field(default_factory=dict)
    skills: list[dict] = Field(default_factory=list)
    rules: list[dict] = Field(default_factory=list)
    env_vars: dict[str, str] = Field(default_factory=dict)
    env_secret_refs: list[str] = Field(default_factory=list)
    workload_config: dict = Field(default_factory=dict)


class PresetUpdate(BaseModel):
    """Request model for updating a preset (all fields optional)."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None)
    is_default: bool | None = Field(default=None)
    cli_tool: str | None = Field(default=None)
    workload_type: str | None = Field(default=None)
    model: str | None = Field(default=None, max_length=100)
    system_prompt: str | None = Field(default=None)
    resource_config: dict | None = Field(default=None)
    mcp_servers: list[dict] | None = Field(default=None)
    terminal_sidecar: dict | None = Field(default=None)
    skills: list[dict] | None = Field(default=None)
    rules: list[dict] | None = Field(default=None)
    env_vars: dict[str, str] | None = Field(default=None)
    env_secret_refs: list[str] | None = Field(default=None)
    workload_config: dict | None = Field(default=None)


class PresetResponse(BaseModel):
    """Response model for a preset."""

    id: UUID
    name: str
    description: str
    is_default: bool
    cli_tool: str
    workload_type: str
    model: str | None
    system_prompt: str | None
    resource_config: dict
    mcp_servers: list[dict]
    terminal_sidecar: dict
    skills: list[dict]
    rules: list[dict]
    env_vars: dict[str, str]
    env_secret_refs: list[str]
    workload_config: dict
    created_at: str
    updated_at: str

    @classmethod
    def from_preset(cls, preset: Preset) -> PresetResponse:
        """Create response from domain model."""
        return cls(
            id=preset.id,
            name=preset.name,
            description=preset.description,
            is_default=preset.is_default,
            cli_tool=preset.cli_tool,
            workload_type=preset.workload_type,
            model=preset.model,
            system_prompt=preset.system_prompt,
            resource_config=preset.resource_config,
            mcp_servers=preset.mcp_servers,
            terminal_sidecar=preset.terminal_sidecar,
            skills=preset.skills,
            rules=preset.rules,
            env_vars=preset.env_vars,
            env_secret_refs=preset.env_secret_refs,
            workload_config=preset.workload_config,
            created_at=preset.created_at.isoformat(),
            updated_at=preset.updated_at.isoformat(),
        )


class ErrorResponse(BaseModel):
    """Response model for errors."""

    detail: str


# --- Router factory ---


def create_presets_router(preset_service: PresetService) -> APIRouter:
    """Create FastAPI router for preset endpoints."""
    router = APIRouter(prefix="/api/v1/volundr")

    @router.get("/presets", response_model=list[PresetResponse], tags=["Presets"])
    async def list_presets(
        cli_tool: str | None = Query(default=None),
        is_default: bool | None = Query(default=None),
    ) -> list[PresetResponse]:
        """List presets with optional filters."""
        presets = await preset_service.list_presets(cli_tool=cli_tool, is_default=is_default)
        return [PresetResponse.from_preset(p) for p in presets]

    @router.get(
        "/presets/{preset_id}",
        response_model=PresetResponse,
        responses={404: {"model": ErrorResponse}},
        tags=["Presets"],
    )
    async def get_preset(preset_id: UUID) -> PresetResponse:
        """Get a preset by ID."""
        try:
            preset = await preset_service.get_preset(preset_id)
            return PresetResponse.from_preset(preset)
        except PresetNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Preset not found: {preset_id}",
            )

    @router.post(
        "/presets",
        response_model=PresetResponse,
        status_code=status.HTTP_201_CREATED,
        responses={409: {"model": ErrorResponse}},
        tags=["Presets"],
    )
    async def create_preset(data: PresetCreate) -> PresetResponse:
        """Create a new preset."""
        try:
            preset = await preset_service.create_preset(
                name=data.name,
                description=data.description,
                is_default=data.is_default,
                cli_tool=data.cli_tool,
                workload_type=data.workload_type,
                model=data.model,
                system_prompt=data.system_prompt,
                resource_config=data.resource_config,
                mcp_servers=data.mcp_servers,
                terminal_sidecar=data.terminal_sidecar,
                skills=data.skills,
                rules=data.rules,
                env_vars=data.env_vars,
                env_secret_refs=data.env_secret_refs,
                workload_config=data.workload_config,
            )
            return PresetResponse.from_preset(preset)
        except PresetDuplicateNameError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Preset with name already exists: {data.name}",
            )

    @router.put(
        "/presets/{preset_id}",
        response_model=PresetResponse,
        responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
        tags=["Presets"],
    )
    async def update_preset(preset_id: UUID, data: PresetUpdate) -> PresetResponse:
        """Update a preset."""
        try:
            updates = data.model_dump(exclude_unset=True)
            preset = await preset_service.update_preset(preset_id, updates)
            return PresetResponse.from_preset(preset)
        except PresetNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Preset not found: {preset_id}",
            )
        except PresetDuplicateNameError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Preset with name already exists: {data.name}",
            )

    @router.delete(
        "/presets/{preset_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        responses={404: {"model": ErrorResponse}},
        tags=["Presets"],
    )
    async def delete_preset(preset_id: UUID) -> None:
        """Delete a preset."""
        try:
            await preset_service.delete_preset(preset_id)
        except PresetNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Preset not found: {preset_id}",
            )

    return router
