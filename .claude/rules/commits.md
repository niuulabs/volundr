# Commit Rules

## Conventional Commits

All commits MUST follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only changes |
| `style` | Changes that don't affect code meaning (whitespace, formatting) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Code change that improves performance |
| `test` | Adding missing tests or correcting existing tests |
| `build` | Changes to build system or external dependencies |
| `ci` | Changes to CI configuration files and scripts |
| `chore` | Other changes that don't modify src or test files |

### Scopes

Use the region or module name as scope:

- `skoll`, `hati`, `saga`, `modi`, `vali`, `vidarr` - Region changes
- `ports`, `adapters` - Infrastructure layer changes
- `cli` - CLI changes
- `config` - Configuration changes
- `synapse` - Communication layer changes

### Examples

```
feat(skoll): add threat detection for file system events

fix(saga): prevent memory leak in vector store connection

refactor(ports): simplify LLM port interface

test(hati): add pattern recognition unit tests

docs: update README with installation instructions

chore: update dependencies
```

### Rules

- Use imperative mood: "add" not "added" or "adds"
- Don't capitalize first letter of description
- No period at the end of description
- Keep description under 72 characters
- Use body for detailed explanation if needed
