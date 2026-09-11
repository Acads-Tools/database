# Database Schema & Directory Architecture

This document defines the storage schemas, directory hierarchy, and question format used across the **AMAES Study Database**.

---

## 1. Directory Structure

```
data/
├── [SUBCODE].json           # Primary unified production database
├── verified/
│   └── [SUBCODE].json       # High-consensus, officially verified answers
├── community/
│   └── [SUBCODE].json       # Continuous community submissions queue
└── amauoed/
    └── [SUBCODE].json       # Web-scraped reference baseline
```

### Purpose of Each Tier

1. **`data/[SUBCODE].json` (Production Bank)**:
   - Primary endpoint served directly to students' userscripts on course open.
   - Combines verified submissions and consensus-validated community questions.
2. **`data/verified/[SUBCODE].json` (Verified Review Key)**:
   - Contains questions confirmed by 100% full-mark quiz reviews or official Moodle checkmark feedback.
   - Used for zero-hallucination, 100% confidence auto-selection.
3. **`data/community/[SUBCODE].json` (Community Archive)**:
   - Records all validated anonymous student submissions received via the Cloudflare relay.
   - Tracks confirmation counters (`confirmations: N`) as multiple students submit the same answer.
4. **`data/amauoed/[SUBCODE].json` (Catalog Fallback)**:
   - Reference questions parsed from public online study repositories used as fallback when a subject has no local or community submissions yet.

---

## 2. Course Database JSON Schema

Each course file (e.g., `data/CS6204.json`) adheres to the following JSON schema:

```json
{
  "subjectCode": "CS6204",
  "subjectName": "Computer Architecture and Organization",
  "updatedAt": "2026-09-11T18:00:43Z",
  "totalQuestions": 47,
  "questions": [
    {
      "question": "What is the primary function of the Program Counter (PC)?",
      "answer": "Holds the memory address of the next instruction to be fetched.",
      "choices": [
        "Holds the memory address of the next instruction to be fetched.",
        "Stores the result of the Arithmetic Logic Unit",
        "Decodes the current instruction opcode",
        "Controls bus arbitration"
      ],
      "wrongAnswers": [
        "Stores the result of the Arithmetic Logic Unit"
      ],
      "verified": true,
      "confirmations": 3,
      "term": "Midterm"
    }
  ]
}
```

---

## 3. Field Specifications

### Root Object

| Field | Type | Description |
| :--- | :--- | :--- |
| `subjectCode` | `string` | Normalized uppercase course code (e.g., `CS6204`, `ITE6100`). |
| `subjectName` | `string` | Full human-readable course title. |
| `updatedAt` | `string` | ISO 8601 UTC timestamp of the last database merge. |
| `totalQuestions` | `integer` | Total count of unique questions in the file. |
| `questions` | `array` | Array of Question Objects (detailed below). |

---

### Question Object

| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `question` | `string` | **Yes** | Clean question text stripped of Moodle preambles and HTML formatting. |
| `answer` | `string` | **Yes** | Verified correct answer string (or comma-separated values for multi-choice). |
| `choices` | `array[string]` | No | List of all available answer choices presented on the question card. |
| `wrongAnswers` | `array[string]` | No | List of options confirmed incorrect (eliminated via 0.00 marks or red crosses). |
| `verified` | `boolean` | No | Flag set to `true` when answer is verified by full marks or checkmark feedback. |
| `confirmations`| `integer` | No | Number of independent students who submitted this exact answer key. |
| `term` | `string` | No | Associated academic term (`Prelim`, `Midterm`, `Prefi`, or `Final`). |
| `source` | `string` | No | Origin tag (e.g., `review_harvester`, `community_relay`, `amauoed_catalog`). |

---

## 4. Normalization Rules

- **Question Deduplication**: Keys are normalized via `normalize_question_key` by stripping HTML, non-alphanumeric characters, and converting to lowercase.
- **Answer Choices**: Choices are trimmed and normalized to avoid duplicate entries with minor spacing or casing variations.
- **Distractor Elimination**: If an option previously listed in `wrongAnswers` is subsequently proven correct with official Moodle feedback, the conflict is resolved in favor of verified ground truth, and the wrong distractor record is purged.
