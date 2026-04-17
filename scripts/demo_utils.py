import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from niuu.utils.fibonacci import fibonacci  # noqa: E402
from niuu.utils.greeting import greet  # noqa: E402
from niuu.utils.reverse import reverse_string  # noqa: E402

print(greet("Niuu"))
print(f"Reversed: {reverse_string('Niuu')}")
print(f"Fibonacci(7): {fibonacci(7)}")
