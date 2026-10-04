import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "refresh_study_guides.py"
SPEC = importlib.util.spec_from_file_location("refresh_study_guides", SCRIPT)
refresh = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(refresh)


class StudyGuideRefreshTests(unittest.TestCase):
    def test_catalog_requires_exact_code_or_exact_title(self):
        catalog = [
            {"code": "IT6205A", "title": "Information Assurance and Security 1", "url": "https://amauoed.com/courses/it/ias-1"},
            {"code": "IT6206", "title": "Information Assurance and Security 2", "url": "https://amauoed.com/courses/it/ias-2"},
        ]
        self.assertEqual(refresh.match_course(
            {"subjectCode": "IT6205A", "subjectName": "Information Assurance and Security 1"}, catalog
        )["code"], "IT6205A")
        self.assertIsNone(refresh.match_course(
            {"subjectCode": "IT6207", "subjectName": "Computer Architecture"}, catalog
        ))

    def test_amauoed_cards_extract_answer_without_badge_and_keep_unverified(self):
        page = """
        <div class="card mb-2">
          <div class="card-body">
            <div class="mb-2">Which answer is correct?</div>
            <ul><li>Wrong</li><li><strong>Right</strong> <span class="chip bg-success">Correct</span></li></ul>
          </div>
        </div>
        """
        rows = refresh.parse_amauoed_questions(page, "https://amauoed.com/courses/example")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["question"], "Which answer is correct?")
        self.assertEqual(rows[0]["answer"], "Right")
        self.assertEqual(rows[0]["wrongAnswers"], ["Wrong"])
        self.assertFalse(rows[0]["verified"])
        self.assertEqual(rows[0]["evidenceType"], "study_guide_candidate")

    def test_jenny_multiline_csv_stays_unverified_and_deduplicates(self):
        data = '"Answer","Prompt, with comma"\r\n"Delivery","Question line one\nline two"\r\n"Delivery","Question line one, line two"\r\n"Delivery","Question line one\nline two"\r\n'
        rows = refresh.parse_jenny_csv(data, "https://jennysonline.blogspot.com/example")
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["question"], "Question line one line two")
        self.assertEqual(rows[0]["answer"], "Delivery")
        self.assertFalse(rows[0]["verified"])
        self.assertEqual(rows[1]["question"], "Question line one, line two")

    def test_jenny_feed_json_requires_exact_title_and_allowed_post_host(self):
        payload = b'{"feed":{"entry":[' \
            b'{"title":{"$t":"Exact Course"},"link":[{"rel":"alternate","href":"https://jennysonline.blogspot.com/p/1"}]},' \
            b'{"title":{"$t":"Exact Course Extra"},"link":[{"rel":"alternate","href":"https://jennysonline.blogspot.com/p/2"}]},' \
            b'{"title":{"$t":"Exact Course"},"link":[{"rel":"alternate","href":"https://evil.example/p/3"}]}' \
            b']}}'
        with patch.object(refresh, "fetch", return_value=payload):
            posts = refresh.blogger_feed({"subjectName": "Exact Course"})
        self.assertEqual(posts, [{"title": "Exact Course", "url": "https://jennysonline.blogspot.com/p/1"}])

    def test_normalization_does_not_match_a_course_number_as_a_substring(self):
        catalog = [
            {"code": "CS6204", "title": "Computer Architecture and Organization", "url": "https://amauoed.com/courses/cs/6204"},
            {"code": "CS6205", "title": "Automata Theory and Formal Languages", "url": "https://amauoed.com/courses/cs/6205"},
        ]
        self.assertIsNone(refresh.match_course(
            {"subjectCode": "CS620", "subjectName": "Computer Architecture"}, catalog
        ))

    def test_writer_preserves_existing_legacy_verified_tier(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            existing = {
                "subjectCode": "CS6301",
                "tier": "amauoed",
                "questions": [{"question": "Existing", "answer": "Answer", "verified": True}],
            }
            path = directory / "CS6301.json"
            path.write_text(json.dumps(existing), encoding="utf-8")
            result = refresh.write_tier(
                directory,
                {"subjectCode": "CS6301", "subjectName": "Logic Design"},
                "AMAUOED",
                "https://amauoed.com/courses/example",
                "AMAUOED course answer cards",
                [{"question": "New candidate", "answer": "Unconfirmed", "verified": False}],
            )
            self.assertIsNone(result)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), existing)

    def test_course_filter_rejects_unknown_course_without_falling_back_to_all(self):
        self.assertEqual(refresh.load_courses("IT6205A")[0]["subjectCode"], "IT6205A")
        self.assertEqual(refresh.load_courses("NOTACOURSE"), [])


if __name__ == "__main__":
    unittest.main()
