# Free Background Serverless Relay (Cloudflare Worker)

Enables zero-friction, background submission of verified answers directly from students' userscripts without requiring students to log in, create a GitHub account, or configure a PAT.

## 2-Minute Deployment Guide (100% Free)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) and navigate to **Workers & Pages** -> **Create Application** -> **Create Worker**.
2. Name it `amaes-community-relay` and click **Deploy**.
3. Click **Quick Edit** on the worker and paste the code from `worker.js`.
4. Go to **Settings** -> **Variables and Secrets**:
   - Add a secret: `GITHUB_BOT_TOKEN` = `<your_github_token_with_repo_or_issues_permission>`
   - Add a variable: `REPO_OWNER` = `Acads-Tools`
   - Add a variable: `REPO_NAME` = `database`
5. Save & Deploy.
6. Copy the worker URL (e.g., `https://amaes-community-relay.<your-subdomain>.workers.dev`).
7. Paste this URL into the userscript's `COMMUNITY_RELAY_URL` constant.
8. Optional: configure the project-managed shared AI pool with `wrangler secret put`
   for `GEMINI_SHARED_KEY_1`, `GEMINI_SHARED_KEY_2`, and `GEMINI_SHARED_KEY_3`,
   then deploy again. Do not put these values in this repository or in the userscript.

## Client compatibility and privacy

The relay requires `X-AMAES-Client-Version` to be at least `MIN_CLIENT_VERSION`
(`1.7.5` by default). Older clients receive `426 Upgrade Required` with the
official update URL. Keep the minimum version aligned with the first release
that supports the current payload and schema.

The relay does not collect IP addresses, client identifiers, active-user
counts, or presence telemetry. `/ping` is a stateless health response, and
`/version` exposes the current compatibility policy.

The current deployed policy is **1.7.5 or newer**, with toolkit release **1.7.6**. Keep
[CLIENT-COMPATIBILITY.md](https://github.com/Acads-Tools/amaes-toolkit/blob/main/CLIENT-COMPATIBILITY.md)
aligned with `MIN_CLIENT_VERSION` when changing the client, payload, or schema.
# Shared AI fallback and opt-in contributor key sharing

The relay exposes `POST /ai` for the toolkit's explicit shared-AI fallback.
The client must opt in locally; the personal Gemini key is always attempted
first and is never sent to this endpoint.

Configure the optional project-managed pool as Wrangler secrets:

```sh
wrangler secret put GEMINI_SHARED_KEY_1
wrangler secret put GEMINI_SHARED_KEY_2
wrangler secret put GEMINI_SHARED_KEY_3
```

The relay enforces a small per-installation burst limit, a global in-memory
window limit, provider-key cooldowns, request-size limits, supported-client
validation, and bounded provider calls. Application code does not log prompts,
API keys, or provider responses. Shared capacity is best-effort: if no key is
configured, rate-limited, or available, the client receives a readable retry
message. The free-tier-safe starting ceiling is 20 shared requests per Worker
isolate per minute, with one request per installation per minute.

The opt-in contributor system is available when a D1 binding and
`GEMINI_KEY_ENCRYPTION_SECRET` are configured. It is deliberately fail-closed
when either is absent.

## Contributor key sharing

Create the D1 database and apply migrations before deploying:

```sh
wrangler d1 create amaes-community-relay
wrangler d1 migrations apply amaes-community-relay
wrangler secret put GEMINI_KEY_ENCRYPTION_SECRET
```

Set the returned database ID in `wrangler.toml`. The secret is used only to
derive an AES-GCM encryption key; Gemini keys are encrypted before D1 storage.
The relay never logs, returns, or sends a stored Gemini key except as the
provider authentication header for the selected request.

Registration requires:

* `consent: true` as explicit opt-in;
* a valid Gemini key;
* a separate, random owner token (at least 32 characters), supplied by the
  client and retained locally; and
* one mode: `private`, `contributor`, or `community`.

Example request shape (do not put real secrets in documentation or logs):

```json
{
  "geminiKey": "<user-supplied-key>",
  "consent": true,
  "mode": "contributor"
}
```

Send the separate random owner token only in the
`X-AMAES-Owner-Token` header; it is never accepted in the request body.
`POST /keys/register` returns only a generated `keyId`, never the Gemini key
or owner token. Use `POST /keys/activity`, `/keys/revoke`, and `/keys/delete`
with `X-AMAES-Owner-Token` to manage the key. Activity renews a 20-minute
lease; a further 20-minute grace period prevents abrupt expiry. Inactive keys
are automatically deleted after 30 days by the scheduled handler.

`POST /ai` accepts `mode: "private"`, `"contributor"`, or `"community"` for
the D1-backed pool. Private and contributor requests require the key ID and
owner token. Community requests select an active contributor/community key.
Per-key and per-owner minute quotas are enforced in D1, along with daily
limits of 100 owner requests, 20 community requests per contributor key, and
10 community requests per community-only key. Each key also has one
in-flight reservation at a time; reservations are released on success,
provider failure, and decryption failure. Provider failures temporarily
quarantine the key. If contributor configuration is
missing, the D1 routes fail closed; the existing project-managed fallback
continues to work independently when its Wrangler secrets are configured.
