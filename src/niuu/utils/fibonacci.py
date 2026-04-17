def fibonacci(n: int) -> list[int]:
    if n == 0:
        return []
    result = [0]
    if n == 1:
        return result
    result.append(1)
    for _ in range(2, n):
        result.append(result[-1] + result[-2])
    return result
