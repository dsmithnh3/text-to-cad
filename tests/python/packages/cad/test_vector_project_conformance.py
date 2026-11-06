"""Python ``parse_vector_project`` must accept and reject the same cases as
``@cad/core``'s ``vectorProject.js``.

The language-neutral fixture ``packages/core/src/lib/vectorProject.conformance.json``
is the authority (budgets, validProjects, invalidProjects, budgetCases). The TypeScript
suite asserts the same file; this suite keeps the two parsers from drifting.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path
from typing import Any

from cad.vector_project import (
    MAX_AGGREGATE_SVG_BYTES,
    MAX_ASSET_COUNT,
    MAX_DIMENSION,
    MAX_ITEM_COUNT,
    MAX_PROJECT_BYTES,
    VectorProjectError,
    parse_vector_project,
)

# The viewer's / @cad/core fixture (read, never imported: the library stands alone).
CONFORMANCE = (
    Path(__file__).resolve().parents[4]
    / "packages/core/src/lib/vectorProject.conformance.json"
)


def _encode(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _base_project(fixture: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    minimal = next(entry["project"] for entry in fixture["validProjects"] if entry["id"] == "minimal")
    project = {
        **minimal,
        "assets": [dict(asset) for asset in minimal["assets"]],
        "items": [dict(item) for item in minimal["items"]],
    }
    project.update(overrides)
    return project


def _build_budget_case(fixture: dict[str, Any], build: str) -> str:
    tiny_svg = fixture["tinySvg"]
    if build == "exact_counts_and_dimensions":
        assets = [
            {
                "id": f"a{index}",
                "name": f"A{index}",
                "category": "Test",
                "svg": tiny_svg,
                "provenance": "user-import",
            }
            for index in range(MAX_ASSET_COUNT)
        ]
        items = [
            {
                "id": f"i{index}",
                "assetId": assets[index % len(assets)]["id"],
                "name": f"I{index}",
                "x": 0,
                "y": 0,
                "w": MAX_DIMENSION,
                "h": MAX_DIMENSION,
                "rotate": 0,
                "opacity": 1,
                "hidden": False,
                "locked": False,
            }
            for index in range(MAX_ITEM_COUNT)
        ]
        return _encode(_base_project(
            fixture,
            width=MAX_DIMENSION,
            height=MAX_DIMENSION,
            assets=assets,
            items=items,
        ))
    if build == "over_project_bytes":
        padding = "x" * MAX_PROJECT_BYTES
        return _encode(_base_project(fixture, name=padding))
    if build == "one_past_asset_count":
        assets = [
            {
                "id": f"a{index}",
                "name": f"A{index}",
                "category": "Test",
                "svg": tiny_svg,
                "provenance": "user-import",
            }
            for index in range(MAX_ASSET_COUNT + 1)
        ]
        return _encode(_base_project(fixture, assets=assets, items=[]))
    if build == "one_past_item_count":
        items = [
            {
                "id": f"i{index}",
                "assetId": "a1",
                "name": f"I{index}",
                "x": 0,
                "y": 0,
                "w": 1,
                "h": 1,
                "rotate": 0,
                "opacity": 1,
                "hidden": False,
                "locked": False,
            }
            for index in range(MAX_ITEM_COUNT + 1)
        ]
        return _encode(_base_project(fixture, items=items))
    if build == "one_past_aggregate_svg_bytes":
        chunk = "a" * 1_000_000
        assets: list[dict[str, Any]] = []
        total = 0
        while total + len(chunk) <= MAX_AGGREGATE_SVG_BYTES:
            assets.append({
                "id": f"a{len(assets)}",
                "name": f"A{len(assets)}",
                "category": "Test",
                "svg": chunk,
                "provenance": "user-import",
            })
            total += len(chunk)
        remainder = MAX_AGGREGATE_SVG_BYTES - total + 1
        assets.append({
            "id": f"a{len(assets)}",
            "name": "overflow",
            "category": "Test",
            "svg": "b" * remainder,
            "provenance": "user-import",
        })
        return _encode(_base_project(fixture, assets=assets, items=[]))
    raise AssertionError(f"Unknown budget build: {build}")


class VectorProjectConformanceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = json.loads(CONFORMANCE.read_text(encoding="utf-8"))

    def test_exported_budgets_match_the_shared_conformance_fixture(self) -> None:
        self.assertEqual(
            {
                "MAX_PROJECT_BYTES": MAX_PROJECT_BYTES,
                "MAX_ASSET_COUNT": MAX_ASSET_COUNT,
                "MAX_ITEM_COUNT": MAX_ITEM_COUNT,
                "MAX_AGGREGATE_SVG_BYTES": MAX_AGGREGATE_SVG_BYTES,
                "MAX_DIMENSION": MAX_DIMENSION,
            },
            self.fixture["budgets"],
        )
        self.assertEqual(self.fixture["schemaId"], "cad-vector-studio/v1")

    def test_accepts_every_valid_projects_fixture_case(self) -> None:
        self.assertGreaterEqual(len(self.fixture["validProjects"]), 2)
        for entry in self.fixture["validProjects"]:
            with self.subTest(id=entry["id"], why=entry["why"]):
                parsed = parse_vector_project(_encode(entry["project"]))
                self.assertEqual(parsed["schema"], self.fixture["schemaId"])
                self.assertEqual(parsed["name"], entry["project"]["name"])
                self.assertEqual(len(parsed["assets"]), len(entry["project"]["assets"]))
                self.assertEqual(len(parsed["items"]), len(entry["project"]["items"]))

    def test_rejects_every_invalid_projects_fixture_case(self) -> None:
        self.assertGreaterEqual(len(self.fixture["invalidProjects"]), 5)
        for entry in self.fixture["invalidProjects"]:
            with self.subTest(id=entry["id"], why=entry["why"]):
                text = entry["text"] if "text" in entry else _encode(entry["project"])
                with self.assertRaises(VectorProjectError) as raised:
                    parse_vector_project(text)
                self.assertRegex(raised.exception.args[0], re.compile(entry["messagePattern"], re.I))

    def test_budget_cases_lock_exact_limit_accept_and_one_past_reject(self) -> None:
        self.assertGreaterEqual(len(self.fixture["budgetCases"]), 5)
        for entry in self.fixture["budgetCases"]:
            with self.subTest(id=entry["id"], why=entry["why"]):
                text = _build_budget_case(self.fixture, entry["build"])
                if entry["expect"] == "accept":
                    parsed = parse_vector_project(text)
                    self.assertEqual(len(parsed["assets"]), MAX_ASSET_COUNT)
                    self.assertEqual(len(parsed["items"]), MAX_ITEM_COUNT)
                    self.assertEqual(parsed["width"], MAX_DIMENSION)
                    continue
                self.assertEqual(entry["expect"], "reject")
                with self.assertRaises(VectorProjectError) as raised:
                    parse_vector_project(text)
                self.assertRegex(raised.exception.args[0], re.compile(entry["messagePattern"], re.I))

    def test_rejects_non_string_project_text(self) -> None:
        with self.assertRaises(VectorProjectError) as raised:
            parse_vector_project(None)  # type: ignore[arg-type]
        self.assertRegex(raised.exception.args[0], re.compile(r"string", re.I))


if __name__ == "__main__":
    unittest.main()
