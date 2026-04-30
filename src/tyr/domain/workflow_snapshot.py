"""Helpers for snapshotting compiled workflows onto sagas and dispatches."""

from __future__ import annotations

from typing import Any

from tyr.domain.models import WorkflowDefinition


def build_workflow_snapshot(workflow: WorkflowDefinition) -> dict[str, Any]:
    """Build a serializable workflow snapshot for saga assignment and dispatch."""
    personas = workflow_personas_from_snapshot({"graph": workflow.graph})
    return {
        "workflow_id": str(workflow.id),
        "name": workflow.name,
        "version": workflow.version,
        "scope": workflow.scope.value,
        "definition_yaml": workflow.definition_yaml,
        "graph": workflow.graph,
        "personas": personas,
    }


def workflow_name_from_snapshot(snapshot: dict[str, Any] | None) -> str | None:
    if not snapshot:
        return None

    name = snapshot.get("name")
    if isinstance(name, str) and name:
        return name
    return None


def workflow_personas_from_snapshot(snapshot: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Extract an ordered unique persona list from a workflow snapshot graph."""
    if not snapshot:
        return []

    personas = snapshot.get("personas")
    if isinstance(personas, list):
        normalized = [persona for persona in personas if isinstance(persona, dict)]
        if normalized:
            return normalized

    graph = snapshot.get("graph")
    if not isinstance(graph, dict):
        return []

    nodes = list(graph.get("nodes") or [])
    seen: set[str] = set()
    personas: list[dict[str, Any]] = []

    for node in nodes:
        if not isinstance(node, dict) or node.get("kind") != "stage":
            continue

        stage_members = list(node.get("stageMembers") or [])
        if stage_members:
            for member in stage_members:
                persona = _persona_from_member(member)
                if persona is None:
                    continue
                if persona["name"] in seen:
                    continue
                seen.add(persona["name"])
                personas.append(persona)
            continue

        for persona_id in list(node.get("personaIds") or []):
            if not isinstance(persona_id, str) or not persona_id or persona_id in seen:
                continue
            seen.add(persona_id)
            personas.append({"name": persona_id})

    return personas


def _persona_from_member(member: Any) -> dict[str, Any] | None:
    if not isinstance(member, dict):
        return None

    persona_id = member.get("personaId")
    if not isinstance(persona_id, str) or not persona_id:
        return None

    persona = {"name": persona_id}
    budget = member.get("budget")
    if isinstance(budget, int) and budget > 0:
        persona["iteration_budget"] = budget
    return persona
