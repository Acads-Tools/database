# AMAES Study Database

A verified, open-source question bank and study archive powering the [AMAES Toolkit](https://github.com/Acads-Tools/amaes-toolkit). All question entries are validated against official assessment reviews, deduplicated, and maintained for self-paced study and practice.

---

## Ecosystem Metrics

| Metric | Count / Status | Notes |
| :--- | :--- | :--- |
| **Active Subject Archives** | **33 Courses** | Primary structured JSON course databases in `data/` |
| **Verified Questions** | **3,344 Questions** | 100% review-key confirmed ground truth |
| **AMAUOED Study Guides** | **23 Snapshots** | Monthly refreshed study-guide source snapshots |
| **Jenny's Online Guides** | **9 Snapshots** | Monthly refreshed study-guide source snapshots |
| **Client Minimum Version** | **v1.7.5+** | Gateway enforced via Cloudflare Serverless Relay |
| **Serverless Relay** | `amaes-community-relay` | Cloudflare Worker + D1 SQL consensus engine |
| **Web Portal** | [amaestoolkit.pages.dev](https://amaestoolkit.pages.dev/) | Official fast web installer and status checker |

---

## Client compatibility

The current AMAES Toolkit policy allows client version **1.7.5 or newer**.
Older, missing, or invalid client versions are blocked by the userscript before
the toolkit starts and rejected by the relay with `426 Upgrade Required`.
The authoritative configured minimum is
[`relay/wrangler.toml`](relay/wrangler.toml); keep the policy documented in
[`amaes-toolkit/CLIENT-COMPATIBILITY.md`](https://github.com/Acads-Tools/amaes-toolkit/blob/main/CLIENT-COMPATIBILITY.md)
aligned with it.

---

## How It Works

### Automatic Cloud Sync
The [AMAES Toolkit](https://github.com/Acads-Tools/amaes-toolkit) automatically connects to this repository on course open. It pulls the latest verified question bank from:
```text
https://raw.githubusercontent.com/Acads-Tools/database/main/data/{SUBJECT_CODE}.json
```
If a course is not yet in the database, the toolkit falls back to autonomous background study guide parsing.

### Autonomous Anonymous Contributions
When students complete and review quiz attempts using the toolkit:
- **Zero Personal Data:** Submissions contain only the question text, verified correct answer, choices, and subject code. No student names, student IDs, emails, passwords, grades, or Moodle tokens are ever transmitted or stored.
- **Anti-Sabotage Verification:** Contributions are submitted through an encrypted Cloudflare Worker relay ([`relay/`](relay/)) and processed by an automated consensus engine ([`scripts/merge_contributions.py`](scripts/merge_contributions.py)). Conflicting or unverified answers are quarantined until consensus confirms their accuracy against official review keys.

### Optional shared AI fallback

The toolkit keeps a user's own Gemini key as the primary and fastest path. If
the user leaves **shared AI help** enabled in the toolkit and the personal key
is temporarily rate-limited, the relay may use a small project-managed pool.
Shared requests are bounded per installation and globally, and the relay
returns a clear capacity message instead of retrying indefinitely. This
best-effort fallback is not a guarantee of availability.

The current rollout does **not** upload or store user-provided Gemini keys.
Project-managed pool keys must be configured as Cloudflare Worker secrets
(`GEMINI_SHARED_KEY_1`, `GEMINI_SHARED_KEY_2`, and optionally
`GEMINI_SHARED_KEY_3`). Never place keys in this repository, GitHub issues,
workflow logs, browser storage, or database files. Dynamic user-key sharing
requires encrypted persistent storage and explicit revocation controls and is
not enabled by this lightweight rollout.

---

## Data Architecture & JSON Schema

Course databases are stored in [`data/`](data/) as structured JSON files named by subject code (e.g., `CS6204.json`):

```json
{
  "subjectCode": "CS6204",
  "subjectName": "Computer Architecture and Organization",
  "updatedAt": "2026-10-16T12:00:00Z",
  "totalQuestions": 177,
  "questions": [
    {
      "question": "Which component of the CPU is responsible for arithmetic and logic operations?",
      "type": "multichoice",
      "answers": ["Arithmetic Logic Unit (ALU)"],
      "choices": [
        "Control Unit",
        "Arithmetic Logic Unit (ALU)",
        "Instruction Register",
        "Memory Address Register"
      ],
      "verified": true,
      "source": "review_key"
    }
  ]
}
```

### Supported Question Formats:
* `multichoice`: Single-selection and multi-selection choices.
* `truefalse`: Standard boolean evaluations.
* `shortanswer`: Inline text answers with normalized casing.
* `match`: Matching pairs (`{ "prompt": "Row label", "answer": "Matching item" }`).
* `gapselect`: Dropdown cloze / fill-in selections.

---

## Repository Structure

- `data/`: Active course question banks in structured JSON format.
  - `data/verified/`: Official review key archives.
  - `data/community/`: Consensus-backed community contributions.
  - AMAUOED course snapshots: monthly refreshed, source-attributed suggestions kept unverified and separate from the primary course bank.
  - Jenny's Online course snapshots: monthly refreshed, source-attributed suggestions kept unverified and separate from the primary course bank.
- `docs/`: Technical specifications and architectural guides ([`docs/`](docs/)).
- `relay/`: Cloudflare Worker source code for secure, rate-limited anonymous submissions.
- `scripts/`: Automated anti-sabotage merge engine and validation utilities.

---

## Course Archives

<details>
<summary><b>View active subject archives (Click to expand)</b></summary>
<br>

| Subject Code | Course Title | Verified Questions | Status |
| :--- | :--- | :---: | :--- |
| `BAMM6301` | BAMM6301 | **59** | Active |
| `CS6200` | CS6200 | **24** | Active |
| `CS6204` | Computer Architecture and Organization | **186** | Active |
| `CS6205` | Automata Theory and Formal Languages | **169** | Active |
| `CS6206` | Principles of Operating Systems | **167** | Active |
| `CS6207` | CS6207 | **76** | Active |
| `CS6209` | Software Engineering 1 | **223** | Active |
| `CS6301` | Logic Design and Digital Computer Circuits | **187** | Active |
| `FILI6201` | FILI6201 | **150** | Active |
| `FILI6301` | FILI6301 | **253** | Active |
| `GE6301` | Gender and Society | **0** | Answer sharing disabled (non-reviewable) |
| `HMS6301` | HMS6301 | **10** | Active |
| `IT6200` | IT6200 | **19** | Active |
| `IT6201A` | Data Structures and Algorithm Analysis | **88** | Active |
| `IT6201B` | Data Structures and Algorithm Analysis | **117** | Active |
| `IT6205A` | Information Assurance and Security 1 | **126** | Active |
| `IT6206` | Information Assurance and Security 2 | **150** | Active |
| `IT6208` | System Integration and Architecture 1 | **117** | Active |
| `IT6209` | Introduction to Multimedia | **263** | Active |
| `IT6224B` | Data Communications and Networking 3 | **264** | Active |
| `IT6310` | Network Security | **179** | Active |
| `IT6314` | IT6314 | **295** | Active |
| `IT6322A` | Mobile Application Development | **90** | Active |
| `ITE6200` | Application Development and Emerging Technology | **170** | Active |
| `ITE6202` | ITE6202 | **214** | Active |
| `ITE6301` | Technopreneurship | **200** | Active |
| `MATH6100` | Calculus 1 | **87** | Active |
| `MATH6200` | MATH6200 | **150** | Active |
| `MKTG6256` | MKTG6256 | **54** | Active |
| `NSCI6100` | NSCI6100 | **154** | Active |
| `NSTP6102` | National Service Training Program 2 | **45** | Active |
| `OFAD6303A` | OFAD6303A | **22** | Active |
| `PHYED6102` | PHYED6102 | **63** | Active |
| `PHYED6106` | PHYED6106 | **168** | Active |
| `PHYED6200` | PHYED6200 | **8** | Active |

Course databases are stored in [`data/`](data/) as structured JSON files named by subject code (e.g., `CS6301.json`).

</details>

---

## Study-guide source snapshots and on-access refresh

With source-owner permission reported by the repository maintainer, the monthly
[`refresh-study-guides.yml`](.github/workflows/refresh-study-guides.yml) workflow
refreshes courses already represented by a primary `data/{SUBJECT}.json` file.
The toolkit also checks each source tier when a course is accessed. Fresh shared
snapshots are cached locally using the source's update timestamp; if a source
snapshot is missing or older than 30 days, the client uses a fresh local copy
while queuing a shared refresh, or discovers the source live if its local copy
is stale too. AMAUOED and Jenny suggestions remain separate and equally
unverified. Existing legacy AMAUOED tier files containing verified rows are
preserved rather than replaced by fresh unverified candidates.

The relay accepts only a course code plus a random installation identifier and
opens a deduplicated refresh-request issue. It does not accept or store scraped
questions from the browser. The
[`refresh-requested-study-guide.yml`](.github/workflows/refresh-requested-study-guide.yml)
workflow validates the request, fetches the public sources itself, and updates
the separate source-tier snapshots. A 15-minute client retry cooldown plus
per-installation and global relay rate limits reduce repeated requests. Failed
source requests preserve existing snapshots and leave the issue available for
retry.
The updated `relay/worker.js` must be deployed to Cloudflare for on-access
requests to reach this queue; until deployment, clients still perform source
lookups and cache results locally, but shared writes remain on the monthly job.

Jenny discovery uses Blogger's feed endpoint, not the `/search` path disallowed
by that site's `robots.txt`. Course requests are checked against existing
primary course files; unsupported or unknown course codes are rejected by the
refresh script. Manual monthly runs are available via `workflow_dispatch`.

---

## Forking & Self-Hosting Guide

If you want to host an independent question repository for your own university or study community:

### 1. Fork the Database Repository
Fork `Acads-Tools/database` to your own GitHub organization or account. Questions can be added manually or automatically as structured JSON files inside `data/{SUBJECT_CODE}.json`.

### 2. Configure the Cloudflare Worker Relay
The relay in `relay/` accepts anonymous contribution reports from students and opens issue tickets for the merge engine:
```bash
cd relay

# Edit wrangler.toml to set your repo owner and repo name
# Deploy the worker to your Cloudflare account
npx wrangler deploy
```

### 3. Automated Consensus Engine
Contributions submitted via the relay are processed by GitHub Actions running `scripts/merge_contributions.py`. Confirmed answers from official reviews are deduplicated and merged into `data/{SUBJECT_CODE}.json` automatically.

---

<a id="important-use-disclaimer"></a>

## Important Use Disclaimer

AMAES Study Database is an independent, unofficial study archive. It is **not affiliated with, endorsed by, sponsored by, or operated by** AMA Education System, ACLC College, or Moodle.

Use this repository and database only where permitted by your institution, instructor, assessment rules, and applicable law. Do not use it to cheat, impersonate another person, bypass access controls or proctoring, interfere with a service, or submit work that violates academic-integrity policies. You are solely responsible for your use of the database, your account, your data, and anything you submit through Moodle.

The repository data and scripts are provided **“as is” and “as available,”** without warranties or guarantees of any kind, including accuracy, availability, security, fitness for a particular purpose, or non-infringement. The developer and contributors are not responsible for lost data, service interruptions, account actions, academic outcomes, disciplinary action, legal claims, or other direct, indirect, incidental, or consequential losses arising from use or misuse.

Review the [Terms of Use](TERMS.md), [Security Policy](SECURITY.md), and [MIT License](LICENSE) before using or contributing to this project.

---

**Links:** [AMAES Toolkit Repository](https://github.com/Acads-Tools/amaes-toolkit) • [Quick Install Site](https://amaestoolkit.pages.dev/) • [Terms of Use](TERMS.md) • [Security Policy](SECURITY.md) • [Report an Issue](https://github.com/Acads-Tools/database/issues)
