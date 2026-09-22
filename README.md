# AMAES Study Database

A verified, open-source question bank and study archive powering the [AMAES Toolkit](https://github.com/Acads-Tools/amaes-toolkit). All question entries are validated against official assessment reviews, deduplicated, and maintained for self-paced study and practice.

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
| `CS6204` | Computer Architecture and Organization | **108** | Active |
| `CS6205` | Automata Theory and Formal Languages | **12** | Active |
| `CS6206` | Principles of Operating Systems | **165** | Active |
| `CS6301` | Logic Design and Digital Computer Circuits | **155** | Active |
| `IT6205A` | IT6205A | **37** | Active |
| `IT6206` | IT6206 | **118** | Active |
| `IT6208` | IT6208 | **101** | Active |
| `IT6310` | IT6310 | **47** | Active |
| `IT6322A` | IT6322A | **61** | Active |
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
