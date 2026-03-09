# Code Style Rules

## Early Returns - No Nested Conditionals

Always use early returns to keep code flat:

```python
# ✅ GOOD: Early returns, flat structure
async def process_signal(self, signal: Signal) -> Response | None:
    if not self.is_running:
        return None

    if signal.priority < self.threshold:
        return None

    if signal.type == SignalType.INTERRUPT:
        return await self.handle_interrupt(signal)

    return await self.handle_normal(signal)

# ❌ BAD: Nested ifs
async def process_signal(self, signal: Signal) -> Response | None:
    if self.is_running:
        if signal.priority >= self.threshold:
            if signal.type == SignalType.INTERRUPT:
                return await self.handle_interrupt(signal)
            else:
                return await self.handle_normal(signal)
    return None
```

## No Single-Line Else

```python
# ✅ GOOD
if condition:
    return early_value
return normal_value

# ❌ BAD
if condition:
    return early_value
else:
    return normal_value
```

## Python Version

- Target Python 3.12+
- Use modern syntax: `X | None` not `Optional[X]`
- Use `match` statements where appropriate
