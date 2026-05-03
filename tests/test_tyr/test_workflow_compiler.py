"""Tests for Tyr workflow DAG compilation."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from tyr.domain.models import WorkflowDefinition, WorkflowScope
from tyr.domain.workflow_compiler import compile_workflow_definition


def _workflow(graph: dict) -> WorkflowDefinition:
    now = datetime.now(UTC)
    return WorkflowDefinition(
        id=uuid4(),
        name="Review Flow",
        description="",
        version="1.0.0",
        scope=WorkflowScope.USER,
        owner_id="user-1",
        definition_yaml=None,
        graph=graph,
        created_at=now,
        updated_at=now,
    )


class TestWorkflowCompiler:
    def test_compiles_linear_stage_graph_to_pipeline_yaml(self) -> None:
        workflow = _workflow(
            {
                "nodes": [
                    {
                        "id": "trigger-1",
                        "kind": "trigger",
                        "label": "Start",
                        "source": "manual dispatch",
                    },
                    {
                        "id": "stage-1",
                        "kind": "stage",
                        "label": "Review",
                        "personaIds": ["reviewer"],
                        "stageMembers": [{"personaId": "reviewer", "budget": 40}],
                        "executionMode": "parallel",
                        "joinMode": "all",
                    },
                    {"id": "end-1", "kind": "end", "label": "Done"},
                ],
                "edges": [
                    {"id": "e1", "source": "trigger-1", "target": "stage-1"},
                    {"id": "e2", "source": "stage-1", "target": "end-1"},
                ],
            }
        )

        result = compile_workflow_definition(workflow)

        assert result.errors == []
        assert result.definition_yaml is not None
        assert "name: Review Flow" in result.definition_yaml
        assert "parallel:" in result.definition_yaml
        assert "persona: reviewer" in result.definition_yaml
        assert "fan_in: all_must_pass" in result.definition_yaml

    def test_reports_conditional_nodes_as_not_yet_executable(self) -> None:
        workflow = _workflow(
            {
                "nodes": [
                    {
                        "id": "trigger-1",
                        "kind": "trigger",
                        "label": "Start",
                        "source": "manual dispatch",
                    },
                    {
                        "id": "cond-1",
                        "kind": "cond",
                        "label": "Route",
                        "predicate": "stages.review.verdict == pass",
                    },
                ],
                "edges": [],
            }
        )

        result = compile_workflow_definition(workflow)

        assert result.definition_yaml is None
        assert result.errors == [
            "Conditional nodes are not yet executable in Tyr runtime: Route."
        ]

    def test_reports_branching_as_not_yet_executable(self) -> None:
        workflow = _workflow(
            {
                "nodes": [
                    {
                        "id": "trigger-1",
                        "kind": "trigger",
                        "label": "Start",
                        "source": "manual dispatch",
                    },
                    {
                        "id": "stage-1",
                        "kind": "stage",
                        "label": "Review",
                        "personaIds": ["reviewer"],
                        "stageMembers": [{"personaId": "reviewer", "budget": 40}],
                        "executionMode": "parallel",
                        "joinMode": "all",
                    },
                    {
                        "id": "stage-2",
                        "kind": "stage",
                        "label": "Security",
                        "personaIds": ["security-auditor"],
                        "stageMembers": [{"personaId": "security-auditor", "budget": 40}],
                        "executionMode": "parallel",
                        "joinMode": "all",
                    },
                    {
                        "id": "stage-3",
                        "kind": "stage",
                        "label": "QA",
                        "personaIds": ["qa-agent"],
                        "stageMembers": [{"personaId": "qa-agent", "budget": 40}],
                        "executionMode": "parallel",
                        "joinMode": "all",
                    },
                ],
                "edges": [
                    {"id": "e1", "source": "trigger-1", "target": "stage-1"},
                    {"id": "e2", "source": "stage-1", "target": "stage-2"},
                    {"id": "e3", "source": "stage-1", "target": "stage-3"},
                ],
            }
        )

        result = compile_workflow_definition(workflow)

        assert result.definition_yaml is None
        assert result.errors == [
            "Node 'Review' fans out to multiple paths, which Tyr cannot execute yet.",
            "Workflow graph contains disconnected or unsupported runtime nodes: QA, Security",
        ]

    def test_ignores_resource_nodes_for_pipeline_compilation(self) -> None:
        workflow = _workflow(
            {
                "nodes": [
                    {
                        "id": "trigger-1",
                        "kind": "trigger",
                        "label": "Start",
                        "source": "manual dispatch",
                    },
                    {
                        "id": "stage-1",
                        "kind": "stage",
                        "label": "Review",
                        "personaIds": ["reviewer"],
                        "stageMembers": [{"personaId": "reviewer", "budget": 40}],
                        "executionMode": "parallel",
                        "joinMode": "all",
                    },
                    {
                        "id": "resource-1",
                        "kind": "resource",
                        "label": "Shared Mimir",
                        "resourceType": "mimir",
                        "bindingMode": "registry",
                        "registryEntryId": "mimir-shared",
                    },
                    {"id": "end-1", "kind": "end", "label": "Done"},
                ],
                "edges": [
                    {"id": "e1", "source": "trigger-1", "target": "stage-1"},
                    {"id": "e2", "source": "stage-1", "target": "end-1"},
                ],
                "resourceBindings": [
                    {
                        "id": "binding-1",
                        "resourceNodeId": "resource-1",
                        "targetType": "stage",
                        "targetId": "stage-1",
                        "access": "read_write",
                        "writePrefixes": ["projects/"],
                        "readPriority": 3,
                    }
                ],
            }
        )

        result = compile_workflow_definition(workflow)

        assert result.errors == []
        assert result.definition_yaml is not None
        assert "persona: reviewer" in result.definition_yaml
