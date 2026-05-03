# NIU-771 Checklist

## Mimir

- [x] Create a repo-local checklist and keep it updated during implementation
- [x] Add a file-backed Mimir registry store behind the service
- [x] Preserve the existing `/mounts` operational API while backing it with registry data
- [x] Add registry CRUD endpoints for known Mimir instances
- [x] Fix explicit mount-targeted ingest so requested mount selection is real
- [x] Extend `plugin-mimir` ports/adapters for registry access
- [x] Add a lightweight registry management view in `plugin-mimir`

## Tyr Workflow

- [x] Extend workflow schema with Mimir resource nodes
- [x] Add workflow resource bindings as a separate graph layer
- [x] Keep compiler execution semantics unchanged for normal workflow edges
- [x] Preserve workflow resource data in snapshots
- [x] Thread workflow Mimir resource data into workload config

## Runtime Follow-Up

- [x] Resolve workflow registry references vs ephemeral local Mimirs in flock provisioning
- [x] Replace legacy hosted-url-only wiring with richer Mimir workload config
- [x] Add focused backend and web tests for touched areas
