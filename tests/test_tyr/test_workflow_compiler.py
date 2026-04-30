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

    def test_compiles_branched_stage_graph_to_topological_pipeline_yaml(self) -> None:
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
                        "position": {"x": 340, "y": 200},
                    },
                    {
                        "id": "stage-3",
                        "kind": "stage",
                        "label": "QA",
                        "personaIds": ["qa-agent"],
                        "stageMembers": [{"personaId": "qa-agent", "budget": 40}],
                        "executionMode": "parallel",
                        "joinMode": "all",
                        "position": {"x": 540, "y": 150},
                    },
                    {"id": "end-1", "kind": "end", "label": "Done"},
                ],
                "edges": [
                    {"id": "e1", "source": "trigger-1", "target": "stage-1"},
                    {"id": "e2", "source": "stage-1", "target": "stage-2"},
                    {"id": "e3", "source": "stage-1", "target": "stage-3"},
                    {"id": "e4", "source": "stage-2", "target": "stage-3"},
                    {"id": "e5", "source": "stage-3", "target": "end-1"},
                ],
            }
        )

        result = compile_workflow_definition(workflow)

        assert result.errors == []
        assert result.definition_yaml is not None
        assert "name: review" in result.definition_yaml
        assert "name: security" in result.definition_yaml
        assert "name: qa" in result.definition_yaml
        assert result.definition_yaml.index("name: review") < result.definition_yaml.index(
            "name: security"
        )
        assert result.definition_yaml.index("name: security") < result.definition_yaml.index(
            "name: qa"
        )

    def test_compiles_trigger_fan_out_and_join_in_visual_order(self) -> None:
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
                        "position": {"x": 320, "y": 80},
                    },
                    {
                        "id": "stage-2",
                        "kind": "stage",
                        "label": "Security",
                        "personaIds": ["security-auditor"],
                        "stageMembers": [{"personaId": "security-auditor", "budget": 40}],
                        "executionMode": "parallel",
                        "joinMode": "all",
                        "position": {"x": 300, "y": 220},
                    },
                    {
                        "id": "stage-3",
                        "kind": "stage",
                        "label": "Verify",
                        "personaIds": ["verifier"],
                        "stageMembers": [{"personaId": "verifier", "budget": 40}],
                        "executionMode": "parallel",
                        "joinMode": "all",
                        "position": {"x": 520, "y": 160},
                    },
                    {"id": "end-1", "kind": "end", "label": "Done"},
                ],
                "edges": [
                    {"id": "e1", "source": "trigger-1", "target": "stage-1"},
                    {"id": "e2", "source": "trigger-1", "target": "stage-2"},
                    {"id": "e3", "source": "stage-1", "target": "stage-3"},
                    {"id": "e4", "source": "stage-2", "target": "stage-3"},
                    {"id": "e5", "source": "stage-3", "target": "end-1"},
                ],
            }
        )

        result = compile_workflow_definition(workflow)

        assert result.errors == []
        assert result.definition_yaml is not None
        assert result.definition_yaml.index("name: security") < result.definition_yaml.index(
            "name: review"
        )
        assert result.definition_yaml.index("name: review") < result.definition_yaml.index(
            "name: verify"
        )
