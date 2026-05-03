from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from tyr.domain.models import WorkflowDefinition, WorkflowScope
from tyr.domain.workflow_snapshot import build_workflow_snapshot


def test_build_workflow_snapshot_preserves_mimir_resource_data() -> None:
    workflow = WorkflowDefinition(
        id=uuid4(),
        name="Knowledge Flow",
        description="Workflow with explicit resources",
        version="1.0.0",
        scope=WorkflowScope.USER,
        owner_id="user-1",
        definition_yaml="name: Knowledge Flow",
        graph={
            "nodes": [
                {
                    "id": "stage-1",
                    "kind": "stage",
                    "label": "Review",
                    "stageMembers": [{"personaId": "reviewer", "budget": 40}],
                },
                {
                    "id": "mimir-shared",
                    "kind": "resource",
                    "label": "Shared Mimir",
                    "resourceType": "mimir",
                    "bindingMode": "registry",
                    "registryEntryId": "shared-team-mimir",
                    "categories": ["entity", "decision"],
                },
                {
                    "id": "mimir-scratch",
                    "kind": "resource",
                    "label": "Scratchpad",
                    "resourceType": "mimir",
                    "bindingMode": "ephemeral_local",
                    "seedFromRegistryId": "shared-team-mimir",
                    "categories": ["draft"],
                },
            ],
            "edges": [],
            "resourceBindings": [
                {
                    "id": "binding-1",
                    "resourceNodeId": "mimir-shared",
                    "targetType": "stage",
                    "targetId": "stage-1",
                    "access": "read_write",
                    "writePrefixes": ["project/"],
                    "readPriority": 3,
                },
                {
                    "id": "binding-2",
                    "resourceNodeId": "mimir-scratch",
                    "targetType": "workflow",
                    "targetId": "workflow-1",
                    "access": "write",
                    "writePrefixes": ["draft/"],
                    "readPriority": 10,
                },
            ],
        },
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )

    snapshot = build_workflow_snapshot(workflow)

    assert [node["id"] for node in snapshot["resource_nodes"]] == [
        "mimir-shared",
        "mimir-scratch",
    ]
    assert [binding["id"] for binding in snapshot["resource_bindings"]] == [
        "binding-1",
        "binding-2",
    ]
    assert snapshot["mimir"]["registry_refs"] == [
        {
            "resource_node_id": "mimir-shared",
            "registry_entry_id": "shared-team-mimir",
            "mount_name": "shared-team-mimir",
            "label": "Shared Mimir",
            "categories": ["entity", "decision"],
        }
    ]
    assert snapshot["mimir"]["ephemeral_locals"] == [
        {
            "resource_node_id": "mimir-scratch",
            "mount_name": "scratchpad",
            "label": "Scratchpad",
            "seed_from_registry_id": "shared-team-mimir",
            "categories": ["draft"],
        }
    ]
    assert snapshot["mimir"]["bindings"] == [
        {
            "resource_node_id": "mimir-shared",
            "mount_name": "shared-team-mimir",
            "target_type": "stage",
            "target_id": "stage-1",
            "access": "read_write",
            "write_prefixes": ["project/"],
            "read_priority": 3,
        },
        {
            "resource_node_id": "mimir-scratch",
            "mount_name": "scratchpad",
            "target_type": "workflow",
            "target_id": "workflow-1",
            "access": "write",
            "write_prefixes": ["draft/"],
            "read_priority": 10,
        },
    ]
