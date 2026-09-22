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
    if (request.method === "GET" || request.method === "HEAD" || (request.method === "POST" && (path === "/ping" || path === "/active"))) {
      if (path === "/ping" || path === "/active") {
        const ip = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
        const cid = url.searchParams.get("cid") || "";
        const now = Date.now();
        let peerHash = null;

        // Register client session whenever cid is provided or on explicit ping
        if (cid || path === "/ping") {
          peerHash = await hashString(`${ip}:${cid}`);
          activePeerMap.set(peerHash, now);
        }

        let activeCount = pruneAndCountActivePeers();

        if (env.TELEMETRY_KV) {
          try {
            if (peerHash) {
              await env.TELEMETRY_KV.put(`peer:${peerHash}`, now.toString(), { expirationTtl: 600 });
            }
            const list = await env.TELEMETRY_KV.list({ prefix: "peer:" });
            if (list && list.keys) {
              activeCount = Math.max(activeCount, list.keys.length);
            }
          } catch (_) {}
        }

        return new Response(JSON.stringify({
          status: "ok",
          active: Math.max(1, activeCount),
          windowMinutes: 10,
          timestamp: now
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
      }

      if (path === "/favicon.ico" || path === "/favicon.png") {
        const logoUrl = "https://raw.githubusercontent.com/Acads-Tools/amaes-toolkit/main/assets/amaes-toolkit-logo.png";
        try {
          const res = await fetch(logoUrl, { cf: { cacheTtl: 604800, cacheEverything: true } });
          if (res.ok) {
            return new Response(res.body, {
              status: 200,
              headers: {
                ...corsHeaders,
                "Content-Type": "image/png",
                "Cache-Control": "public, max-age=604800, immutable"
              }
            });
          }
        } catch (_) {}
        return Response.redirect(logoUrl, 302);
      }

      if (path === "/health") {
        return new Response(JSON.stringify({ status: "ok", healthy: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-cache" }
        });
      }

      if (path === "/" || path === "/status") {
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
          status: "healthy",
          name: "amaes-community-relay",
          message: "AMAES Community Relay is operational",
          active_users: activeCount,
          telemetry_window_minutes: 10,
          links: {
            installer: "https://greasyfork.org/en/scripts/594744-amaes-toolkit",
            script: "https://raw.githubusercontent.com/Acads-Tools/amaes-toolkit/main/amaes-toolkit.user.js",
            website: "https://acads-tools.github.io/amaes-toolkit/",
            github: "https://github.com/Acads-Tools/amaes-toolkit",
            database: "https://github.com/Acads-Tools/database",
            logo: "https://raw.githubusercontent.com/Acads-Tools/amaes-toolkit/main/assets/amaes-toolkit-logo.png"
          },
          endpoints: {
            ping: "/ping",
            active: "/active",
            submit: "POST /"
          }
        }, null, 2), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" }
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

      // Generate clean, human-readable markdown preview table
      const questionRows = validQuestions.slice(0, 25).map((q, idx) => {
        const cleanQ = (q.question || q.qRaw || '')
          .replace(/\r?\n/g, ' ')
          .replace(/\|/g, '\\|')
          .slice(0, 120);
        const cleanAns = (q.answer || q.ansRaw || '')
          .replace(/\r?\n/g, ' ')
          .replace(/\|/g, '\\|')
          .slice(0, 80);
        return `| ${idx + 1} | ${cleanQ} | **${cleanAns}** |`;
      }).join('\n');

      const extraNote = validQuestions.length > 25
        ? `\n*... and ${validQuestions.length - 25} more verified questions in this submission.*\n`
        : '';

      const title = `[Contribution] Auto-Sync for ${subjectCode} (${validQuestions.length} verified answers)`;
      const body = [
        `## 🎓 Community Contribution: \`${subjectCode}\``,
        ``,
        `### 📊 Submission Overview`,
        `| Metric | Value |`,
        `| :--- | :--- |`,
        `| **Subject Code** | \`${subjectCode}\` |`,
        `| **Verified Answers** | \`${validQuestions.length}\` |`,
        `| **Submission Source** | \`${payload.source || "background_harvester"}\` |`,
        `| **Timestamp (UTC)** | \`${new Date().toISOString()}\` |`,
        ``,
        `### 📝 Verified Questions Preview`,
        `| # | Question | Verified Answer |`,
        `| :---: | :--- | :--- |`,
        questionRows,
        extraNote,
        ``,
        `<details>`,
        `<summary><b>📦 Machine-Readable Payload (JSON)</b></summary>`,
        ``,
        `\`\`\`json`,
        JSON.stringify(issuePayload, null, 2),
        `\`\`\``,
        `</details>`
      ].join('\n');

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
