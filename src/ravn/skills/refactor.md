# skill: refactor

Identify code smells in the target module and refactor with all tests passing.

## Code smells to look for

- Functions longer than 50 lines
- Deeply nested conditionals (more than 2 levels)
- Magic numbers or hardcoded strings
- Duplicated logic that could be extracted into a helper
- Missing type annotations on public functions
- Violations of the single-responsibility principle

## Steps

1. Identify the target module (from the task description or current context).
2. Read the module in full.
3. List all code smells found with their line numbers.
4. For each smell:
   a. Apply the minimal refactor needed to fix it.
   b. Run the test suite to confirm nothing is broken.
   c. If tests break, revert and note the smell as "needs manual attention".
5. After all refactors, run the full test suite once more.
6. Commit with `refactor(<scope>): <what was improved>`.
7. Do not change observable behaviour — refactor only.
