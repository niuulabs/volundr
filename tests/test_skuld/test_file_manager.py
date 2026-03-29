"""Tests for the Skuld broker file manager endpoints (download, upload, mkdir, delete)."""

import io

import pytest
from fastapi.testclient import TestClient

from skuld.broker import app, broker


class TestFileDownloadEndpoint:
    """Tests for GET /api/files/download."""

    @pytest.fixture(autouse=True)
    def _setup_workspace(self, tmp_path):
        self._original_workspace = broker.workspace_dir
        broker.workspace_dir = str(tmp_path)
        self._original_home = broker._settings.home_path
        broker._settings.__dict__["_home_override"] = str(tmp_path / "home")
        (tmp_path / "home").mkdir()
        self.workspace = tmp_path
        self.client = TestClient(app, raise_server_exceptions=False)
        yield
        broker.workspace_dir = self._original_workspace

    def test_download_existing_file(self):
        (self.workspace / "test.txt").write_text("hello world")
        response = self.client.get("/api/files/download", params={"path": "test.txt"})
        assert response.status_code == 200
        assert response.content == b"hello world"

    def test_download_nonexistent_file(self):
        response = self.client.get("/api/files/download", params={"path": "missing.txt"})
        assert response.status_code == 404

    def test_download_directory_returns_404(self):
        (self.workspace / "dir").mkdir()
        response = self.client.get("/api/files/download", params={"path": "dir"})
        assert response.status_code == 404

    def test_download_path_traversal_blocked(self):
        response = self.client.get("/api/files/download", params={"path": "../../../etc/passwd"})
        assert response.status_code == 400
        assert "Path traversal" in response.json()["detail"]

    def test_download_invalid_root(self):
        response = self.client.get(
            "/api/files/download", params={"path": "test.txt", "root": "invalid"}
        )
        assert response.status_code == 400
        assert "root must be" in response.json()["detail"]


class TestFileUploadEndpoint:
    """Tests for POST /api/files/upload."""

    @pytest.fixture(autouse=True)
    def _setup_workspace(self, tmp_path):
        self._original_workspace = broker.workspace_dir
        broker.workspace_dir = str(tmp_path)
        self.workspace = tmp_path
        self.client = TestClient(app, raise_server_exceptions=False)
        yield
        broker.workspace_dir = self._original_workspace

    def test_upload_single_file(self):
        response = self.client.post(
            "/api/files/upload",
            files=[("files", ("test.txt", io.BytesIO(b"hello"), "text/plain"))],
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["entries"]) == 1
        assert data["entries"][0]["name"] == "test.txt"
        assert (self.workspace / "test.txt").read_text() == "hello"

    def test_upload_multiple_files(self):
        response = self.client.post(
            "/api/files/upload",
            files=[
                ("files", ("a.txt", io.BytesIO(b"aaa"), "text/plain")),
                ("files", ("b.txt", io.BytesIO(b"bbb"), "text/plain")),
            ],
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["entries"]) == 2

    def test_upload_to_subdirectory(self):
        subdir = self.workspace / "sub"
        subdir.mkdir()
        response = self.client.post(
            "/api/files/upload",
            params={"path": "sub"},
            files=[("files", ("test.txt", io.BytesIO(b"data"), "text/plain"))],
        )
        assert response.status_code == 200
        assert (subdir / "test.txt").read_bytes() == b"data"

    def test_upload_to_nonexistent_directory(self):
        response = self.client.post(
            "/api/files/upload",
            params={"path": "nonexistent"},
            files=[("files", ("test.txt", io.BytesIO(b"data"), "text/plain"))],
        )
        assert response.status_code == 404

    def test_upload_path_traversal_in_filename(self):
        response = self.client.post(
            "/api/files/upload",
            files=[("files", ("../../evil.txt", io.BytesIO(b"bad"), "text/plain"))],
        )
        assert response.status_code == 200
        # File should be written with just the filename, not the traversal path
        assert (self.workspace / "evil.txt").exists()

    def test_upload_invalid_root(self):
        response = self.client.post(
            "/api/files/upload",
            params={"root": "invalid"},
            files=[("files", ("test.txt", io.BytesIO(b"data"), "text/plain"))],
        )
        assert response.status_code == 400


