# skill: code-review

Review the staged changes and output a structured review covering correctness, style, and test coverage.

## Output format

Produce a review with the following sections:

### Summary
One paragraph describing what the change does.

### Correctness
List any bugs, edge cases, or logic errors found.
If none: "No correctness issues found."

### Style & conventions
List any violations of the project's code style rules (naming, early returns, no magic numbers, etc.).
If none: "No style issues found."

### Test coverage
List any code paths that are not covered by tests.
If none: "Test coverage looks adequate."

### Suggestions
Optional list of improvements that are not blockers but would improve the code.

## Steps

1. Run `git diff --staged` to see the staged changes.
2. Read each changed file in full to understand context.
3. Produce the structured review above.
4. Do not make any code changes — review only.
