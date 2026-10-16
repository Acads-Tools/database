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
| `ITE6200` | Application Development and Emerging Technology | **1** | Active |

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
