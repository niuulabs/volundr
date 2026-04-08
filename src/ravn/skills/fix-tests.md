# skill: fix-tests

Run the test suite, identify all failing tests, and fix them one by one.
After each fix, re-run only the affected test to confirm it passes.
Commit each fix separately with a descriptive message.
Do not fix more than 5 tests in a single session.

## Steps

1. Run the full test suite and capture all failures.
2. For each failing test (up to 5):
   a. Read the test and the code under test.
   b. Identify the root cause of the failure.
   c. Apply the minimal fix needed to make the test pass.
   d. Re-run only that test to confirm it passes.
   e. Commit the fix with a message like `fix(<scope>): <what was broken>`.
3. After all fixes are committed, run the full test suite once more to confirm no regressions.
