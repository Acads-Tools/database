#!/usr/bin/env python3
"""Refresh the opted-in course study-guide snapshots from AMAUOED and Jenny's Online."""

from __future__ import annotations

import csv
import argparse
import html
from html.parser import HTMLParser
from io import StringIO
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote_plus, urljoin, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
COURSE_DIR = ROOT / "data"
AM_SOURCE_DIR = COURSE_DIR / "amauoed"
JENNY_SOURCE_DIR = COURSE_DIR / "jennysonline"
USER_AGENT = "AMAES-Study-Guide-Refresh/1.0 (monthly public study-guide snapshot)"
REQUEST_INTERVAL_SECONDS = 1.5
MAX_AM_PAGES = 40
MAX_JENNY_POSTS_PER_COURSE = 5
last_request_at = 0.0


def normalize(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", html.unescape(value).lower()))


def normalize_for_deduplication(value: str) -> str:
    return " ".join(html.unescape(value).casefold().split()).rstrip(".:?!;,")


def fetch(url: str) -> bytes:
    global last_request_at
    wait = REQUEST_INTERVAL_SECONDS - (time.monotonic() - last_request_at)
    if wait > 0:
        time.sleep(wait)
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    try:
        with urlopen(request, timeout=30) as response:
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"HTTP {response.status}: {url}")
            body = response.read()
    except (HTTPError, URLError, TimeoutError) as error:
        raise RuntimeError(f"Unable to fetch {url}: {error}") from error
    finally:
        last_request_at = time.monotonic()
    return body


class Node:
    def __init__(self, tag: str, attrs: dict[str, str], parent: Node | None):
        self.tag = tag
        self.attrs = attrs
        self.parent = parent
        self.children: list[Node | str] = []

    @property
    def classes(self) -> set[str]:
        return set(self.attrs.get("class", "").split())

    def text(self) -> str:
        return " ".join(
            child.text() if isinstance(child, Node) else child
            for child in self.children
        ).strip()

    def text_without_badges(self) -> str:
        parts = []
        for child in self.children:
            if isinstance(child, Node):
                if {"chip", "badge"} & child.classes:
                    continue
                parts.append(child.text_without_badges())
            else:
                parts.append(child)
        return " ".join(" ".join(parts).split()).strip()

    def descendants(self):
        for child in self.children:
            if isinstance(child, Node):
                yield child
                yield from child.descendants()

    def find(self, predicate):
        return next((node for node in self.descendants() if predicate(node)), None)

    def find_all(self, predicate):
        return [node for node in self.descendants() if predicate(node)]


class TreeParser(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
            "meta", "param", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("document", {}, None)
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, dict(attrs), self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Node(tag, dict(attrs), self.stack[-1]))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        if data.strip():
            self.stack[-1].children.append(data)


def parse_amauoed_catalog(document: str) -> list[dict]:
    parser = TreeParser()
    parser.feed(document)
    result = []
    for anchor in parser.root.find_all(lambda node: node.tag == "a" and "/courses/" in node.attrs.get("href", "")):
        url = urljoin("https://amauoed.com", anchor.attrs["href"])
        if urlparse(url).hostname != "amauoed.com":
            continue
        card = anchor.find(lambda node: "card-title" in node.classes)
        title = card.text() if card else anchor.text()
        subtitle_node = anchor.find(lambda node: "card-subtitle" in node.classes)
        subtitle = subtitle_node.text() if subtitle_node else ""
        code_match = re.search(r"([A-Za-z]+[- ]?\d{3,4}[A-Za-z]*)", subtitle)
        if not code_match:
            code_match = re.search(r"([A-Za-z]+[- ]?\d{3,4}[A-Za-z]*)", urlparse(url).path.rsplit("/", 1)[-1])
        raw_code = code_match.group(1) if code_match else ""
        result.append({
            "url": url,
            "title": title,
            "code": re.sub(r"[^A-Z0-9]", "", raw_code.upper()),
        })
    return result


def match_course(course: dict, catalog: list[dict]) -> dict | None:
    code = re.sub(r"[^A-Z0-9]", "", course["subjectCode"].upper())
    exact_code = [item for item in catalog if item["code"] == code]
    if len(exact_code) == 1:
        return exact_code[0]
    if len(exact_code) > 1:
        title_matches = [item for item in exact_code if normalize(item["title"]) == normalize(course["subjectName"])]
        return title_matches[0] if len(title_matches) == 1 else None

    target = normalize(course["subjectName"])
    if not target or target == normalize(course["subjectCode"]):
        return None
    target_words = set(target.split())
    ranked = []
    for item in catalog:
        candidate_words = set(normalize(item["title"]).split())
        if not candidate_words:
            continue
        overlap = len(target_words & candidate_words) / max(len(target_words), len(candidate_words))
        if overlap >= 0.85 and normalize(item["title"]) == target:
            ranked.append((overlap, item))
    return ranked[0][1] if len(ranked) == 1 else None


