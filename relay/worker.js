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

const UPDATE_URL = "https://raw.githubusercontent.com/Acads-Tools/amaes-toolkit/main/amaes-toolkit.user.js";
const LATEST_VERSION = "1.7.5";

function parseVersion(value) {
  const match = String(value || "").trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

function isSupportedVersion(version, minimum) {
  const actual = parseVersion(version);
  const required = parseVersion(minimum);
  if (!actual || !required) return false;
  for (let i = 0; i < 3; i += 1) {
    if (actual[i] !== required[i]) return actual[i] > required[i];
  }
  return true;
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-AMAES-Client-Version",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" || request.method === "HEAD") {
      if (path === "/version") {
        const minimumVersion = env.MIN_CLIENT_VERSION || LATEST_VERSION;
        return new Response(JSON.stringify({
          status: "ok",
          minimumVersion,
          latestVersion: LATEST_VERSION,
          updateUrl: UPDATE_URL
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
      }

      if (path === "/ping" || path === "/active") {
        return new Response(JSON.stringify({ status: "ok" }), {
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
        return new Response(JSON.stringify({
          status: "healthy",
          name: "amaes-community-relay",
          message: "AMAES Community Relay is operational",
          privacy: "No IP, client identifier, or active-user telemetry is collected.",
          links: {
            installer: "https://greasyfork.org/en/scripts/594744-amaes-toolkit",
            script: "https://raw.githubusercontent.com/Acads-Tools/amaes-toolkit/main/amaes-toolkit.user.js",
            website: "https://acads-tools.github.io/amaes-toolkit/",
            github: "https://github.com/Acads-Tools/amaes-toolkit",
            database: "https://github.com/Acads-Tools/database",
            logo: "https://raw.githubusercontent.com/Acads-Tools/amaes-toolkit/main/assets/amaes-toolkit-logo.png"
          },
          endpoints: {
            version: "/version",
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
      const clientVersion = request.headers.get("X-AMAES-Client-Version") || payload.clientVersion;
      const minimumVersion = env.MIN_CLIENT_VERSION || LATEST_VERSION;
      if (env.REQUIRE_CLIENT_VERSION === "true" &&
          (!clientVersion || !isSupportedVersion(clientVersion, minimumVersion))) {
        return new Response(JSON.stringify({
          error: "Client update required",
          minimumVersion,
          latestVersion: LATEST_VERSION,
          updateUrl: UPDATE_URL
        }), {
          status: 426,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

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

      const validQuestions = questions.filter(q => {
        if (!q) return false;
        const ans = (q.answer || q.ansRaw || '').trim();
        const que = (q.question || q.qRaw || '').trim();
        if (!ans || !que) return false;
        const wrongList = Array.isArray(q.wrongAnswers) ? q.wrongAnswers : [];
        const isWrong = wrongList.some(w => {
          const wText = typeof w === 'string' ? w.trim().toLowerCase() : (w.text || '').trim().toLowerCase();
          return wText && (wText === ans.toLowerCase() || ans.toLowerCase().includes(wText) || wText.includes(ans.toLowerCase()));
        });
        return !isWrong;
      });
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
          wrongAnswers: q.wrongAnswers || [],
          verified: Boolean(q.verified),
          isAiSuggestion: Boolean(q.isAiSuggestion || (q.source && String(q.source).toLowerCase().includes('gemini'))),
          source: q.source || payload.source || "community_contribution",
          evidenceType: q.evidenceType || payload.evidenceType || "community_report"
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
        const typeBadge = (q.isAiSuggestion || (q.source && String(q.source).toLowerCase().includes('gemini')))
          ? '✦ AI Suggestion'
          : (q.verified ? '✔ Verified' : 'Community');
        return `| ${idx + 1} | ${cleanQ} | **${cleanAns}** | ${typeBadge} |`;
      }).join('\n');

      const extraNote = validQuestions.length > 25
        ? `\n*... and ${validQuestions.length - 25} more verified questions in this submission.*\n`
        : '';

      const title = `✅ New answer contribution — ${subjectCode} — ${validQuestions.length} answer${validQuestions.length === 1 ? '' : 's'}`;
      const body = [
        `## New answer contribution: ${subjectCode}`,
        ``,
        `A student review supplied **${validQuestions.length} answer${validQuestions.length === 1 ? '' : 's'}** for the shared study database.`,
        `The automated validation pipeline will check the submission before anything is added to the database.`,
        ``,
        `### Summary`,
        `| Metric | Value |`,
        `| :--- | :--- |`,
        `| **Subject Code** | \`${subjectCode}\` |`,
        `| **Verified Answers** | \`${validQuestions.length}\` |`,
        `| **Source** | ${payload.source || "Automatic quiz review"} |`,
        `| **Received** | ${new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')} |`,
        ``,
        `### Answer preview`,
        `| # | Question | Answer | Type |`,
        `| :---: | :--- | :--- | :---: |`,
        questionRows,
        extraNote,
        ``,
        `### What happens next`,
        `1. Automated checks validate the subject, question format, duplicates, and answer evidence.`,
        `2. A pull request is created for the database change.`,
        `3. The privacy check and protected-branch rules run before merge.`,
        `4. This issue is closed automatically after a successful merge.`,
        ``,
        `<details>`,
        `<summary><b>Technical payload (for automation)</b></summary>`,
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
