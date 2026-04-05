# skill: write-docs

Generate docstrings for all undocumented public functions and classes in the target module.

## Steps

1. Identify the target module or file (from the task description or current context).
2. List all public functions and classes that lack docstrings.
3. For each undocumented symbol:
   a. Read the function or class body carefully.
   b. Write a concise, accurate docstring that describes:
      - What the function/class does.
      - Its parameters and return value (for functions).
      - Any exceptions it may raise.
   c. Apply the docstring using a file edit.
4. Run the linter to confirm no formatting issues were introduced.
5. Do not modify any logic — documentation only.
