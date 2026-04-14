#!/usr/bin/env python3
"""A hello world script with some bugs."""

import sqlite3


def hello(name: str) -> str:
    # Fix 1: SQL injection vulnerability - use parameterized queries
    conn = sqlite3.connect(":memory:")  # Using in-memory DB for demo
    cursor = conn.cursor()

    # Create table for demonstration
    cursor.execute("""CREATE TABLE IF NOT EXISTS users
                     (id INTEGER PRIMARY KEY, name TEXT)""")

    # Use parameterized query to prevent SQL injection
    query = "SELECT * FROM users WHERE name = ?"
    cursor.execute(query, (name,))
    _ = cursor.fetchall()  # noqa: F841

    print(f"Query: {query} with params: ({name},)")

    # Fix 2: Input validation
    if not isinstance(name, str):
        raise TypeError("Name must be a string")

    if not name.strip():
        raise ValueError("Name cannot be empty")

    greeting = f"Hello, {name}"

    # Fix 3: Don't hardcode secrets in production code
    # API_KEY = "sk-secret-12345-do-not-commit"  # Removed hardcoded secret

    # Fix 4: Specific exception handling instead of bare except
    try:
        _ = int(name)  # noqa: F841
    except ValueError as e:
        # Handle the specific case when conversion fails
        _ = 0  # noqa: F841
        print(f"Could not convert '{name}' to integer: {e}")

    conn.close()
    return greeting


def main():
    # Fix 5: Command injection via os.system - avoid direct string concatenation
    user_input = input("Enter name: ")

    # Instead of: os.system("echo " + user_input)
    # We can simply print the input directly
    print(f"User entered: {user_input}")

    print(hello(user_input))


if __name__ == "__main__":
    main()
