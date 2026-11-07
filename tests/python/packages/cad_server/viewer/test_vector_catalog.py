"""Immutable Vector component catalog: publish once, look up by revision id."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from cad_server.viewer.vector_catalog import (
    VectorCatalogImmutable,
    VectorCatalogInvalid,
    VectorCatalogNotFound,
    VectorCatalogStore,
)
from .test_http_layer import ServerFixture


def sample_component(**overrides):
    component = {
        "name": "Pump block",
        "category": "Equipment",
        "svg": '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
        "provenance": "user-import",
    }
    component.update(overrides)
    return component


class VectorCatalogStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = VectorCatalogStore(Path(self.tmp.name) / "vector-catalog")

    def test_publish_then_get_by_revision_id(self) -> None:
        published = self.store.publish(sample_component())
        self.assertEqual(published["revision"], 1)
        self.assertEqual(published["component"]["name"], "Pump block")
        self.assertEqual(published["component"]["id"], published["revisionId"])
        loaded = self.store.get(published["revisionId"])
        self.assertEqual(loaded, published)
        on_disk = json.loads(
            (
                Path(self.tmp.name)
                / "vector-catalog"
                / published["revisionId"]
                / "revision.json"
            ).read_text(encoding="utf-8"),
        )
        self.assertEqual(on_disk["revisionId"], published["revisionId"])
        self.assertEqual(on_disk["revision"], 1)

    def test_publish_new_revision_leaves_prior_immutable(self) -> None:
        first = self.store.publish(sample_component())
        path = (
            Path(self.tmp.name) / "vector-catalog" / first["revisionId"] / "revision.json"
        )
        before = path.read_bytes()
        second = self.store.publish(
            sample_component(name="Pump block v2", svg='<svg xmlns="http://www.w3.org/2000/svg"/>'),
            component_id=first["componentId"],
        )
        self.assertEqual(second["componentId"], first["componentId"])
        self.assertEqual(second["revision"], 2)
        self.assertNotEqual(second["revisionId"], first["revisionId"])
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(self.store.get(first["revisionId"])["component"]["name"], "Pump block")
        self.assertEqual(self.store.get(second["revisionId"])["component"]["name"], "Pump block v2")

    def test_overwrite_of_published_revision_rejected(self) -> None:
        published = self.store.publish(sample_component())
        path = (
            Path(self.tmp.name) / "vector-catalog" / published["revisionId"] / "revision.json"
        )
        before = path.read_bytes()
        with self.assertRaises(VectorCatalogImmutable):
            self.store._write_unlocked(  # intentional: prove the write guard
                published["revisionId"],
                {**published, "component": sample_component(name="Mutated")},
            )
        self.assertEqual(path.read_bytes(), before)

    def test_invalid_component_rejected_before_write(self) -> None:
        root = Path(self.tmp.name) / "vector-catalog"
        with self.assertRaises(VectorCatalogInvalid):
            self.store.publish({"name": "x", "category": "y", "svg": 1, "provenance": "user-import"})
        self.assertFalse(root.exists())

        with self.assertRaises(VectorCatalogInvalid):
            self.store.publish(sample_component(provenance="fabricated"))
        self.assertFalse(root.exists())

    def test_get_missing_raises(self) -> None:
        with self.assertRaises(VectorCatalogNotFound):
            self.store.get("00000000-0000-4000-8000-000000000000")

    def test_list_returns_published_revisions(self) -> None:
        first = self.store.publish(sample_component(name="A"))
        second = self.store.publish(sample_component(name="B"))
        listed = self.store.list()
        ids = {entry["revisionId"] for entry in listed}
        self.assertEqual(ids, {first["revisionId"], second["revisionId"]})


class VectorCatalogRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.server = ServerFixture()
        self.addCleanup(self.server.close)
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.root, ignore_errors=True))
        self.server.app.vector_catalog = VectorCatalogStore(self.root / "vector-catalog")

    def _json(self, method, path, payload=None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"x-cad-viewer": "1", "Content-Type": "application/json"} if method != "GET" else {}
        status, _headers, raw = self.server.request(method, path, headers=headers, body=body)
        return status, json.loads(raw.decode("utf-8")) if raw else None

    def test_http_publish_get_list_and_reject_mutation(self) -> None:
        status, published = self._json(
            "POST",
            "/api/v1/vector/catalog",
            {"component": sample_component()},
        )
        self.assertEqual(status, 201)
        self.assertEqual(published["revision"], 1)
        revision_id = published["revisionId"]

        status, loaded = self._json("GET", f"/api/v1/vector/catalog/{revision_id}")
        self.assertEqual(status, 200)
        self.assertEqual(loaded["revisionId"], revision_id)
        self.assertEqual(loaded["component"]["id"], revision_id)

        status, listed = self._json("GET", "/api/v1/vector/catalog")
        self.assertEqual(status, 200)
        self.assertEqual(len(listed["entries"]), 1)
        self.assertEqual(listed["entries"][0]["revisionId"], revision_id)

        status, second = self._json(
            "POST",
            "/api/v1/vector/catalog",
            {"componentId": published["componentId"], "component": sample_component(name="v2")},
        )
        self.assertEqual(status, 201)
        self.assertEqual(second["revision"], 2)

        status, mutated = self._json(
            "PUT",
            f"/api/v1/vector/catalog/{revision_id}",
            {"component": sample_component(name="nope")},
        )
        self.assertEqual(status, 405)
        path = self.root / "vector-catalog" / revision_id / "revision.json"
        self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["component"]["name"], "Pump block")

    def test_http_rejects_invalid_before_write(self) -> None:
        status, body = self._json(
            "POST",
            "/api/v1/vector/catalog",
            {"component": sample_component(provenance="nope")},
        )
        self.assertEqual(status, 400)
        self.assertIn("provenance", body["error"].lower())
        self.assertFalse((self.root / "vector-catalog").exists())


if __name__ == "__main__":
    unittest.main()
