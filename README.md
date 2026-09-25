# AMAES Study Database

A verified, open-source question bank and study archive powering the [AMAES Toolkit](https://github.com/Acads-Tools/amaes-toolkit). All question entries are validated against official assessment reviews, deduplicated, and maintained for self-paced study and practice.

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

## Repository Structure

- `data/`: Active course question banks in structured JSON format.
  - `data/verified/`: Official review key archives.
  - `data/community/`: Consensus-backed community contributions.
  - `data/amauoed/`: Scraped study guide references.
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
| `CS6204` | Computer Architecture and Organization | **110** | Active |
| `CS6205` | Automata Theory and Formal Languages | **31** | Active |
| `CS6206` | Principles of Operating Systems | **165** | Active |
| `CS6301` | Logic Design and Digital Computer Circuits | **155** | Active |
| `GE6301` | GE6301 | **50** | Active |
| `IT6205A` | Information Assurance and Security 1 | **37** | Active |
| `IT6206` | Information Assurance and Security 2 | **118** | Active |
| `IT6208` | System Integration and Architecture 1 | **104** | Active |
| `IT6209` | Introduction to Multimedia | **100** | Active |
| `IT6224B` | Data Communications and Networking 3 | **128** | Active |
| `IT6310` | Network Security | **109** | Active |
| `IT6322A` | Mobile Application Development | **61** | Active |
| `ITE6202` | ITE6202 | **42** | Active |
| `ITE6301` | Technopreneurship | **188** | Active |

Course databases are stored in [`data/`](data/) as structured JSON files named by subject code (e.g., `CS6301.json`).

</details>

---

<a id="important-use-disclaimer"></a>

## Important Use Disclaimer

AMAES Study Database is an independent, unofficial study archive. It is **not affiliated with, endorsed by, sponsored by, or operated by** AMA Education System, ACLC College, or Moodle.

Use this repository and database only where permitted by your institution, instructor, assessment rules, and applicable law. Do not use it to cheat, impersonate another person, bypass access controls or proctoring, interfere with a service, or submit work that violates academic-integrity policies. You are solely responsible for your use of the database, your account, your data, and anything you submit through Moodle.

The repository data and scripts are provided **“as is” and “as available,”** without warranties or guarantees of any kind, including accuracy, availability, security, fitness for a particular purpose, or non-infringement. The developer and contributors are not responsible for lost data, service interruptions, account actions, academic outcomes, disciplinary action, legal claims, or other direct, indirect, incidental, or consequential losses arising from use or misuse.

Review the [Terms of Use](TERMS.md), [Security Policy](SECURITY.md), and [MIT License](LICENSE) before using or contributing to this project.

---

**Links:** [AMAES Toolkit Repository](https://github.com/Acads-Tools/amaes-toolkit) • [Quick Install Site](https://acads-tools.github.io/amaes-toolkit/) • [Terms of Use](TERMS.md) • [Security Policy](SECURITY.md) • [Report an Issue](https://github.com/Acads-Tools/database/issues)
