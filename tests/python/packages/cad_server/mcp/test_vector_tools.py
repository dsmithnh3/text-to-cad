"""Vector MCP tools: tools/list exposure and expected-revision mutations."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from cad_mcp.shim import initialize_params
from cad_server.mcp.server import Server
from cad_server.mcp.ui import AppPage
from cad_server.mcp.vector import VECTOR_TOOLS, catalog
from cad_server.viewer.recents import RecentStore
from cad_server.viewer.vector_catalog import VectorCatalogStore
from cad_server.viewer.vector_projects import VectorProjectStore


CODEX = {"name": "codex-mcp-client", "title": "Codex", "version": "0.159.0"}
RENDERS_APPS = {"extensions": {"io.modelcontextprotocol/ui": {"mimeTypes": ["text/html;profile=mcp-app"]}}}


def sample_project(**overrides):
    project = {
        "schema": "cad-vector-studio/v1",
        "name": "MCP assembly",
        "width": 1200,
        "height": 760,
        "assets": [
            {
                "id": "a1",
                "name": "Block",
                "category": "Test",
                "svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
                "provenance": "user-import",
            }
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
            }
        ],
    }
    project.update(overrides)
    return project


class VectorToolsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.state = self.tmp / "state"
        self.state.mkdir()
        env = mock.patch.dict(os.environ, {"CAD_STATE_DIR": str(self.state)})
        env.start()
        self.addCleanup(env.stop)
        page = self.tmp / "app"
        page.mkdir()
        (page / "shell.html").write_text("<!doctype html><title>CAD</title>", encoding="utf-8")
        self.server = Server(
            page=AppPage(page),
            recents=RecentStore(self.state / "recents"),
        )
        self.server.vector_projects  # bind stores under CAD_STATE_DIR
        self.server._vector_projects = VectorProjectStore(self.state / "vector-projects")
        self.server._vector_catalog = VectorCatalogStore(self.state / "vector-catalog")
        self.server.handle(
            "initialize",
            initialize_params({**CODEX, "capabilities": RENDERS_APPS}),
            None,
        )

    def call(self, name: str, arguments: dict | None = None) -> dict:
        return self.server.handle("tools/call", {"name": name, "arguments": arguments or {}}, None)

    def test_tools_list_includes_vector_tools(self) -> None:
        names = [tool["name"] for tool in self.server.handle("tools/list", {}, None)["tools"]]
        for name in VECTOR_TOOLS:
            self.assertIn(name, names)
        listed = {tool["name"]: tool for tool in catalog()}
        update = listed["vector_project_update"]
        self.assertIn("expectedRevision", update["inputSchema"]["required"])
        self.assertNotIn("vector_catalog_update", names)

    def test_create_get_update_with_expected_revision(self) -> None:
        created = self.call("vector_project_create", {"project": sample_project()})
        self.assertFalse(created.get("isError"))
        document = created["structuredContent"]
        self.assertEqual(document["revision"], 1)
        self.assertEqual(document["project"]["name"], "MCP assembly")

        got = self.call("vector_project_get", {"id": document["id"]})
        self.assertEqual(got["structuredContent"]["revision"], 1)

        updated = self.call(
            "vector_project_update",
            {
                "id": document["id"],
                "expectedRevision": 1,
                "project": sample_project(name="Revised"),
            },
        )
        self.assertFalse(updated.get("isError"))
        self.assertEqual(updated["structuredContent"]["revision"], 2)
        self.assertEqual(updated["structuredContent"]["project"]["name"], "Revised")

        stale = self.call(
            "vector_project_update",
            {
                "id": document["id"],
                "expectedRevision": 1,
                "project": sample_project(name="Stale"),
            },
        )
        self.assertTrue(stale.get("isError"))
        self.assertEqual(stale["structuredContent"]["currentRevision"], 2)

    def test_invalid_project_rejected_before_write(self) -> None:
        bad = self.call("vector_project_create", {"project": {"schema": "wrong", "name": "x"}})
        self.assertTrue(bad.get("isError"))
        self.assertEqual(list((self.state / "vector-projects").glob("*")), [])

    def test_catalog_publish_get_list_immutable(self) -> None:
        published = self.call(
            "vector_catalog_publish",
            {
                "component": {
                    "name": "Valve",
                    "category": "Equipment",
                    "svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
                    "provenance": "user-import",
                }
            },
        )
        self.assertFalse(published.get("isError"))
        entry = published["structuredContent"]
        revision_id = entry["revisionId"]

        got = self.call("vector_catalog_get", {"revisionId": revision_id})
        self.assertEqual(got["structuredContent"]["revisionId"], revision_id)

        listed = self.call("vector_catalog_list")
        self.assertEqual(len(listed["structuredContent"]["entries"]), 1)

        # Second publish allocates a new revision id; prior remains readable.
        second = self.call(
            "vector_catalog_publish",
            {
                "componentId": entry["componentId"],
                "component": {
                    "name": "Valve v2",
                    "category": "Equipment",
                    "svg": '<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>',
                    "provenance": "user-import",
                },
            },
        )
        self.assertNotEqual(second["structuredContent"]["revisionId"], revision_id)
        still = self.call("vector_catalog_get", {"revisionId": revision_id})
        self.assertEqual(still["structuredContent"]["component"]["name"], "Valve")


if __name__ == "__main__":
    unittest.main()
