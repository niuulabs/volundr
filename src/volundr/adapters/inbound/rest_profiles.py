"""FastAPI REST adapter for forge profiles and workspace templates."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from volundr.domain.models import (
    ForgeProfile,
    WorkspaceTemplate,
)
from volundr.domain.services.profile import (
    ForgeProfileService,
    ProfileNotFoundError,
    ProfileReadOnlyError,
    ProfileValidationError,
)
from volundr.domain.services.template import WorkspaceTemplateService

logger = logging.getLogger(__name__)


# --- Request/Response models ---


class ProfileResponse(BaseModel):
    """Response model for a forge profile."""

    name: str
    description: str
    workload_type: str
    model: str | None
    system_prompt: str | None
    resource_config: dict
    mcp_servers: list[dict]
    env_vars: dict[str, str]
    env_secret_refs: list[str]
    workload_config: dict
    is_default: bool

    @classmethod
    def from_profile(cls, profile: ForgeProfile) -> ProfileResponse:
        """Create response from domain model."""
        return cls(
            name=profile.name,
            description=profile.description,
            workload_type=profile.workload_type,
            model=profile.model,
            system_prompt=profile.system_prompt,
            resource_config=profile.resource_config,
            mcp_servers=profile.mcp_servers,
            env_vars=profile.env_vars,
            env_secret_refs=profile.env_secret_refs,
            workload_config=profile.workload_config,
            is_default=profile.is_default,
        )


class ProfileCreateRequest(BaseModel):
    """Request model for creating a forge profile."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="")
    workload_type: str = Field(default="session")
    model: str | None = Field(default=None, max_length=100)
    system_prompt: str | None = Field(default=None)
    resource_config: dict = Field(default_factory=dict)
    mcp_servers: list[dict] = Field(default_factory=list)
    env_vars: dict[str, str] = Field(default_factory=dict)
    env_secret_refs: list[str] = Field(default_factory=list)
    workload_config: dict = Field(default_factory=dict)
    is_default: bool = Field(default=False)


