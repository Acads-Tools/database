# Repository Security Rules

These rules apply to every file, commit, issue, pull request, release, workflow, website asset, and connected service used by this repository.

## Never commit sensitive information

Do not add or publish:

- Passwords, API keys, access tokens, private keys, cookies, session tokens, or credentials
- Moodle account information, student IDs, names, email addresses, grades, quiz attempts, or identifiable screenshots
- Personal data belonging to the repository owner, contributors, users, or third parties
- Private URLs, webhook URLs, database credentials, cloud-service secrets, or authentication headers
- Exported browser storage, `.env` files, private configuration, or debugging output containing sensitive values

Use placeholders such as `YOUR_TOKEN_HERE` and environment variables instead. Review staged changes before every commit and do not upload sensitive data to GitHub, GitHub Pages, releases, issue comments, or any other connected service.

## If information is exposed

Treat a suspected disclosure as compromised immediately:

1. Stop sharing or publishing the affected file, URL, screenshot, log, or artifact.
2. Revoke, rotate, or invalidate exposed credentials and sessions.
3. Remove the sensitive material from the active branch, releases, Pages artifacts, and connected services where possible.
4. Rewrite history when necessary; removing a file from the latest commit alone does not remove it from Git history.
5. Report the incident privately to the repository owner. Do not place live secrets or personal data in a public issue or pull request.

History rewriting does not guarantee that previously cloned, cached, or indexed copies are erased, so revocation is required even after removal.

## Safe data-sharing defaults

Any community or cloud sharing must remain anonymous and limited to the minimum question-and-answer evidence required by the feature. It must not intentionally transmit names, student IDs, passwords, Moodle session tokens, grades, account identifiers, or other personal information.

This policy is a repository safeguard, not a guarantee that every future change will be safe. Contributors are responsible for checking their changes before publishing them.