class TestMkdirEndpoint:
    """Tests for POST /api/files/mkdir."""

    @pytest.fixture(autouse=True)
    def _setup_workspace(self, tmp_path):
        self._original_workspace = broker.workspace_dir
        broker.workspace_dir = str(tmp_path)
        self.workspace = tmp_path
        self.client = TestClient(app, raise_server_exceptions=False)
        yield
        broker.workspace_dir = self._original_workspace

    def test_create_directory(self):
        response = self.client.post(
            "/api/files/mkdir",
            json={"path": "new-dir"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "new-dir"
        assert data["type"] == "directory"
        assert (self.workspace / "new-dir").is_dir()

    def test_create_nested_directory(self):
        response = self.client.post(
            "/api/files/mkdir",
            json={"path": "a/b/c"},
        )
        assert response.status_code == 200
        assert (self.workspace / "a" / "b" / "c").is_dir()

    def test_create_existing_directory_returns_409(self):
        (self.workspace / "existing").mkdir()
        response = self.client.post(
            "/api/files/mkdir",
            json={"path": "existing"},
        )
        assert response.status_code == 409

    def test_mkdir_path_traversal_blocked(self):
        response = self.client.post(
            "/api/files/mkdir",
            json={"path": "../../../evil"},
        )
        assert response.status_code == 400

    def test_mkdir_invalid_root(self):
        response = self.client.post(
            "/api/files/mkdir",
            json={"path": "dir", "root": "invalid"},
        )
        assert response.status_code == 400


class TestDeleteEndpoint:
    """Tests for DELETE /api/files."""

    @pytest.fixture(autouse=True)
    def _setup_workspace(self, tmp_path):
        self._original_workspace = broker.workspace_dir
        broker.workspace_dir = str(tmp_path)
        self.workspace = tmp_path
        self.client = TestClient(app, raise_server_exceptions=False)
        yield
        broker.workspace_dir = self._original_workspace

    def test_delete_file(self):
        (self.workspace / "test.txt").write_text("bye")
        response = self.client.delete("/api/files", params={"path": "test.txt"})
        assert response.status_code == 200
        assert not (self.workspace / "test.txt").exists()

    def test_delete_directory(self):
        d = self.workspace / "dir"
        d.mkdir()
        (d / "inner.txt").touch()
        response = self.client.delete("/api/files", params={"path": "dir"})
        assert response.status_code == 200
        assert not d.exists()

    def test_delete_nonexistent_returns_404(self):
        response = self.client.delete("/api/files", params={"path": "missing"})
        assert response.status_code == 404

    def test_delete_root_blocked(self):
        response = self.client.delete("/api/files", params={"path": ""})
        assert response.status_code == 400

    def test_delete_path_traversal_blocked(self):
        response = self.client.delete("/api/files", params={"path": "../../../etc/passwd"})
        assert response.status_code == 400

    def test_delete_invalid_root(self):
        response = self.client.delete("/api/files", params={"path": "test.txt", "root": "invalid"})
        assert response.status_code == 400


class TestFileListingWithRoot:
    """Tests for GET /api/files with root parameter."""

    @pytest.fixture(autouse=True)
    def _setup_workspace(self, tmp_path):
        self._original_workspace = broker.workspace_dir
        broker.workspace_dir = str(tmp_path / "workspace")
        (tmp_path / "workspace").mkdir()
        self.workspace = tmp_path / "workspace"
        self.client = TestClient(app, raise_server_exceptions=False)
        yield
        broker.workspace_dir = self._original_workspace

    def test_list_with_workspace_root(self):
        (self.workspace / "file.txt").touch()
        response = self.client.get("/api/files", params={"root": "workspace"})
        assert response.status_code == 200
        names = [e["name"] for e in response.json()["entries"]]
        assert "file.txt" in names

    def test_list_invalid_root(self):
        response = self.client.get("/api/files", params={"root": "invalid"})
        assert response.status_code == 400

    def test_entries_include_size_and_modified(self):
        (self.workspace / "test.txt").write_text("content")
        response = self.client.get("/api/files")
        assert response.status_code == 200
        entry = response.json()["entries"][0]
        assert "size" in entry
        assert "modified" in entry
        assert entry["size"] == 7  # len("content")
