/**
 * AMAES Moodle Toolkit - Free Cloudflare Worker Serverless Relay
 *
 * Receives anonymous background answer payloads from students' userscripts,
 * validates against spam, and triggers automated database merge via GitHub Issues.
 *
 * Requirements in Cloudflare Worker Settings:
 * - Environment Variable (Secret): GITHUB_BOT_TOKEN (GitHub Personal Access Token with public_repo or issues:write)
 * - Environment Variable: REPO_OWNER = "Acads-Tools"
 * - Environment Variable: REPO_NAME = "database"
 */

/**
 * In-memory active peer registry per Cloudflare edge isolate.
 * Rolling window: 10 minutes (600,000 ms).
 */
const activePeerMap = new Map();

async function hashString(str) {
  const enc = new TextEncoder().encode(str + "_amaes_telemetry_salt");
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

function pruneAndCountActivePeers() {
  const now = Date.now();
  const threshold = now - 600000; // 10 minutes
  for (const [key, ts] of activePeerMap.entries()) {
    if (ts < threshold) {
      activePeerMap.delete(key);
    }
  }
  return Math.max(1, activePeerMap.size);
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // --- REAL 10-MINUTE TELEMETRY PING & ACTIVE USER TRACKING ---
    if (request.method === "GET" || (request.method === "POST" && (path === "/ping" || path === "/active"))) {
      if (path === "/ping") {
        const ip = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
        const cid = url.searchParams.get("cid") || "";
        const peerHash = await hashString(`${ip}:${cid}`);
        const now = Date.now();

        activePeerMap.set(peerHash, now);
        let activeCount = pruneAndCountActivePeers();

        if (env.TELEMETRY_KV) {
          try {
            await env.TELEMETRY_KV.put(`peer:${peerHash}`, now.toString(), { expirationTtl: 600 });
            const list = await env.TELEMETRY_KV.list({ prefix: "peer:" });
            if (list && list.keys) {
              activeCount = Math.max(activeCount, list.keys.length);
            }
          } catch (_) {}
        }

        return new Response(JSON.stringify({
          status: "ok",
          active: activeCount,
          windowMinutes: 10,
          timestamp: now
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
      }

      if (path === "/active") {
        let activeCount = pruneAndCountActivePeers();
        if (env.TELEMETRY_KV) {
          try {
            const list = await env.TELEMETRY_KV.list({ prefix: "peer:" });
            if (list && list.keys) {
              activeCount = Math.max(activeCount, list.keys.length);
            }
          } catch (_) {}
        }
        return new Response(JSON.stringify({
          status: "ok",
          active: activeCount,
          windowMinutes: 10
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
      }

      if (path === "/" || path === "/health" || path === "/status") {
        let activeCount = pruneAndCountActivePeers();
        if (env.TELEMETRY_KV) {
          try {
            const list = await env.TELEMETRY_KV.list({ prefix: "peer:" });
            if (list && list.keys) {
              activeCount = Math.max(activeCount, list.keys.length);
            }
          } catch (_) {}
        }

        const acceptHeader = request.headers.get("accept") || "";
        const wantsHtml = acceptHeader.includes("text/html") && url.searchParams.get("format") !== "json";

        if (wantsHtml) {
          const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AMAES Community Relay - Online &amp; Healthy</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚀</text></svg>">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #090d16;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #131b2e;
      border: 1px solid #1e293b;
      border-radius: 16px;
      max-width: 580px;
      width: 100%;
      padding: 32px;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }
    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.35);
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      color: #10b981;
    }
    .pulse-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
      70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 6px;
      letter-spacing: -0.02em;
    }
    p.subtitle {
      font-size: 14px;
      color: #94a3b8;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 24px;
    }
    .stat-box {
      background: #0b1120;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 14px 16px;
    }
    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      margin-bottom: 4px;
      font-weight: 600;
    }
    .stat-val {
      font-size: 20px;
      font-weight: 700;
      color: #38bdf8;
    }
    .stat-sub {
      font-size: 11px;
      color: #64748b;
      margin-top: 2px;
    }
    .btn-group {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 24px;
    }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 12px 18px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.2s ease;
      cursor: pointer;
    }
    .btn-primary {
      background: #3b82f6;
      color: #ffffff;
      border: 1px solid #2563eb;
    }
    .btn-primary:hover {
      background: #2563eb;
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: #1e293b;
      color: #cbd5e1;
      border: 1px solid #334155;
    }
    .btn-secondary:hover {
      background: #273549;
      color: #ffffff;
      transform: translateY(-1px);
    }
    .links-row {
      display: flex;
      gap: 12px;
      justify-content: center;
      padding-top: 16px;
      border-top: 1px solid #1e293b;
      font-size: 12px;
    }
    .links-row a {
      color: #94a3b8;
      text-decoration: none;
      transition: color 0.15s;
    }
    .links-row a:hover {
      color: #38bdf8;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="badge-status">
        <div class="pulse-dot"></div>
        <span>Online &amp; Healthy</span>
      </div>
    </div>
    <h1>AMAES Community Relay</h1>
    <p class="subtitle">Free serverless background mesh for real-time telemetry and anonymous question database verification for AMAES Moodle students.</p>

    <div class="stats-grid">
      <div class="stat-box">
        <div class="stat-label">Active Users</div>
        <div class="stat-val">${activeCount}</div>
        <div class="stat-sub">Past 10-minute window</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Edge Relay</div>
        <div class="stat-val" style="color: #10b981;">Cloudflare</div>
        <div class="stat-sub">Global low-latency</div>
      </div>
    </div>

    <div class="btn-group">
      <a class="btn btn-primary" href="https://greasyfork.org/en/scripts/594744-amaes-toolkit" target="_blank" rel="noopener noreferrer">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Install via Greasy Fork
      </a>
      <a class="btn btn-secondary" href="https://raw.githubusercontent.com/Acads-Tools/amaes-toolkit/main/amaes-toolkit.user.js" target="_blank" rel="noopener noreferrer">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
        Direct Install (Tampermonkey)
      </a>
      <a class="btn btn-secondary" href="https://acads-tools.github.io/amaes-toolkit/" target="_blank" rel="noopener noreferrer">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        Official Website &amp; Docs
      </a>
    </div>

    <div class="links-row">
      <a href="https://github.com/Acads-Tools/amaes-toolkit" target="_blank" rel="noopener noreferrer">GitHub Repository</a>
      <span>•</span>
      <a href="https://github.com/Acads-Tools/database" target="_blank" rel="noopener noreferrer">Question Database</a>
      <span>•</span>
      <a href="/ping">API Ping</a>
    </div>
  </div>
</body>
</html>`;
          return new Response(html, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-cache"
            }
          });
        }

        return new Response(JSON.stringify({
          status: "healthy",
          state: "online",
          relay: "AMAES Moodle Toolkit Serverless Relay",
          activeUsers: activeCount,
          telemetryWindowMinutes: 10,
          endpoints: {
            ping: "/ping",
            active: "/active",
            submit: "POST /"
          },
          links: {
            site: "https://acads-tools.github.io/amaes-toolkit/",
            install: "https://greasyfork.org/en/scripts/594744-amaes-toolkit",
            rawScript: "https://raw.githubusercontent.com/Acads-Tools/amaes-toolkit/main/amaes-toolkit.user.js",
            github: "https://github.com/Acads-Tools/amaes-toolkit",
            database: "https://github.com/Acads-Tools/database"
          }
        }, null, 2), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Only POST requests are accepted for question submissions" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const payload = await request.json();

      const subjectCode = (payload.subjectCode || payload.subject || "").trim().toUpperCase();
      if (!subjectCode || !/^[A-Z0-9_-]{2,16}$/.test(subjectCode)) {
        return new Response(JSON.stringify({ error: "Invalid subject code format" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      const questions = payload.questions;
      if (!Array.isArray(questions) || questions.length === 0) {
        return new Response(JSON.stringify({ error: "Payload questions array cannot be empty" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      const validQuestions = questions.filter(q => q && (q.answer || q.ansRaw) && (q.question || q.qRaw));
      if (validQuestions.length === 0) {
        return new Response(JSON.stringify({ error: "No verified answers found in payload" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      const repoOwner = env.REPO_OWNER || "Acads-Tools";
      const repoName = env.REPO_NAME || "database";
      const botToken = env.GITHUB_BOT_TOKEN;

      if (!botToken) {
        return new Response(JSON.stringify({ error: "Relay server is missing GitHub token configuration" }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      const issuePayload = {
        subjectCode: subjectCode,
        totalQuestions: validQuestions.length,
        source: payload.source || "background_harvester",
        submittedAt: new Date().toISOString(),
        questions: validQuestions.map(q => ({
          question: q.question || q.qRaw,
          answer: q.answer || q.ansRaw,
          choices: q.choices || [],
          wrongAnswers: q.wrongAnswers || []
        }))
      };

      const title = `[Contribution] Auto-Sync for ${subjectCode} (${validQuestions.length} verified answers)`;
      const body = `### Community Contribution Payload\n\n\`\`\`json\n${JSON.stringify(issuePayload, null, 2)}\n\`\`\``;

      const ghResponse = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/issues`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${botToken}`,
          "User-Agent": "AMAES-Cloudflare-Relay",
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title,
          body: body,
          labels: ["community-contribution", "automated-sync"]
        })
      });

      if (!ghResponse.ok) {
        const ghErr = await ghResponse.text();
        return new Response(JSON.stringify({ error: "GitHub API error", details: ghErr }), {
          status: ghResponse.status,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      const issueData = await ghResponse.json();

      return new Response(JSON.stringify({
        success: true,
        issueNumber: issueData.number,
        issueUrl: issueData.html_url,
        count: validQuestions.length,
        subjectCode: subjectCode
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: "Internal server error", details: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
  }
};