def parse_amauoed_questions(document: str, source_url: str) -> list[dict]:
    parser = TreeParser()
    parser.feed(document)
    cards = parser.root.find_all(lambda node: "card" in node.classes)
    results = []
    seen = set()

    for card in cards:
        question_node = card.find(lambda node:
            "mb-2" in node.classes or node.tag == "h5" or
            "card-title" in node.classes or
            (node.tag == "p" and "card-text" in node.classes))
        if not question_node:
            continue
        question = question_node.text()
        choices = card.find_all(lambda node: node.tag == "li")
        correct = []
        correct_chips = card.find_all(lambda node:
            (("chip" in node.classes or "badge" in node.classes) and "bg-success" in node.classes) or
            (node.tag == "span" and "bg-success" in node.classes) or
            "badge-success" in node.classes)

        for chip in correct_chips:
            answer_node = chip.parent
            while answer_node and answer_node.tag != "li":
                answer_node = answer_node.parent
            answer = answer_node.text_without_badges() if answer_node else ""
            if answer and normalize(answer) not in {normalize(item) for item in correct}:
                correct.append(answer)
        if not correct:
            for item in choices:
                strong = item.find(lambda node: node.tag == "strong")
                if strong and strong.text():
                    correct.append(strong.text())

        if not question or not correct:
            continue
        identity = (normalize_for_deduplication(question),
                    tuple(sorted(normalize_for_deduplication(value) for value in correct)))
        if identity in seen:
            continue
        seen.add(identity)

        choice_texts = [item.text_without_badges() for item in choices if item.text_without_badges()]
        wrong = [item for item in choice_texts if normalize(item) not in {normalize(value) for value in correct}]
        answer = ", ".join(correct)
        results.append({
            "question": question,
            "answer": answer,
            "choices": choice_texts,
            "wrongAnswers": wrong,
            "verified": False,
            "confirmations": 1,
            "source": "amauoed",
            "evidenceType": "study_guide_candidate",
            "sourceUrl": source_url,
        })
    return results


def crawl_amauoed(course: dict, catalog: list[dict]) -> tuple[str, list[dict]] | None:
    match = match_course(course, catalog)
    if not match:
        return None
    all_questions = []
    seen = set()
    for page in range(1, MAX_AM_PAGES + 1):
        page_url = match["url"] if page == 1 else f"{match['url']}?page={page}"
        document = fetch(page_url).decode("utf-8", errors="replace")
        questions = parse_amauoed_questions(document, match["url"])
        if not questions:
            break
        for question in questions:
            key = (normalize_for_deduplication(question["question"]),
                   normalize_for_deduplication(question["answer"]))
            if key not in seen:
                seen.add(key)
                all_questions.append(question)
    return match["url"], all_questions


def blogger_feed(course: dict) -> list[dict]:
    query = quote_plus(course["subjectName"])
    url = f"https://jennysonline.blogspot.com/feeds/posts/default?q={query}&alt=json&max-results=100"
    root = json.loads(fetch(url))
    entries = root.get("feed", {}).get("entry", [])
    target = normalize(course["subjectName"])
    matches = []
    for entry in entries:
        title = entry.get("title", {}).get("$t", "")
        if normalize(title) != target:
            continue
        link = next((node.get("href", "") for node in entry.get("link", [])
                     if node.get("rel") == "alternate" and node.get("href")), "")
        if link and urlparse(link).scheme == "https" and urlparse(link).hostname == "jennysonline.blogspot.com":
            matches.append({"title": title, "url": link})
    return matches[:MAX_JENNY_POSTS_PER_COURSE]


def parse_jenny_csv(csv_text: str, source_url: str) -> list[dict]:
    questions = []
    seen = set()
    for row in csv.reader(StringIO(csv_text, newline="")):
        if len(row) < 2:
            continue
        answer, question = (re.sub(r"\s+", " ", cell).strip() for cell in row[:2])
        if not answer or not question or normalize(answer) in {"answer", "correct answer"}:
            continue
        identity = (normalize_for_deduplication(question), normalize_for_deduplication(answer))
        if identity in seen:
            continue
        seen.add(identity)
        questions.append({
            "question": question,
            "answer": answer,
            "choices": [],
            "verified": False,
            "confirmations": 1,
            "source": "jennysonline",
            "evidenceType": "study_guide_candidate",
            "sourceUrl": source_url,
        })
    return questions


