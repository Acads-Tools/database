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

## Client compatibility and privacy

The relay requires `X-AMAES-Client-Version` to be at least `MIN_CLIENT_VERSION`
(`1.7.5` by default). Older clients receive `426 Upgrade Required` with the
official update URL. Keep the minimum version aligned with the first release
that supports the current payload and schema.

The relay does not collect IP addresses, client identifiers, active-user
counts, or presence telemetry. `/ping` is a stateless health response, and
`/version` exposes the current compatibility policy.

The current deployed policy is **1.7.5 or newer**. Keep
[CLIENT-COMPATIBILITY.md](https://github.com/Acads-Tools/amaes-toolkit/blob/main/CLIENT-COMPATIBILITY.md)
aligned with `MIN_CLIENT_VERSION` when changing the client, payload, or schema.
# Shared AI fallback

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

User-submitted keys are intentionally not stored or shared in this rollout.
Adding that capability requires encrypted persistent storage, revocation,
lease coordination, and a separate privacy/security review.
