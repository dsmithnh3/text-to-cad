from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[3]


class VectorSkillDistributionTest(unittest.TestCase):
    def test_shipped_vector_skills_do_not_reference_checkout_only_commands(self):
        for name in ("cad-to-isometric-svg", "refrigeration-equipment", "cold-room-vector-layout"):
            text = (ROOT / "skills" / name / "SKILL.md").read_text(encoding="utf-8")
            self.assertNotIn("scripts/vector/", text, name)
            self.assertIsNone(re.search(r"cad viewer\s+\S+\.py\b", text), name)


if __name__ == "__main__":
    unittest.main()