def crawl_jenny(course: dict) -> tuple[str, list[dict]] | None:
    for post in blogger_feed(course):
        page = fetch(post["url"]).decode("utf-8", errors="replace")
        parser = TreeParser()
        parser.feed(page)
        iframe = parser.root.find(lambda node: node.tag == "iframe" and node.attrs.get("src"))
        if not iframe:
            continue
        frame_url = urljoin(post["url"], iframe.attrs["src"].replace("&amp;", "&"))
        parsed_url = urlparse(frame_url)
        if parsed_url.scheme != "https" or parsed_url.hostname != "docs.google.com" or \
                not re.search(r"/spreadsheets/d/e/[^/]+/pubhtml$", parsed_url.path):
            continue
        csv_url = re.sub(r"/pubhtml$", "/pub", frame_url.split("?", 1)[0]) + "?output=csv"
        csv_text = fetch(csv_url).decode("utf-8-sig", errors="replace")
        questions = parse_jenny_csv(csv_text, post["url"])
        if questions:
            return post["url"], questions
    return None


def load_courses(subject_code: str | None = None) -> list[dict]:
    courses = []
    for path in sorted(COURSE_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if data.get("subjectCode") and isinstance(data.get("questions"), list):
            if subject_code and data["subjectCode"].upper() != subject_code:
                continue
            courses.append({"subjectCode": data["subjectCode"], "subjectName": data.get("subjectName") or data["subjectCode"]})
    return courses


def write_tier(directory: Path, course: dict, source_name: str, source_url: str,
               source_format: str, questions: list[dict]) -> bool | None:
    if not questions:
        return False
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{course['subjectCode']}.json"
    if path.exists():
        existing = json.loads(path.read_text(encoding="utf-8"))
        existing_questions = existing.get("questions", [])
        if (existing.get("tier") != "study_guide" or existing.get("verified") is not False or
                not isinstance(existing_questions, list) or
                any(not isinstance(question, dict) or question.get("verified") is not False
                    for question in existing_questions)):
            return None
    refreshed_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    payload = {
        "subjectCode": course["subjectCode"],
        "subjectName": course["subjectName"],
        "updatedAt": refreshed_at,
        "refreshedAt": refreshed_at,
        "tier": "study_guide",
        "sourceName": source_name,
        "sourceUrl": source_url,
        "sourceFormat": source_format,
        "verified": False,
        "totalQuestions": len(questions),
        "questions": questions,
    }
    serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == serialized:
        return False
    path.write_text(serialized, encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--course-code", help="Refresh only this course code")
    args = parser.parse_args()
    subject_code = args.course_code.upper() if args.course_code else None
    if subject_code and not re.fullmatch(r"[A-Z0-9_-]{2,16}", subject_code):
        print("Invalid course code.", file=sys.stderr)
        return 2
    courses = load_courses(subject_code)
    if not courses:
        print("No matching primary course file found; refusing an empty refresh.", file=sys.stderr)
        return 1

    catalog = []
    errors = 0
    try:
        catalog = parse_amauoed_catalog(fetch("https://amauoed.com/courses").decode("utf-8", errors="replace"))
    except Exception as error:
        errors += 1
        print(f"AMAUOED catalog unavailable; leaving its existing snapshots untouched: {error}", file=sys.stderr)

    changed = 0
    for course in courses:
        code = course["subjectCode"]
        for source_name, directory, crawler, source_format in (
            ("AMAUOED", AM_SOURCE_DIR, lambda: crawl_amauoed(course, catalog), "AMAUOED course answer cards"),
            ("Jenny's Online", JENNY_SOURCE_DIR, lambda: crawl_jenny(course), "Blogger post with published Google Sheet"),
        ):
            try:
                result = crawler()
                if not result:
                    print(f"SKIP {code} {source_name}: no exact matching course source")
                    continue
                source_url, questions = result
                if not questions:
                    errors += 1
                    print(f"ERROR {code} {source_name}: matched page had no parseable rows; kept prior snapshot", file=sys.stderr)
                    continue
                updated = write_tier(directory, course, source_name, source_url, source_format, questions)
                if updated is None:
                    print(f"SKIP {code} {source_name}: protected existing non-candidate data")
                    continue
                changed += int(updated)
                print(f"{'UPDATED' if updated else 'UNCHANGED'} {code} {source_name}: {len(questions)} unverified rows")
            except Exception as error:
                errors += 1
                print(f"ERROR {code} {source_name}: {error}", file=sys.stderr)
    print(f"Study-guide refresh complete: {changed} source files changed across {len(courses)} courses; {errors} source errors.")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
