# Nuitka + Textual TUI Spike — NIU-397

Validation spike for compiling a Textual TUI app with Nuitka `--onefile`.

## Quick Start

### Run from source (development)

```bash
pip install textual
python -m niuu.tui.app
```

### Run tests

```bash
pytest tests/test_niuu/test_tui/ -v
```

### Compile with Nuitka

```bash
pip install nuitka textual
python -m niuu.tui.nuitka_build
# Output: niuu-tui-spike-<os>-<arch> in the current directory
```

## What Was Validated

| Feature | Status | Notes |
|---------|--------|-------|
| App launch from source | Validated | Textual pilot tests confirm startup |
| DataTable rendering | Validated | Rows added dynamically, columns render |
| Text input handling | Validated | `Input.Submitted` fires, value captured |
| Key bindings | Validated | `q` quit, `d` toggle dark, `c` clear |
| Async worker (background) | Validated | `@work` decorator, ticks increment |
| CSS styling (inline) | Validated | Textual CSS string applied to layout |
| Nuitka flag set | Documented | See below |

## Required Nuitka Flags

```
--onefile
--standalone
--follow-imports
--include-package=textual
--include-package-data=textual
--enable-plugin=no-qt
--nofollow-import-to=pytest,_pytest
```

### Flag Rationale

- **`--include-package=textual`**: Textual uses dynamic imports for widgets and
  drivers. Without this flag, Nuitka's static analysis misses them.
- **`--include-package-data=textual`**: Textual ships default `.tcss` stylesheets
  as package data. These must be bundled or the app falls back to unstyled mode.
- **`--enable-plugin=no-qt`**: Suppresses warnings about Qt bindings not being
  found (Textual is terminal-only, Qt is irrelevant).
- **`--nofollow-import-to=pytest,_pytest`**: Exclude test framework from binary
  to reduce size.

## Known Issues / Workarounds

1. **Textual CSS must be inline or bundled**: When using `CSS_PATH` to reference
   an external `.tcss` file, Nuitka `--onefile` extracts to a temp directory and
   the relative path breaks. **Workaround**: use the `CSS` class variable (inline
   string) instead of `CSS_PATH`. This is what the spike app does.

2. **`--include-package-data=textual` is mandatory**: Without it, Textual's
   default theme CSS is missing and widgets render without borders/colors.

3. **Platform matrix**: The spike app is pure Python with no C extensions beyond
   what Textual requires (which is none — Textual is pure Python). Nuitka
   `--onefile` should work on both macOS ARM64 and Linux x86_64 without
   platform-specific flags.

## Architecture Decision

For the production CLI (`niuu`), the recommendation based on this spike:

- Use **inline CSS** (`CSS` class variable) for all Textual apps
- Add `textual` and `nuitka` to the `cli` optional dependency group
- Build binaries per-platform in CI with the flags documented above
- Test with Textual's `pilot` framework before compilation; manual smoke test
  after compilation