class ProfileUpdateRequest(BaseModel):
    """Request model for updating a forge profile."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None)
    workload_type: str | None = Field(default=None)
    model: str | None = Field(default=None, max_length=100)
    system_prompt: str | None = Field(default=None)
    resource_config: dict | None = Field(default=None)
    mcp_servers: list[dict] | None = Field(default=None)
    env_vars: dict[str, str] | None = Field(default=None)
    env_secret_refs: list[str] | None = Field(default=None)
    workload_config: dict | None = Field(default=None)
    is_default: bool | None = Field(default=None)


class TemplateResponse(BaseModel):
    """Response model for a workspace template (unified blueprint)."""

    name: str
    description: str
    repos: list[dict]
    setup_scripts: list[str]
    workspace_layout: dict
    is_default: bool
    # Runtime config (merged from profile)
    workload_type: str
    model: str | None
    system_prompt: str | None
    resource_config: dict
    mcp_servers: list[dict]
    env_vars: dict[str, str]
    env_secret_refs: list[str]
    workload_config: dict
    session_definition: str | None = None

    @classmethod
    def from_template(cls, template: WorkspaceTemplate) -> TemplateResponse:
        """Create response from domain model."""
        return cls(
            name=template.name,
            description=template.description,
            repos=template.repos,
            setup_scripts=template.setup_scripts,
            workspace_layout=template.workspace_layout,
            is_default=template.is_default,
            workload_type=template.workload_type,
            model=template.model,
            system_prompt=template.system_prompt,
            resource_config=template.resource_config,
            mcp_servers=template.mcp_servers,
            env_vars=template.env_vars,
            env_secret_refs=template.env_secret_refs,
            workload_config=template.workload_config,
            session_definition=template.session_definition,
        )


class ErrorResponse(BaseModel):
    """Response model for errors."""

    detail: str


# --- Router factory ---


def create_profiles_router(
    profile_service: ForgeProfileService,
    template_service: WorkspaceTemplateService,
) -> APIRouter:
    """Create FastAPI router for profile and template endpoints."""
    router = APIRouter(prefix="/api/v1/volundr")

    # --- Profile endpoints ---

    @router.get(
        "/profiles",
        response_model=list[ProfileResponse],
        tags=["Profiles"],
    )
    async def list_profiles(
        workload_type: str | None = Query(default=None),
    ) -> list[ProfileResponse]:
        """List all forge profiles."""
        profiles = profile_service.list_profiles(workload_type=workload_type)
        return [ProfileResponse.from_profile(p) for p in profiles]

    @router.get(
        "/profiles/{profile_name}",
        response_model=ProfileResponse,
        responses={404: {"model": ErrorResponse}},
        tags=["Profiles"],
    )
    async def get_profile(profile_name: str) -> ProfileResponse:
        """Get a forge profile by name."""
        profile = profile_service.get_profile(profile_name)
        if profile is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Profile not found: {profile_name}",
            )
        return ProfileResponse.from_profile(profile)

    @router.post(
        "/profiles",
        response_model=ProfileResponse,
        status_code=status.HTTP_201_CREATED,
        responses={
            400: {"model": ErrorResponse},
            409: {"model": ErrorResponse},
        },
        tags=["Profiles"],
    )
    async def create_profile(data: ProfileCreateRequest) -> ProfileResponse:
        """Create a new forge profile."""
        profile = ForgeProfile(
            name=data.name,
            description=data.description,
            workload_type=data.workload_type,
            model=data.model,
            system_prompt=data.system_prompt,
            resource_config=data.resource_config,
            mcp_servers=data.mcp_servers,
            env_vars=data.env_vars,
            env_secret_refs=data.env_secret_refs,
            workload_config=data.workload_config,
            is_default=data.is_default,
        )
        try:
            created = await profile_service.create_profile(profile)
            return ProfileResponse.from_profile(created)
        except ProfileValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            )
        except ProfileReadOnlyError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(exc),
            )

    @router.put(
        "/profiles/{profile_name}",
        response_model=ProfileResponse,
        responses={
            400: {"model": ErrorResponse},
            404: {"model": ErrorResponse},
        },
        tags=["Profiles"],
    )
    async def update_profile(
        profile_name: str,
        data: ProfileUpdateRequest,
    ) -> ProfileResponse:
        """Update an existing forge profile."""
        existing = profile_service.get_profile(profile_name)
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Profile not found: {profile_name}",
            )

        updated = ForgeProfile(
            name=data.name if data.name is not None else existing.name,
            description=(
                data.description if data.description is not None else existing.description
            ),
            workload_type=(
                data.workload_type if data.workload_type is not None else existing.workload_type
            ),
            model=data.model if data.model is not None else existing.model,
            system_prompt=(
                data.system_prompt if data.system_prompt is not None else existing.system_prompt
            ),
            resource_config=(
                data.resource_config
                if data.resource_config is not None
                else existing.resource_config
            ),
            mcp_servers=(
                data.mcp_servers if data.mcp_servers is not None else existing.mcp_servers
            ),
            env_vars=(data.env_vars if data.env_vars is not None else existing.env_vars),
            env_secret_refs=(
                data.env_secret_refs
                if data.env_secret_refs is not None
                else existing.env_secret_refs
            ),
            workload_config=(
                data.workload_config
                if data.workload_config is not None
                else existing.workload_config
            ),
            is_default=(data.is_default if data.is_default is not None else existing.is_default),
        )

        try:
            result = await profile_service.update_profile(profile_name, updated)
            return ProfileResponse.from_profile(result)
        except ProfileValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            )
        except ProfileReadOnlyError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            )
        except ProfileNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Profile not found: {profile_name}",
            )

    @router.delete(
        "/profiles/{profile_name}",
        status_code=status.HTTP_204_NO_CONTENT,
        responses={
            400: {"model": ErrorResponse},
            404: {"model": ErrorResponse},
        },
        tags=["Profiles"],
    )
    async def delete_profile(profile_name: str) -> None:
        """Delete a forge profile."""
        try:
            await profile_service.delete_profile(profile_name)
        except ProfileNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Profile not found: {profile_name}",
            )
        except ProfileReadOnlyError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            )

    # --- Template endpoints (read-only, config-driven) ---

    @router.get(
        "/templates",
        response_model=list[TemplateResponse],
        tags=["Templates"],
    )
    async def list_templates(
        workload_type: str | None = Query(default=None),
    ) -> list[TemplateResponse]:
        """List all workspace templates (loaded from configuration)."""
        templates = template_service.list_templates(workload_type=workload_type)
        return [TemplateResponse.from_template(t) for t in templates]

    @router.get(
        "/templates/{template_name}",
        response_model=TemplateResponse,
        responses={404: {"model": ErrorResponse}},
        tags=["Templates"],
    )
    async def get_template(template_name: str) -> TemplateResponse:
        """Get a workspace template by name (loaded from configuration)."""
        template = template_service.get_template(template_name)
        if template is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Template not found: {template_name}",
            )
        return TemplateResponse.from_template(template)

    return router
