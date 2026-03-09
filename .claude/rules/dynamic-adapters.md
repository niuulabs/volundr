# Dynamic Adapter Configuration

## Pattern

New adapters use dynamic import + kwargs for zero-code extensibility:

```yaml
repositories:
  enabled: true
    - adapter: "volundr.adapters.gitlab.GitLabProvider"
      name: "gitlab"
      base_url: "gitlab.com/niuulabs"
    - adapter: "volundr.adapters.gitlab.GithubProvider"
      name: "github"
      base_url: "github.com/niuulabs"
```

## Rules

1. **Config specifies a fully-qualified class path** in the `adapter` key
2. **Remaining keys are passed as `**kwargs`** to the adapter constructor
3. **No match/if-else chains** in the container for adapter selection
4. **Adding a new adapter = write the class + update YAML** — zero code changes elsewhere
5. **Adapter constructors accept plain kwargs** (strings, numbers, paths) — no config objects

## Container Wiring

```python
def _import_class(dotted_path: str) -> type:
    module_path, class_name = dotted_path.rsplit(".", 1)
    module = importlib.import_module(module_path)
    return getattr(module, class_name)

# Per-channel: import class, pass remaining dict keys as kwargs
cls = _import_class(channel_dict["adapter"])
kwargs = {k: v for k, v in channel_dict.items() if k != "adapter"}
instance = cls(**kwargs)
```

## Scope

This pattern applies to **new adapters only**. Existing adapters keep their current wiring but can be migrated later.
