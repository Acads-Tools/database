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

      if (path === "/") {
        const activeCount = pruneAndCountActivePeers();
        return new Response(JSON.stringify({
          status: "online",
          relay: "AMAES Moodle Toolkit Serverless Relay",
          activeUsers: activeCount,
          telemetryWindowMinutes: 10
        }), {
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
