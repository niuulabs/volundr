"""Sleipnir event type constants.

All event types are defined here as module-level constants to avoid magic
strings throughout the codebase. Import the constant, not the string literal.

Organised by namespace:

- ``RAVN_*`` — Ravn agent events
- ``TYR_*``  — Tyr autonomous dispatcher events
- ``VOLUNDR_*`` — Volundr platform events
- ``BIFROST_*`` — Bifrost gateway events
- ``SYSTEM_*`` — Infrastructure and lifecycle events
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# ravn — Ravn agent events
# ---------------------------------------------------------------------------

#: A tool call was dispatched to an external executor.
RAVN_TOOL_CALL: str = "ravn.tool.call"

#: A tool call completed successfully.
RAVN_TOOL_COMPLETE: str = "ravn.tool.complete"

#: A tool call failed with an error.
RAVN_TOOL_ERROR: str = "ravn.tool.error"

#: A reasoning step started within an agent loop.
RAVN_STEP_START: str = "ravn.step.start"

#: A reasoning step completed within an agent loop.
RAVN_STEP_COMPLETE: str = "ravn.step.complete"

#: An agent session started.
RAVN_SESSION_START: str = "ravn.session.start"

#: An agent session ended (gracefully or via interrupt).
RAVN_SESSION_END: str = "ravn.session.end"

#: An agent produced a final response.
RAVN_RESPONSE_COMPLETE: str = "ravn.response.complete"

#: An interrupt signal was received by the agent.
RAVN_INTERRUPT: str = "ravn.interrupt"

# ---------------------------------------------------------------------------
# tyr — Tyr autonomous dispatcher events
# ---------------------------------------------------------------------------

#: A new task was queued in the dispatcher.
TYR_TASK_QUEUED: str = "tyr.task.queued"

#: The dispatcher started executing a task.
TYR_TASK_STARTED: str = "tyr.task.started"

#: A task completed successfully.
TYR_TASK_COMPLETE: str = "tyr.task.complete"

#: A task failed.
TYR_TASK_FAILED: str = "tyr.task.failed"

#: A task was cancelled before completion.
TYR_TASK_CANCELLED: str = "tyr.task.cancelled"

#: A Saga (long-running multi-step task) was created.
TYR_SAGA_CREATED: str = "tyr.saga.created"

#: A Saga advanced to the next step.
TYR_SAGA_STEP: str = "tyr.saga.step"

#: A Saga completed all steps.
TYR_SAGA_COMPLETE: str = "tyr.saga.complete"

#: A Saga failed and was rolled back.
TYR_SAGA_FAILED: str = "tyr.saga.failed"

#: A dispatcher session started.
TYR_SESSION_START: str = "tyr.session.start"

#: A dispatcher session ended.
TYR_SESSION_END: str = "tyr.session.end"

# ---------------------------------------------------------------------------
# volundr — Volundr platform events
# ---------------------------------------------------------------------------

#: A pull request was opened in the platform.
VOLUNDR_PR_OPENED: str = "volundr.pr.opened"

#: A pull request was closed (merged or abandoned).
VOLUNDR_PR_CLOSED: str = "volundr.pr.closed"

#: A pull request received a review comment.
VOLUNDR_PR_REVIEWED: str = "volundr.pr.reviewed"

#: A repository integration was registered.
VOLUNDR_REPO_REGISTERED: str = "volundr.repo.registered"

#: A repository integration was removed.
VOLUNDR_REPO_REMOVED: str = "volundr.repo.removed"

#: A CI pipeline run started.
VOLUNDR_PIPELINE_STARTED: str = "volundr.pipeline.started"

#: A CI pipeline run completed.
VOLUNDR_PIPELINE_COMPLETE: str = "volundr.pipeline.complete"

#: A CI pipeline run failed.
VOLUNDR_PIPELINE_FAILED: str = "volundr.pipeline.failed"

# ---------------------------------------------------------------------------
# bifrost — Bifrost gateway events
# ---------------------------------------------------------------------------

#: A client connection was established through Bifrost.
BIFROST_CONNECTION_OPEN: str = "bifrost.connection.open"

#: A client connection was closed.
BIFROST_CONNECTION_CLOSE: str = "bifrost.connection.close"

#: A routing decision was made by the gateway.
BIFROST_ROUTE_SELECTED: str = "bifrost.route.selected"

#: An authentication check succeeded.
BIFROST_AUTH_SUCCESS: str = "bifrost.auth.success"

#: An authentication check failed.
BIFROST_AUTH_FAILURE: str = "bifrost.auth.failure"

#: A rate limit was applied to a request.
BIFROST_RATE_LIMITED: str = "bifrost.rate.limited"

# ---------------------------------------------------------------------------
# system — Infrastructure and lifecycle events
# ---------------------------------------------------------------------------

#: A health check ping was emitted.
SYSTEM_HEALTH_PING: str = "system.health.ping"

#: A service started and is ready.
SYSTEM_SERVICE_STARTED: str = "system.service.started"

#: A service is shutting down.
SYSTEM_SERVICE_STOPPING: str = "system.service.stopping"

#: Configuration was reloaded without restart.
SYSTEM_CONFIG_RELOADED: str = "system.config.reloaded"

#: A recoverable error occurred at the infrastructure layer.
SYSTEM_ERROR: str = "system.error"

#: A metric snapshot was emitted for observability.
SYSTEM_METRIC: str = "system.metric"
