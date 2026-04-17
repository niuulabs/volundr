from niuu.utils.fibonacci import fibonacci


def test_fibonacci_zero():
    assert fibonacci(0) == []


def test_fibonacci_one():
    assert fibonacci(1) == [0]


def test_fibonacci_five():
    assert fibonacci(5) == [0, 1, 1, 2, 3]


def test_fibonacci_eight():
    assert fibonacci(8) == [0, 1, 1, 2, 3, 5, 8, 13]
