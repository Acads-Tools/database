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
