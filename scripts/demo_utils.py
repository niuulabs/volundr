"""Demo script that exercises the Phase 1 utilities."""

from niuu.phase1_utils import fibonacci, greeting, reverse


def main() -> None:
    print(greeting("Niuu"))
    print(f"Reversed: {reverse('Niuu')}")
    print(f"Fibonacci(7): {fibonacci(7)}")


if __name__ == "__main__":
    main()
