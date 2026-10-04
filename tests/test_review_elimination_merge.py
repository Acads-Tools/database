import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from merge_contributions import validate_and_merge


class ReviewEliminationMergeTests(unittest.TestCase):
    def test_elimination_clears_unverified_answer_and_blocks_reimport(self):
        with tempfile.TemporaryDirectory() as data_dir:
            path = os.path.join(data_dir, "ITE6200.json")
            with open(path, "w", encoding="utf-8") as file:
                json.dump({
                    "subjectCode": "ITE6200",
                    "subjectName": "Application Development",
                    "questions": [{
                        "question": "It is any process or technology that allows users who forgot their passwords authenticate and reset the passwords of their account",
                        "answer": "Self-service password reset",
                        "verified": False,
                        "source": "amauoed",
                        "wrongAnswers": []
                    }]
                }, file)

            elimination = {
                "subjectCode": "ITE6200",
                "questions": [{
                    "question": "It is any process or technology that allows users who forgot their passwords authenticate and reset the passwords of their account",
                    "answer": "",
                    "wrongAnswers": ["Self-service password reset"],
                    "wrongAnswerEvidence": True,
                    "evidenceType": "moodle_review_elimination",
                    "source": "review_screen"
                }]
            }
            result = validate_and_merge(elimination, data_dir)
            self.assertEqual(result["updatedConfirmations"], 1)

            with open(path, encoding="utf-8") as file:
                stored = json.load(file)["questions"][0]
            self.assertEqual(stored["answer"], "")
            self.assertFalse(stored["verified"])
            self.assertIn("Self-service password reset", stored["wrongAnswers"])
            self.assertTrue(stored["wrongAnswerEvidence"])

            reimport = {
                "subjectCode": "ITE6200",
                "questions": [{
                    "question": elimination["questions"][0]["question"],
                    "answer": "Self-service password reset",
                    "verified": False,
                    "source": "amauoed",
                    "wrongAnswers": []
                }]
            }
            result = validate_and_merge(reimport, data_dir)
            self.assertEqual(result["rejected"], 1)
            with open(path, encoding="utf-8") as file:
                self.assertEqual(json.load(file)["questions"][0]["answer"], "")

    def test_later_verified_review_can_confirm_an_eliminated_answer(self):
        with tempfile.TemporaryDirectory() as data_dir:
            path = os.path.join(data_dir, "ITE6200.json")
            with open(path, "w", encoding="utf-8") as file:
                json.dump({
                    "subjectCode": "ITE6200",
                    "questions": [{
                        "question": "Method that accepts the email's title or heading text",
                        "answer": "",
                        "verified": False,
                        "wrongAnswers": ["Subject()"],
                        "wrongAnswerEvidence": True
                    }]
                }, file)

            result = validate_and_merge({
                "subjectCode": "ITE6200",
                "questions": [{
                    "question": "Method that accepts the email's title or heading text",
                    "answer": "Subject()",
                    "verified": True,
                    "evidenceType": "moodle_review",
                    "source": "review_screen",
                    "wrongAnswers": []
                }]
            }, data_dir)
            self.assertEqual(result["updatedConfirmations"], 1)

            with open(path, encoding="utf-8") as file:
                stored = json.load(file)["questions"][0]
            self.assertEqual(stored["answer"], "Subject()")
            self.assertTrue(stored["verified"])
            self.assertNotIn("Subject()", stored["wrongAnswers"])


if __name__ == "__main__":
    unittest.main()
