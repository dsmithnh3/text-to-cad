"""Immutable CAD projection asset revisions and HTTP export path."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from cad.cad_projection import KIND, project_shape_to_svg
from cad_server.viewer.vector_projections import (
    VectorProjectionImmutable,
    VectorProjectionInvalid,
    VectorProjectionNotFound,
    VectorProjectionStore,
)
from .test_http_layer import ServerFixture


def _box():
    from build123d import Align, Box

    return Box(40, 30, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))


def sample_payload(**overrides):
    export = project_shape_to_svg(_box(), "front", source_path="/tmp/box.step")
    payload = {
        "name": "Box · front",
        "svg": export.svg,
        "projection": export.provenance,
    }
    payload.update(overrides)
    return payload


class VectorProjectionStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = VectorProjectionStore(Path(self.tmp.name) / "vector-projections")

    def test_publish_then_get_by_revision_id(self) -> None:
        published = self.store.publish(sample_payload())
        self.assertEqual(published["revision"], 1)
        self.assertEqual(published["asset"]["provenance"], "source-derived")
        self.assertEqual(published["asset"]["category"], "CAD projection")
        self.assertEqual(published["projection"]["kind"], KIND)
        self.assertEqual(published["projection"]["view"], "front")
        self.assertEqual(published["asset"]["id"], published["revisionId"])
        loaded = self.store.get(published["revisionId"])
        self.assertEqual(loaded, published)

    def test_publish_export_helper_and_new_revision_leaves_prior_immutable(self) -> None:
        export = project_shape_to_svg(_box(), "iso", source_path="/tmp/box.step")
        first = self.store.publish_export(export, name="Box · iso")
        path = (
            Path(self.tmp.name)
            / "vector-projections"
            / first["revisionId"]
            / "revision.json"
        )
        before = path.read_bytes()
        second = self.store.publish_export(
            project_shape_to_svg(_box(), "front", source_path="/tmp/box.step"),
            name="Box · front",
            asset_id=first["assetId"],
        )
        self.assertEqual(second["assetId"], first["assetId"])
        self.assertEqual(second["revision"], 2)
        self.assertNotEqual(second["revisionId"], first["revisionId"])
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(self.store.get(first["revisionId"])["projection"]["view"], "iso")
        self.assertEqual(self.store.get(second["revisionId"])["projection"]["view"], "front")

    def test_overwrite_of_published_revision_rejected(self) -> None:
        published = self.store.publish(sample_payload())
        path = (
            Path(self.tmp.name)
            / "vector-projections"
            / published["revisionId"]
            / "revision.json"
        )
        before = path.read_bytes()
        with self.assertRaises(VectorProjectionImmutable):
            self.store._write_unlocked(
                published["revisionId"],
                {**published, "asset": {**published["asset"], "name": "Mutated"}},
            )
        self.assertEqual(path.read_bytes(), before)

    def test_illustrative_provenance_rejected_before_write(self) -> None:
        root = Path(self.tmp.name) / "vector-projections"
        with self.assertRaises(VectorProjectionInvalid):
            self.store.publish(
                {
                    "name": "mesh",
                    "svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
                    "projection": {
                        "kind": "illustrative-mesh",
                        "backend": "hlr-occt",
                        "view": "iso",
                        "viewClass": "isometric",
                        "hiddenLines": True,
                        "source": {"path": "/tmp/a.glb"},
                    },
                },
            )
        self.assertFalse(root.exists())

    def test_get_missing_raises(self) -> None:
        with self.assertRaises(VectorProjectionNotFound):
            self.store.get("00000000-0000-4000-8000-000000000000")


class VectorProjectionRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.server = ServerFixture()
        self.addCleanup(self.server.close)
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.root, ignore_errors=True))
        self.server.app.vector_projections = VectorProjectionStore(self.root / "vector-projections")

    def _json(self, method, path, payload=None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"x-cad-viewer": "1", "Content-Type": "application/json"} if method != "GET" else {}
        status, _headers, raw = self.server.request(method, path, headers=headers, body=body)
        return status, json.loads(raw.decode("utf-8")) if raw else None

    def test_http_publish_get_list_and_reject_mutation(self) -> None:
        status, published = self._json(
            "POST",
            "/api/v1/vector/projections",
            {"export": sample_payload()},
        )
        self.assertEqual(status, 201)
        self.assertEqual(published["revision"], 1)
        self.assertEqual(published["projection"]["viewClass"], "orthographic")
        revision_id = published["revisionId"]

        status, loaded = self._json("GET", f"/api/v1/vector/projections/{revision_id}")
        self.assertEqual(status, 200)
        self.assertEqual(loaded["revisionId"], revision_id)

        status, listed = self._json("GET", "/api/v1/vector/projections")
        self.assertEqual(status, 200)
        self.assertEqual(len(listed["entries"]), 1)

        status, mutated = self._json(
            "PUT",
            f"/api/v1/vector/projections/{revision_id}",
            {"export": sample_payload(name="nope")},
        )
        self.assertEqual(status, 405)

    def test_http_rejects_invalid_before_write(self) -> None:
        status, body = self._json(
            "POST",
            "/api/v1/vector/projections",
            {
                "export": {
                    "name": "x",
                    "svg": "<svg/>",
                    "projection": {
                        "kind": "illustrative-mesh",
                        "backend": "hlr-occt",
                        "view": "iso",
                        "viewClass": "isometric",
                        "hiddenLines": True,
                        "source": {"path": "/tmp/a.glb"},
                    },
                },
            },
        )
        self.assertEqual(status, 400)
        self.assertIn("illustrative", body["error"].lower())
        self.assertFalse((self.root / "vector-projections").exists())


if __name__ == "__main__":
    unittest.main()
