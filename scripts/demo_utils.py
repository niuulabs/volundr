import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from niuu.utils.greeting import greet
from niuu.utils.reverse import reverse_string
from niuu.utils.fibonacci import fibonacci

print(greet("Niuu"))
print(f"Reversed: {reverse_string('Niuu')}")
print(f"Fibonacci(7): {fibonacci(7)}")
