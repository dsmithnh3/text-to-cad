"""Durable Vector Studio UUID/revision store: create/get/update and reject-before-write."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from cad_server.viewer.vector_projects import (
    VectorProjectInvalid,
    VectorProjectNotFound,
    VectorProjectStaleRevision,
    VectorProjectStore,
)
from .test_http_layer import ServerFixture


def sample_project(**overrides):
    project = {
        "schema": "cad-vector-studio/v1",
        "name": "Store assembly",
        "width": 1200,
        "height": 760,
        "assets": [
            {
                "id": "a1",
                "name": "Block",
                "category": "Test",
                "svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
                "provenance": "user-import",
            },
        ],
        "items": [
            {
                "id": "i1",
                "assetId": "a1",
                "name": "Block",
                "x": 10,
                "y": 20,
                "w": 100,
                "h": 80,
                "rotate": 0,
                "opacity": 1,
                "hidden": False,
                "locked": False,
            },
        ],
    }
    project.update(overrides)
    return project


class VectorProjectStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = VectorProjectStore(Path(self.tmp.name) / "vector-projects")

    def test_create_get_round_trip(self) -> None:
        created = self.store.create(sample_project())
        self.assertEqual(created["revision"], 1)
        self.assertEqual(created["project"]["name"], "Store assembly")
        loaded = self.store.get(created["id"])
        self.assertEqual(loaded, created)
        on_disk = json.loads(
            (Path(self.tmp.name) / "vector-projects" / created["id"] / "document.json").read_text(
                encoding="utf-8",
            ),
        )
        self.assertEqual(on_disk["id"], created["id"])
        self.assertEqual(on_disk["revision"], 1)

    def test_update_advances_revision_when_expected_matches(self) -> None:
        created = self.store.create(sample_project())
        updated = self.store.update(
            created["id"],
            created["revision"],
            sample_project(name="Renamed"),
        )
        self.assertEqual(updated["revision"], 2)
        self.assertEqual(updated["project"]["name"], "Renamed")
        self.assertEqual(self.store.get(created["id"])["revision"], 2)

    def test_stale_revision_rejected_without_write(self) -> None:
        created = self.store.create(sample_project())
        self.store.update(created["id"], 1, sample_project(name="First"))
        path = Path(self.tmp.name) / "vector-projects" / created["id"] / "document.json"
        before = path.read_bytes()
        with self.assertRaises(VectorProjectStaleRevision) as raised:
            self.store.update(created["id"], 1, sample_project(name="Stale"))
        self.assertEqual(raised.exception.expected, 1)
        self.assertEqual(raised.exception.current, 2)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(self.store.get(created["id"])["project"]["name"], "First")

    def test_invalid_project_rejected_before_write(self) -> None:
        root = Path(self.tmp.name) / "vector-projects"
        with self.assertRaises(VectorProjectInvalid):
            self.store.create({"schema": "wrong", "name": "x"})
        self.assertFalse(root.exists())

        created = self.store.create(sample_project())
        path = root / created["id"] / "document.json"
        before = path.read_bytes()
        with self.assertRaises(VectorProjectInvalid):
            self.store.update(created["id"], 1, sample_project(width=float("nan")))
        self.assertEqual(path.read_bytes(), before)

    def test_get_missing_raises(self) -> None:
        with self.assertRaises(VectorProjectNotFound):
            self.store.get("00000000-0000-4000-8000-000000000000")


class VectorProjectRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.server = ServerFixture()
        self.addCleanup(self.server.close)
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.root, ignore_errors=True))
        self.server.app.vector_projects = VectorProjectStore(self.root / "vector-projects")

    def _json(self, method, path, payload=None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"x-cad-viewer": "1", "Content-Type": "application/json"} if method != "GET" else {}
        status, _headers, raw = self.server.request(method, path, headers=headers, body=body)
        return status, json.loads(raw.decode("utf-8")) if raw else None

    def test_http_create_get_update_and_stale(self) -> None:
        status, created = self._json("POST", "/api/v1/vector/projects", {"project": sample_project()})
        self.assertEqual(status, 201)
        self.assertEqual(created["revision"], 1)

        status, loaded = self._json("GET", f"/api/v1/vector/projects/{created['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(loaded["id"], created["id"])

        status, updated = self._json(
            "PUT",
            f"/api/v1/vector/projects/{created['id']}",
            {"expectedRevision": 1, "project": sample_project(name="Via HTTP")},
        )
        self.assertEqual(status, 200)
        self.assertEqual(updated["revision"], 2)
        self.assertEqual(updated["project"]["name"], "Via HTTP")

        status, stale = self._json(
            "PUT",
            f"/api/v1/vector/projects/{created['id']}",
            {"expectedRevision": 1, "project": sample_project(name="Stale")},
        )
        self.assertEqual(status, 409)
        self.assertEqual(stale["currentRevision"], 2)

    def test_http_rejects_invalid_before_write(self) -> None:
        status, body = self._json(
            "POST",
            "/api/v1/vector/projects",
            {"project": {"schema": "nope", "name": "x", "width": 1, "height": 1, "assets": [], "items": []}},
        )
        self.assertEqual(status, 400)
        self.assertIn("schema", body["error"].lower())
        self.assertFalse((self.root / "vector-projects").exists())


if __name__ == "__main__":
    unittest.main()
