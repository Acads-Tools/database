# Anti-Sabotage Merge Engine

This document explains the security, validation, and consensus algorithms implemented in [`scripts/merge_contributions.py`](./scripts/merge_contributions.py) to protect the question database against tampering, spam, and sabotage.

---

## 1. Threat Model & Design Objectives

As an open community study archive, the database is subject to potential risks:
1. **Malicious / Incorrect Answer Injection**: Attempting to poison answer keys to mislead students.
2. **HTML / Script Injection (XSS)**: Submitting payloads containing embedded `<script>` or event handlers.
3. **Spam & Payload Flooding**: Sending garbage characters, oversized strings, or empty question bodies.
4. **Duplicate Fragmentation**: Minor spacing or capitalization differences fragmenting the question database.

---

## 2. Defensive Validation Pipeline

Every incoming contribution payload processed by the engine passes through strict defensive gates:

### A. Subject Code Validation
- Verified against regex: `^[A-Za-z0-9_-]{2,16}$`.
- Automatically mapped against known AMAES / ACLC course codes for proper title resolution (e.g., `CS6204` $\rightarrow$ *"Computer Architecture and Organization"*).

### B. Payload Sanitization & XSS Defense
- **HTML Stripping**: All tags `<...>` are stripped using regular expression tokenizers.
- **Protocol Stripping**: Dangerous URL protocols (`javascript:`, `data:`, `vbscript:`) are purged.
- **Whitespace Normalization**: Excessive linebreaks, tabs, and unicode spacing variants are collapsed.

### C. Boundary & Quality Checks
- **Question Length**: Must be between 5 and 2,000 characters. Questions shorter than 5 characters or longer than 2,000 characters are discarded.
- **Answer Length**: Must be between 1 and 1,000 characters.
- **Choices Limit**: Choice arrays capped at reasonable counts ($\le 20$) with non-empty string filtering.

---

## 3. Fuzzy Deduplication & Consensus Algorithm

```
Incoming Question ──► Clean Text ──► normalize_question_key() ──► Match in existing_map?
                                                                         │
                                                ┌────────────────────────┴────────────────────────┐
                                                ▼                                                 ▼
                                            [Match Found]                                  [New Question]
                                                │                                                 │
                                     Same Answer?                                       Add new entry
                                    ┌─────┴─────┐                                       confirmations = 1
                                  YES          NO (Conflict)
                                   ▼            ▼
                            confirmations++   Quarantine / Check
                            Update choices    Ground Truth Override
```

### 1. Key Normalization
- The function `normalize_question_key` converts question text into an alphanumeric signature:
  - Lowers all characters.
  - Strips all non-alphanumeric symbols (`[^a-z0-9]`).
  - Example: `"What is the primary function of the PC?"` $\rightarrow$ `"whatistheprimaryfunctionofthepc"`
- Guarantees questions match regardless of punctuation, capitalization, or formatting changes across Moodle theme versions.

### 2. Consensus & Confirmation Counters
- When a contribution submits an answer matching an existing verified record:
  - The record's `confirmations` count increments by $+1$.
  - Newly observed distractor choices are added to `choices` if not already present.
  - The `updatedAt` timestamp is refreshed.

### 3. Conflict Resolution & Ground Truth Override
- If an incoming answer contradicts an existing answer in the database:
  - If the incoming submission is marked `verified` (harvested from official Moodle checkmark feedback or $1.00 / 1.00$ review), it overrides unconfirmed entries.
  - If both entries claim verification, the conflicting answer is quarantined until manual administrator review or consensus threshold ($\ge 3$ confirmations) confirms the true key.
- Confirmed wrong options (`wrongAnswers`) are checked; any choice confirmed correct by official review is purged from the distractor list to prevent false eliminations.

---

## 4. Multi-Tier File Synchronization

Upon successful merge, the engine persists records across three target directories:
1. `data/[SUBCODE].json`: The unified primary database.
2. `data/community/[SUBCODE].json`: The community submissions pool with updated confirmation counters.
3. `data/verified/[SUBCODE].json`: The curated pool containing questions with verified ground truth.
4. `README.md`: Updates the repository statistics table with the latest question counts.
