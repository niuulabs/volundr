import os
import sqlite3
import subprocess


def get_user(user_id):
    conn = sqlite3.connect("users.db")
    query = "SELECT * FROM users WHERE id = ?"
    result = conn.execute(query, (user_id,)).fetchone()
    conn.close()
    return result


def run_command(cmd):
    subprocess.call(cmd.split())


API_KEY = os.environ.get("API_KEY")


def process():
    try:
        return get_user(1)
    except Exception as e:
        print(f"Error occurred: {e}")
        raise
