import sys
import json
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from merge_contributions import validate_and_merge


class RestrictedCourseSharingTests(unittest.TestCase):
    def test_gender_and_society_shared_answer_tiers_are_empty(self):
        data_root = Path(__file__).resolve().parents[1] / "data"
        for relative in ("GE6301.json", "community/GE6301.json", "verified/GE6301.json"):
            with self.subTest(tier=relative):
                payload = json.loads((data_root / relative).read_text(encoding="utf-8"))
                self.assertEqual(payload["subjectCode"], "GE6301")
                self.assertEqual(payload["subjectName"], "Gender and Society")
                self.assertEqual(payload["questions"], [])
                self.assertEqual(payload["totalQuestions"], 0)
                self.assertTrue(payload["answerSharingDisabled"])
                self.assertEqual(payload["reviewabilityStatus"], "non-reviewable")

    def test_gender_and_society_contributions_are_rejected(self):
        payload = {
            "subjectCode": "GE6301",
            "questions": [{"question": "Example", "answer": "Example answer"}],
        }
        with self.assertRaisesRegex(ValueError, "sharing is disabled for GE6301"):
            validate_and_merge(payload)


if __name__ == "__main__":
    unittest.main()
