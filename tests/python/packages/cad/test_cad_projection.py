"""CAD-accurate orthographic / isometric SVG projection and provenance."""

from __future__ import annotations

import unittest

from cad.cad_projection import (
    BACKEND,
    CadProjectionError,
    ILLUSTRATIVE_MESH_KIND,
    KIND,
    build_projection_provenance,
    parse_projection_provenance,
    project_shape_to_svg,
    view_class_for,
)


def _box():
    from build123d import Align, Box

    return Box(40, 30, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))


class CadProjectionProvenanceTests(unittest.TestCase):
    def test_view_class_distinguishes_orthographic_and_isometric(self) -> None:
        self.assertEqual(view_class_for("front"), "orthographic")
        self.assertEqual(view_class_for("top"), "orthographic")
        self.assertEqual(view_class_for("iso"), "isometric")
        with self.assertRaisesRegex(CadProjectionError, "unknown projection view"):
            view_class_for("perspective")

    def test_build_and_parse_round_trip(self) -> None:
        provenance = build_projection_provenance(
            view="iso",
            hidden_lines=True,
            source_path="/tmp/part.step",
            document_id="doc-1",
            document_revision="rev-a",
        )
        self.assertEqual(provenance["kind"], KIND)
        self.assertEqual(provenance["backend"], BACKEND)
        self.assertEqual(provenance["viewClass"], "isometric")
        self.assertEqual(parse_projection_provenance(provenance), provenance)

    def test_illustrative_mesh_kind_rejected(self) -> None:
        with self.assertRaisesRegex(CadProjectionError, "illustrative mesh"):
            parse_projection_provenance(
                {
                    "kind": ILLUSTRATIVE_MESH_KIND,
                    "backend": BACKEND,
                    "view": "iso",
                    "viewClass": "isometric",
                    "hiddenLines": True,
                    "source": {"path": "/tmp/mesh.glb"},
                },
            )

    def test_unknown_view_and_mismatched_class_rejected(self) -> None:
        with self.assertRaisesRegex(CadProjectionError, "unknown projection view"):
            build_projection_provenance(view="oblique", source_path="/tmp/a.step")
        with self.assertRaisesRegex(CadProjectionError, "viewClass"):
            parse_projection_provenance(
                {
                    "kind": KIND,
                    "backend": BACKEND,
                    "view": "front",
                    "viewClass": "isometric",
                    "hiddenLines": True,
                    "source": {"path": "/tmp/a.step"},
                },
            )

    def test_source_required(self) -> None:
        with self.assertRaisesRegex(CadProjectionError, "source"):
            build_projection_provenance(view="front")


class CadProjectionExportTests(unittest.TestCase):
    def test_orthographic_and_isometric_exports_differ(self) -> None:
        part = _box()
        front = project_shape_to_svg(part, "front", source_path="/models/box.step")
        iso = project_shape_to_svg(part, "iso", source_path="/models/box.step")
        self.assertEqual(front.view_class, "orthographic")
        self.assertEqual(iso.view_class, "isometric")
        self.assertIn("CAD-accurate OCCT hidden-line projection", front.svg)
        self.assertIn("Not an illustrative mesh", front.svg)
        self.assertIn('xmlns="http://www.w3.org/2000/svg"', front.svg)
        self.assertNotEqual(front.svg, iso.svg)
        self.assertEqual(front.provenance["view"], "front")
        self.assertEqual(iso.provenance["view"], "iso")
        self.assertEqual(front.provenance["kind"], KIND)
        self.assertNotIn("illustrative", front.provenance["kind"])

    def test_hidden_lines_toggle_changes_markup(self) -> None:
        part = _box()
        with_hidden = project_shape_to_svg(
            part,
            "front",
            hidden_lines=True,
            document_id="d1",
            document_revision="r1",
        )
        without = project_shape_to_svg(
            part,
            "front",
            hidden_lines=False,
            document_id="d1",
            document_revision="r1",
        )
        self.assertIn("stroke-dasharray", with_hidden.svg)
        self.assertNotIn("stroke-dasharray", without.svg)
        self.assertTrue(with_hidden.provenance["hiddenLines"])
        self.assertFalse(without.provenance["hiddenLines"])


if __name__ == "__main__":
    unittest.main()
