# Branching & PR Rules

## Default PR Target

- **All PRs target `dev`** unless the user explicitly says to target `main`
- When pushing branches or creating PRs, always use `dev` as the base branch
- Only target `main` when the user explicitly requests a production release merge

## Branch Flow

```
feature-branch ──► dev (integration) ──► main (production releases)
```

- `dev` is the long-lived integration branch for testing and dev releases
- `main` is for production releases only
- Feature branches are created from and merged into `dev`

## Dev Tags

- Pushes to `dev` automatically create `v*-dev.N` prerelease tags
- These trigger container builds, Helm chart packaging, and CLI builds — but NOT GitHub Releases
- Dev tags are ignored by the production release pipeline
