# Repository Identity & Privacy Rules

## Mandatory Contributor Identity
When staging, committing, or pushing changes in this repository (`Acads-Tools/database`) or any connected repo:
- **Git Author & Committer**: Must ALWAYS be strictly and exclusively:
  - **Name:** `AcademicContributor`
  - **Email:** `academic-contributor@users.noreply.github.com`
- **Zero Personal Linkage**:
  - NEVER use personal names, personal email addresses, local system user accounts, or external usernames (e.g. `ractopen`, `ryme`, etc.).
  - Commits MUST be made using `--author="AcademicContributor <academic-contributor@users.noreply.github.com>"` and verified with `git config user.name "AcademicContributor"` and `git config user.email "academic-contributor@users.noreply.github.com"`.
- **Pre-Push Inspection**:
  - Always verify `git log -1` to confirm author is `AcademicContributor` before pushing to remote.
