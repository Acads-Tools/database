#!/usr/bin/env python3
"""
Automated Anti-Sabotage Merge Engine for Community Quiz Contributions
Validates, sanitizes, consensus-checks, and merges community study answers.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

def clean_text(text: str) -> str:
    """Strip dangerous characters, excessive whitespace, and HTML tags."""
    if not isinstance(text, str):
        return ""
    # Strip HTML tags
    clean = re.sub(r'<[^>]*>', ' ', text)
    # Strip dangerous protocols
    clean = re.sub(r'(javascript|data|vbscript):', '', clean, flags=re.IGNORECASE)
    # Normalize whitespace
    clean = re.sub(r'\s+', ' ', clean).strip()
    return clean

def normalize_question_key(text: str) -> str:
    """Normalize question text for deduplication and comparison."""
    clean = clean_text(text).lower()
    # Strip punctuation and numbers for fuzzy keying
    clean = re.sub(r'[^a-z0-9]', '', clean)
    return clean

def extract_json_payload(raw_content: str) -> dict:
    """Extract JSON payload from raw text or markdown code blocks."""
    # Try finding markdown code block ```json ... ```
    match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', raw_content)
    if match:
        raw_content = match.group(1).strip()

    # Find matching outermost braces { ... } or [ ... ]
    start_brace = raw_content.find('{')
    if start_brace != -1:
        end_brace = raw_content.rfind('}')
        if end_brace > start_brace:
            raw_content = raw_content[start_brace:end_brace + 1]

    return json.loads(raw_content)

KNOWN_COURSE_NAMES = {
    # Computer Science
    "CS6202": "Algorithms and Complexity",
    "CS6204": "Computer Architecture and Organization",
    "CS6205": "Automata Theory and Formal Languages",
    "CS6206": "Principles of Operating Systems",
    "CS6209": "Software Engineering 1",
    "CS6300": "Software Engineering 2",
    "CS6301": "Logic Design and Digital Computer Circuits",
    "CS6309": "Introduction to Machine Learning",
    "CS6326": "Mobile Application Development",
    # Information Technology
    "IT6201": "Data Structures and Algorithm Analysis",
    "IT6202": "Data Structures and Algorithms",
    "IT6203": "Web Systems and Technologies 1",
    "IT6204": "Web Systems and Technologies 2",
    "IT6205": "Information Assurance and Security 1",
    "IT6205A": "Information Assurance and Security 1",
    "IT6206": "Information Assurance and Security 2",
    "IT6207": "Database Systems 1",
    "IT6208": "System Integration and Architecture 1",
    "IT6209": "Introduction to Multimedia",
    "IT6210": "Systems Administration and Maintenance",
    "IT6220": "Information Management",
    "IT6221": "Data Communications and Networking 1",
    "IT6222": "Data Communications and Networking 2",
    "IT6224": "Data Communications and Networking 3",
    "IT6224B": "Data Communications and Networking 3",
    "IT6300": "Cloud Computing",
    "IT6301": "Technopreneurship",
    "IT6302": "System Analysis and Design",
    "IT6310": "Network Security",
    "IT6320": "Social and Professional Issues",
    "IT6322": "Mobile Application Development",
    "IT6322A": "Mobile Application Development",
    "IT6323": "Human Computer Interaction",
    "IT6324": "Information Assurance and Security",
    # Information Technology Education Core
    "ITE6100": "Introduction to Computing",
    "ITE6101": "Computer Programming 1",
    "ITE6102": "Computer Programming 1",
    "ITE6103": "Computer Programming 2",
    "ITE6104": "Computer Programming 2",
    "ITE6200": "Application Development and Emerging Technology",
    "ITE6201": "Data Structures and Algorithm Analysis",
    "ITE6220": "Information Management",
    "ITE6300": "Cloud Computing and Internet of Things",
    "ITE6301": "Technopreneurship",
    # Mathematics & Sciences
    "MATH6100": "Calculus 1",
    "MATH6101": "Calculus 2",
    "MATH6102": "Discrete Mathematics",
    # General Education & Institutional
    "GE6100": "Understanding the Self",
    "GE6101": "Readings in Philippine History",
    "GE6102": "The Contemporary World",
    "GE6103": "Mathematics in the Modern World",
    "GE6104": "Purposive Communication",
    "GE6105": "Art Appreciation",
    "GE6106": "Science, Technology and Society",
    "GE6107": "Ethics",
    "GE6108": "Rizal's Life and Works",
    "GE6115": "Art Appreciation",
    "ETHNS6101": "Euthenics 1",
    "ETHNS6102": "Euthenics 2",
    "NSTP6101": "National Service Training Program 1",
    "NSTP6102": "National Service Training Program 2",
    "PE6101": "Physical Education 1",
    "PE6102": "Physical Education 2",
    "PE6103": "Physical Education 3",
    "PE6104": "Physical Education 4",
}

def get_known_course_name(code: str) -> str:
    """Resolve human-readable course name by code, supporting suffixes (e.g. IT6205A -> IT6205)."""
    if not code:
        return ""
    code_clean = str(code).strip().upper()
    if code_clean in KNOWN_COURSE_NAMES:
        return KNOWN_COURSE_NAMES[code_clean]
    base_code = re.sub(r'[A-Za-z]+$', '', code_clean)
    if base_code and base_code in KNOWN_COURSE_NAMES:
        return KNOWN_COURSE_NAMES[base_code]
    return code_clean

def validate_and_merge(payload: dict, data_dir: str = "data") -> dict:
    """
    Validates input against anti-sabotage rules and merges into database.
    Returns status summary dictionary.
    """
    subject_code = payload.get("subjectCode") or payload.get("subject") or payload.get("code")
    if not subject_code or not re.match(r'^[A-Za-z0-9_-]{2,16}$', str(subject_code)):
        raise ValueError(f"Invalid subject code: '{subject_code}'. Must be 2-16 alphanumeric characters.")

    subject_code = str(subject_code).upper()
    incoming_questions = payload.get("questions")
    if not isinstance(incoming_questions, list) or len(incoming_questions) == 0:
        raise ValueError("Payload must contain a non-empty list of 'questions'.")

    os.makedirs(data_dir, exist_ok=True)
    target_file = os.path.join(data_dir, f"{subject_code}.json")

    resolved_title = payload.get("subjectName")
    if not resolved_title or str(resolved_title).strip().upper() == subject_code:
        resolved_title = get_known_course_name(subject_code)

    existing_data = {
        "subjectCode": subject_code,
        "subjectName": resolved_title,
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totalQuestions": 0,
        "questions": []
    }

    if os.path.exists(target_file):
        try:
            with open(target_file, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict) and "questions" in loaded:
                    existing_data = loaded
        except Exception as e:
            print(f"Warning reading {target_file}: {e}")

    # Ensure subjectName is upgraded if existing was empty or identical to subjectCode
    current_name = str(existing_data.get("subjectName", "")).strip()
    if not current_name or current_name.upper() == subject_code:
        existing_data["subjectName"] = resolved_title
    elif resolved_title != subject_code and len(resolved_title) > len(current_name):
        existing_data["subjectName"] = resolved_title

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Build lookup map of existing questions by normalized key
    existing_map = {}
    for idx, q in enumerate(existing_data.get("questions", [])):
        q_text = q.get("question") or q.get("qText") or ""
        key = normalize_question_key(q_text)
        if key:
            existing_map[key] = idx

    merged_count = 0
    updated_count = 0
    rejected_count = 0
    conflict_count = 0

    for item in incoming_questions:
        if not isinstance(item, dict):
            rejected_count += 1
            continue

        raw_q = item.get("question") or item.get("qRaw") or item.get("qText") or ""
        raw_a = item.get("answer") or item.get("ansRaw") or (item.get("answers")[0] if isinstance(item.get("answers"), list) and item.get("answers") else "") or item.get("correctAnswer") or ""
        choices = item.get("choices") or []

        clean_q = clean_text(raw_q)
        clean_a = clean_text(raw_a)

        # Anti-Sabotage Validation Checks:
        if len(clean_q) < 5 or len(clean_q) > 2000:
            rejected_count += 1
            continue

        if len(clean_a) < 1 or len(clean_a) > 500:
            rejected_count += 1
            continue

        # Reject HTML script injection attempts
        if any(bad in raw_q.lower() or bad in raw_a.lower() for bad in ["<script", "javascript:", "onload=", "onerror="]):
            rejected_count += 1
            continue

        norm_key = normalize_question_key(clean_q)
        if not norm_key:
            rejected_count += 1
            continue

        sanitized_choices = [clean_text(c) for c in choices if clean_text(c)]
        incoming_wrong = [clean_text(w) for w in (item.get("wrongAnswers") or []) if clean_text(w)]

        # Safety Guard: If answer is listed in wrongAnswers, it was PROVEN WRONG! Never accept it.
        if any(clean_a.lower() == w.lower() for w in incoming_wrong):
            rejected_count += 1
            continue

        is_ai_suggestion = bool(item.get("isAiSuggestion") or "gemini" in str(item.get("source", "")).lower() or item.get("evidenceType") == "ai_inference")
        is_verified_source = bool(item.get("verified") or item.get("evidenceType") in ["moodle_review", "official_review", "moodle_100_percent"])

        if norm_key in existing_map:
            idx = existing_map[norm_key]
            existing_item = existing_data["questions"][idx]
            curr_answer = clean_text(existing_item.get("answer", ""))

            # Merge wrong answers
            existing_wrong = existing_item.setdefault("wrongAnswers", [])
            for w in incoming_wrong:
                if not any(w.lower() == ew.lower() for ew in existing_wrong):
                    existing_wrong.append(w)

            # Safety Guard: If incoming answer matches any known wrong answer, reject
            if any(clean_a.lower() == ew.lower() for ew in existing_wrong):
                rejected_count += 1
                continue

            if clean_a.lower() == curr_answer.lower():
                # Confirmed existing answer
                existing_item["confirmations"] = existing_item.get("confirmations", 1) + 1
                existing_item["lastVerifiedAt"] = now_iso
                if is_verified_source:
                    existing_item["verified"] = True
                    existing_item["isAiSuggestion"] = False
                    existing_item["source"] = item.get("source") or "moodle_review"
                updated_count += 1
            else:
                # Conflict Detected!
                # If existing was an unverified AI suggestion and incoming is a verified review:
                if existing_item.get("isAiSuggestion") and is_verified_source:
                    # Verified review promotes and supersedes the AI guess!
                    existing_item["answer"] = clean_a
                    existing_item["verified"] = True
                    existing_item["isAiSuggestion"] = False
                    existing_item["source"] = item.get("source") or "moodle_review"
                    existing_item["confirmations"] = 1
                    existing_item["lastVerifiedAt"] = now_iso
                    updated_count += 1
                elif existing_item.get("verified") and is_ai_suggestion:
                    # Unverified AI suggestion CANNOT overwrite an already verified answer
                    conflict_count += 1
                    notes = existing_item.setdefault("conflictHistory", [])
                    notes.append({
                        "rejectedAnswer": clean_a,
                        "reason": "AI suggestion cannot overwrite verified answer",
                        "timestamp": now_iso
                    })
                else:
                    conf_count = existing_item.get("confirmations", 1)
                    if conf_count >= 2:
                        conflict_count += 1
                        notes = existing_item.setdefault("conflictHistory", [])
                        notes.append({
                            "rejectedAnswer": clean_a,
                            "timestamp": now_iso
                        })
                    else:
                        existing_item.setdefault("alternateAnswers", []).append({
                            "answer": clean_a,
                            "timestamp": now_iso
                        })
                        updated_count += 1
        else:
            # New Question Addition
            new_entry = {
                "question": clean_q,
                "answer": clean_a,
                "choices": sanitized_choices,
                "wrongAnswers": incoming_wrong,
                "verified": not is_ai_suggestion and is_verified_source,
                "isAiSuggestion": is_ai_suggestion,
                "confirmations": 1,
                "firstSeenAt": now_iso,
                "lastVerifiedAt": now_iso,
                "source": "Google Gemini AI" if is_ai_suggestion else (item.get("source") or "community_contribution")
            }
            existing_data["questions"].append(new_entry)
            existing_map[norm_key] = len(existing_data["questions"]) - 1
            merged_count += 1

    existing_data["updatedAt"] = now_iso
    existing_data["totalQuestions"] = len(existing_data["questions"])

    # Sort questions alphabetically for clean git diffs
    existing_data["questions"].sort(key=lambda x: x.get("question", "").lower())

    # 1. Save Master Legacy Bundle
    with open(target_file, "w", encoding="utf-8") as f:
        json.dump(existing_data, f, indent=2, ensure_ascii=False)

    # 2. Save Tier 2: Community Archive (all submissions with confirmation counts)
    community_dir = os.path.join(data_dir, "community")
    os.makedirs(community_dir, exist_ok=True)
    comm_file = os.path.join(community_dir, f"{subject_code}.json")
    with open(comm_file, "w", encoding="utf-8") as f:
        json.dump(existing_data, f, indent=2, ensure_ascii=False)

    # 3. Save Tier 1: Verified Gold Standard (confirmations >= 2 or direct verified moodle review)
    verified_dir = os.path.join(data_dir, "verified")
    os.makedirs(verified_dir, exist_ok=True)
    verified_questions = [
        q for q in existing_data["questions"]
        if q.get("isAiSuggestion") is not True and (
            q.get("confirmations", 1) >= 2 or
            q.get("source") in ["moodle_review", "official_review", "moodle_100_percent"] or
            q.get("verified") is True
        )
    ]
    verified_data = {
        "subjectCode": subject_code,
        "subjectName": existing_data.get("subjectName", subject_code),
        "updatedAt": now_iso,
        "totalQuestions": len(verified_questions),
        "tier": "verified",
        "questions": verified_questions
    }
    ver_file = os.path.join(verified_dir, f"{subject_code}.json")
    with open(ver_file, "w", encoding="utf-8") as f:
        json.dump(verified_data, f, indent=2, ensure_ascii=False)

    # 4. Save Tier 3: AMAUOED Catalog (questions sourced from amauoed.com)
    amauoed_dir = os.path.join(data_dir, "amauoed")
    os.makedirs(amauoed_dir, exist_ok=True)
    amauoed_questions = [
        q for q in existing_data["questions"]
        if "amauoed" in str(q.get("source", "")).lower()
    ]
    if amauoed_questions:
        amauoed_data = {
            "subjectCode": subject_code,
            "subjectName": existing_data.get("subjectName", subject_code),
            "updatedAt": now_iso,
            "totalQuestions": len(amauoed_questions),
            "tier": "amauoed",
            "questions": amauoed_questions
        }
        ama_file = os.path.join(amauoed_dir, f"{subject_code}.json")
        with open(ama_file, "w", encoding="utf-8") as f:
            json.dump(amauoed_data, f, indent=2, ensure_ascii=False)

    update_readme_table(data_dir)

    return {
        "subjectCode": subject_code,
        "newMerged": merged_count,
        "updatedConfirmations": updated_count,
        "conflictsHandled": conflict_count,
        "rejected": rejected_count,
        "totalInFile": len(existing_data["questions"]),
        "totalVerified": len(verified_questions),
        "totalAmauoed": len(amauoed_questions)
    }

def update_readme_table(data_dir: str = "data"):
    """Update README.md table with live question counts."""
    readme_path = "README.md"
    if not os.path.exists(readme_path):
        return

    stats = []
    if os.path.exists(data_dir):
        for fname in sorted(os.listdir(data_dir)):
            if fname.endswith(".json"):
                fpath = os.path.join(data_dir, fname)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        code = data.get("subjectCode", fname.replace(".json", "")).strip().upper()
                        title = data.get("subjectName")
                        if not title or str(title).strip().upper() == code:
                            title = get_known_course_name(code)
                        count = data.get("totalQuestions", len(data.get("questions", [])))
                        stats.append((code, title, count))
                except Exception:
                    pass

    table_rows = [
        "<details>",
        "<summary><b>View active subject archives (Click to expand)</b></summary>",
        "<br>",
        "",
        "| Subject Code | Course Title | Verified Questions | Status |",
        "| :--- | :--- | :---: | :--- |"
    ]
    for code, title, count in stats:
        table_rows.append(f"| `{code}` | {title} | **{count}** | Active |")
    table_rows.append("")
    table_rows.append("Course databases are stored in [`data/`](data/) as structured JSON files named by subject code (e.g., `CS6301.json`).")
    table_rows.append("")
    table_rows.append("</details>")

    table_content = "\n".join(table_rows)

    with open(readme_path, "r", encoding="utf-8") as f:
        content = f.read()

    pattern = r'(## (?:Course Archives|(?:📂 )?Available Course Databases)\s*\n\n)([\s\S]*?)(\n\n---|\n\n##|$)'
    if re.search(pattern, content):
        new_content = re.sub(pattern, f"\\1{table_content}\\3", content)
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(new_content)

def main():
    if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            raw = f.read()
    else:
        raw = sys.stdin.read()

    if not raw.strip():
        print("Error: No input payload provided.", file=sys.stderr)
        sys.exit(1)

    try:
        payload = extract_json_payload(raw)
        result = validate_and_merge(payload)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
