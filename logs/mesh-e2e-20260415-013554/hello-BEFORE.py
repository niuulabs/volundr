import sqlite3
import subprocess


def get_user(user_id):
    conn = sqlite3.connect("users.db")
    query = f"SELECT * FROM users WHERE id = {user_id}"  # SQL injection
    return conn.execute(query).fetchone()


def run_command(cmd):
    subprocess.call(cmd, shell=True)  # Command injection


API_KEY = "sk-secret-12345"  # Hardcoded secret


def process():
    try:
        return get_user(1)
    except:  # noqa: E722 - Intentional bare except to demonstrate bug
        pass
