import subprocess
from pathlib import Path


def test_demo_utils_exits_zero():
    repo_root = Path(__file__).parent.parent
    result = subprocess.run(
        ["python", "scripts/demo_utils.py"],
        cwd=repo_root,
    )
    assert result.returncode == 0
