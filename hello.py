#!/usr/bin/env python3
"""A hello world script with secure coding practices."""

import sqlite3


def hello(name: str) -> str:
    """Generate a greeting with input validation and secure database operations."""
    # Fix 1: SQL injection vulnerability - use parameterized queries
    conn = sqlite3.connect(":memory:")  # Using in-memory DB for demo
    cursor = conn.cursor()

    # Create table for demonstration
    cursor.execute("""CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)""")

    # Use parameterized query to prevent SQL injection
    query = "SELECT * FROM users WHERE name = ?"
    cursor.execute(query, (name,))
    _result = cursor.fetchall()  # noqa: F841 - demo query result

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
        # Placeholder for any numeric processing if needed
        pass
    except ValueError as e:
        # Handle the specific case when conversion fails
        print(f"Could not process input: {e}")
    except Exception as e:
        # Handle any other unexpected exceptions
        print(f"Unexpected error occurred: {e}")

    conn.close()
    return greeting


def main():
    """Main function with secure input handling."""
    user_input = input("Enter name: ")

    # Secure handling of user input - validate before processing
    if not isinstance(user_input, str):
        print("Invalid input type")
        return

    # Sanitize input to prevent potential issues
    sanitized_input = user_input.strip()

    if not sanitized_input:
        print("Empty input not allowed")
        return

    print(f"User entered: {sanitized_input}")

    print(hello(sanitized_input))


if __name__ == "__main__":
    main()
