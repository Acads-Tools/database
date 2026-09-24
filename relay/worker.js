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
const LATEST_VERSION = "1.7.9";
const SHARED_POOL_WINDOW_MS = 60_000;
const SHARED_POOL_MAX_REQUESTS_PER_INSTALLATION = 1;
const SHARED_POOL_MAX_REQUESTS_GLOBAL = 20;
const SHARED_POOL_KEY_COOLDOWN_MS = 30_000;
const CONTRIBUTOR_LEASE_MS = 20 * 60 * 1000;
const CONTRIBUTOR_GRACE_MS = 20 * 60 * 1000;
const CONTRIBUTOR_WINDOW_MS = 60 * 1000;
const CONTRIBUTOR_DAY_MS = 24 * 60 * 60 * 1000;
const CONTRIBUTOR_MAX_REQUESTS_PER_KEY = 5;
const CONTRIBUTOR_MAX_REQUESTS_PER_OWNER = 10;
const CONTRIBUTOR_OWNER_DAILY_LIMIT = 100;
const CONTRIBUTOR_KEY_DAILY_LIMIT = 20;
const COMMUNITY_KEY_DAILY_LIMIT = 10;
const CONTRIBUTOR_MAX_IN_FLIGHT_PER_KEY = 1;
const CONTRIBUTOR_MAX_PROMPT_LENGTH = 12_000;
const sharedPoolState = {
  windowStartedAt: 0,
  globalRequests: 0,
  installationRequests: new Map(),
  keyCooldowns: new Map()
};

function jsonResponse(body, status, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function sharedPoolKeys(env) {
  return [env.GEMINI_SHARED_KEY_1, env.GEMINI_SHARED_KEY_2, env.GEMINI_SHARED_KEY_3]
    .map(key => String(key || "").trim())
    .filter(Boolean);
}

function resetSharedPoolWindow(now) {
  if (now - sharedPoolState.windowStartedAt < SHARED_POOL_WINDOW_MS) return;
  sharedPoolState.windowStartedAt = now;
  sharedPoolState.globalRequests = 0;
  sharedPoolState.installationRequests.clear();
}

function reserveSharedPoolRequest(installationId, keyCount) {
  const now = Date.now();
  resetSharedPoolWindow(now);
  if (!keyCount || sharedPoolState.globalRequests >= SHARED_POOL_MAX_REQUESTS_GLOBAL) {
    return { ok: false, reason: "shared_capacity" };
  }
  const current = sharedPoolState.installationRequests.get(installationId) || 0;
  if (current >= SHARED_POOL_MAX_REQUESTS_PER_INSTALLATION) {
    return { ok: false, reason: "user_burst_limit" };
  }
  sharedPoolState.installationRequests.set(installationId, current + 1);
  sharedPoolState.globalRequests += 1;
  return { ok: true };
}

function chooseSharedPoolKey(keys) {
  const now = Date.now();
  return keys.find(key => (sharedPoolState.keyCooldowns.get(key) || 0) <= now) || null;
}

function quarantineSharedPoolKey(key) {
  sharedPoolState.keyCooldowns.set(key, Date.now() + SHARED_POOL_KEY_COOLDOWN_MS);
}

function contributorConfigAvailable(env) {
  return Boolean(env.DB && String(env.GEMINI_KEY_ENCRYPTION_SECRET || "").trim());
}

function bytesToBase64(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function encryptionKey(env) {
  const secret = new TextEncoder().encode(String(env.GEMINI_KEY_ENCRYPTION_SECRET || ""));
  const digest = await crypto.subtle.digest("SHA-256", secret);
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptContributorKey(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(env);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return { encryptedKey: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) };
}

async function decryptContributorKey(row, env) {
  const key = await encryptionKey(env);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(row.iv) },
    key,
    base64ToBytes(row.encrypted_key)
  );
  return new TextDecoder().decode(plaintext);
}

async function hashOwnerToken(ownerToken) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ownerToken));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function contributorOwnerToken(request) {
  const token = request.headers.get("X-AMAES-Owner-Token") || "";
  return token.length >= 32 && token.length <= 256 ? token : "";
}

function contributorMode(value) {
  return ["contributor", "private", "community"].includes(value) ? value : "";
}

function contributorLeaseValid(row, now = Date.now()) {
  const lease = Date.parse(row.lease_until || "");
  return Number.isFinite(lease) && now <= lease + CONTRIBUTOR_GRACE_MS;
}

function contributorAvailableToCommunity(row, now = Date.now()) {
  const lease = Date.parse(row.lease_until || "");
  return Number.isFinite(lease) && now > lease + CONTRIBUTOR_GRACE_MS;
}

function contributorKeyQuarantined(keyId) {
  return (sharedPoolState.keyCooldowns.get(`contributor:${keyId}`) || 0) > Date.now();
}

async function registerContributorKey(request, env, corsHeaders) {
  if (!contributorConfigAvailable(env)) {
    return jsonResponse({ error: "Contributor key sharing is not configured" }, 503, corsHeaders);
  }
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 2_048) {
    return jsonResponse({ error: "Contributor registration request is too large" }, 413, corsHeaders);
  }
  let payload;
  try { payload = await request.json(); } catch (_) {
    return jsonResponse({ error: "Invalid JSON request" }, 400, corsHeaders);
  }
  const geminiKey = typeof payload.geminiKey === "string" ? payload.geminiKey.trim() : "";
  const ownerToken = contributorOwnerToken(request);
  const mode = contributorMode(payload.mode);
  if (payload.consent !== true || !geminiKey || geminiKey.length > 512 ||
      !/^AIza[0-9A-Za-z_-]{20,}$/.test(geminiKey) ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(ownerToken) || !mode) {
    return jsonResponse({ error: "Explicit consent, a valid Gemini key, owner token, and mode are required" }, 400, corsHeaders);
  }
  try {
    const now = new Date().toISOString();
    const keyId = crypto.randomUUID();
    const ownerHash = await hashOwnerToken(ownerToken);
    const encrypted = await encryptContributorKey(geminiKey, env);
    await env.DB.prepare(
      `INSERT INTO contributor_gemini_keys
       (key_id, owner_hash, encrypted_key, iv, mode, consented_at, created_at, updated_at,
        last_activity_at, lease_until, key_window_started_at, owner_window_started_at,
        daily_window_started_at, daily_community_count, in_flight_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      keyId, ownerHash, encrypted.encryptedKey, encrypted.iv, mode, now, now, now, now,
      new Date(Date.now() + CONTRIBUTOR_LEASE_MS).toISOString(), now, now, now, 0, 0
    ).run();
    return jsonResponse({ success: true, keyId, mode, leaseMinutes: 20 }, 201, corsHeaders);
  } catch (_) {
    return jsonResponse({ error: "Contributor key registration failed" }, 503, corsHeaders);
  }
}

async function updateContributorActivity(request, env, corsHeaders, action) {
  if (!contributorConfigAvailable(env)) {
    return jsonResponse({ error: "Contributor key sharing is not configured" }, 503, corsHeaders);
  }
  let payload;
  try { payload = await request.json(); } catch (_) {
    return jsonResponse({ error: "Invalid JSON request" }, 400, corsHeaders);
  }
  const keyId = typeof payload.keyId === "string" ? payload.keyId.trim() : "";
  const ownerToken = contributorOwnerToken(request);
  if (!keyId || !/^[0-9a-f-]{36}$/i.test(keyId) || !/^[A-Za-z0-9_-]{32,256}$/.test(ownerToken)) {
    return jsonResponse({ error: "Valid key ID and owner token are required" }, 400, corsHeaders);
  }
  try {
    const ownerHash = await hashOwnerToken(ownerToken);
    const now = new Date().toISOString();
    const result = action === "revoke"
      ? await env.DB.prepare(
        "UPDATE contributor_gemini_keys SET revoked_at = ?, updated_at = ? WHERE key_id = ? AND owner_hash = ? AND revoked_at IS NULL"
      ).bind(now, now, keyId, ownerHash).run()
      : action === "delete"
        ? await env.DB.prepare(
          "DELETE FROM contributor_gemini_keys WHERE key_id = ? AND owner_hash = ?"
        ).bind(keyId, ownerHash).run()
        : await env.DB.prepare(
          "UPDATE contributor_gemini_keys SET last_activity_at = ?, lease_until = ?, updated_at = ? WHERE key_id = ? AND owner_hash = ? AND revoked_at IS NULL"
        ).bind(now, new Date(Date.now() + CONTRIBUTOR_LEASE_MS).toISOString(), now, keyId, ownerHash).run();
    if (!result.meta || result.meta.changes !== 1) return jsonResponse({ error: "Contributor key not found" }, 404, corsHeaders);
    return jsonResponse({ success: true }, 200, corsHeaders);
  } catch (_) {
    return jsonResponse({ error: "Contributor key operation failed" }, 503, corsHeaders);
  }
}

async function reserveContributorQuota(env, row, ownerHash, requestMode) {
  const now = Date.now();
  const window = new Date(now).toISOString();
  const keyWindowStart = Date.parse(row.key_window_started_at || "");
  const keyWindowReset = !Number.isFinite(keyWindowStart) || now - keyWindowStart >= CONTRIBUTOR_WINDOW_MS;
  const keyWindowCount = keyWindowReset ? 0 : Number(row.key_window_count || 0);
  const dayStart = Date.parse(row.daily_window_started_at || "");
  const keyDailyReset = !Number.isFinite(dayStart) || now - dayStart >= CONTRIBUTOR_DAY_MS;
  const keyDailyLimit = row.mode === "community" ? COMMUNITY_KEY_DAILY_LIMIT : CONTRIBUTOR_KEY_DAILY_LIMIT;
  const keyResult = await env.DB.prepare(
    `UPDATE contributor_gemini_keys
     SET in_flight_count = in_flight_count + 1,
         key_window_started_at = CASE WHEN ? THEN ? ELSE key_window_started_at END,
         key_window_count = CASE WHEN ? THEN 1 ELSE key_window_count + 1 END,
         daily_window_started_at = CASE WHEN ? THEN ? ELSE daily_window_started_at END,
         daily_community_count = CASE
           WHEN ? AND ? THEN 1
           WHEN ? THEN daily_community_count + 1
           ELSE daily_community_count
         END,
         updated_at = ?
     WHERE key_id = ? AND revoked_at IS NULL
       AND in_flight_count < ?
       AND (? OR key_window_count < ?)
       AND (? OR daily_community_count < ?)`
  ).bind(
    keyWindowReset, window, keyWindowReset,
    requestMode === "community", window,
    requestMode === "community", keyDailyReset, requestMode === "community",
    window,
    row.key_id, CONTRIBUTOR_MAX_IN_FLIGHT_PER_KEY,
    keyWindowReset || keyWindowCount < CONTRIBUTOR_MAX_REQUESTS_PER_KEY, CONTRIBUTOR_MAX_REQUESTS_PER_KEY,
    requestMode !== "community" || keyDailyReset, keyDailyLimit
  ).run();
  if (!keyResult.meta || keyResult.meta.changes !== 1) return false;

  if (requestMode === "community") return true;

  await env.DB.prepare(
    `INSERT INTO contributor_owner_usage(owner_hash, window_started_at, window_count, daily_window_started_at, daily_count)
     VALUES (?, ?, 1, ?, 1)
     ON CONFLICT(owner_hash) DO NOTHING`
  ).bind(ownerHash, window, window).run();
  const ownerRow = await env.DB.prepare(
    "SELECT window_started_at, window_count, daily_window_started_at, daily_count FROM contributor_owner_usage WHERE owner_hash = ?"
  ).bind(ownerHash).first();
  const ownerMinuteStart = Date.parse(ownerRow?.window_started_at || "");
  const ownerMinuteReset = !Number.isFinite(ownerMinuteStart) || now - ownerMinuteStart >= CONTRIBUTOR_WINDOW_MS;
  const ownerStart = Date.parse(ownerRow?.daily_window_started_at || "");
  const ownerReset = !Number.isFinite(ownerStart) || now - ownerStart >= CONTRIBUTOR_DAY_MS;
  const ownerResult = await env.DB.prepare(
    `UPDATE contributor_owner_usage
     SET window_started_at = CASE WHEN ? THEN ? ELSE window_started_at END,
         window_count = CASE WHEN ? THEN 1 ELSE window_count + 1 END,
         daily_window_started_at = CASE WHEN ? THEN ? ELSE daily_window_started_at END,
         daily_count = CASE WHEN ? THEN 1 ELSE daily_count + 1 END
     WHERE owner_hash = ?
       AND (? OR window_count < ?)
       AND (? OR daily_count < ?)`
  ).bind(
    ownerMinuteReset, window, ownerMinuteReset,
    ownerReset, window, ownerReset,
    ownerHash,
    ownerMinuteReset, CONTRIBUTOR_MAX_REQUESTS_PER_OWNER,
    ownerReset, CONTRIBUTOR_OWNER_DAILY_LIMIT
  ).run();
  if (!ownerResult.meta || ownerResult.meta.changes !== 1) {
    await releaseContributorReservation(env, row.key_id);
    return false;
  }
  return true;
}

async function releaseContributorReservation(env, keyId) {
  await env.DB.prepare(
    "UPDATE contributor_gemini_keys SET in_flight_count = CASE WHEN in_flight_count > 0 THEN in_flight_count - 1 ELSE 0 END, updated_at = ? WHERE key_id = ?"
  ).bind(new Date().toISOString(), keyId).run();
}

async function contributorAiRequest(request, env, corsHeaders) {
  if (!contributorConfigAvailable(env)) {
    return jsonResponse({ error: "Contributor key sharing is not configured" }, 503, corsHeaders);
  }
  let payload;
  try { payload = await request.json(); } catch (_) {
    return jsonResponse({ error: "Invalid JSON request" }, 400, corsHeaders);
  }
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  const mode = contributorMode(payload.mode) || "community";
  const keyId = typeof payload.keyId === "string" ? payload.keyId.trim() : "";
  const ownerToken = contributorOwnerToken(request);
  if (!prompt || prompt.length > CONTRIBUTOR_MAX_PROMPT_LENGTH) {
    return jsonResponse({ error: "Invalid shared AI request" }, 400, corsHeaders);
  }
  try {
    const ownerHash = ownerToken ? await hashOwnerToken(ownerToken) : "";
    let row;
    if (mode === "private" || mode === "contributor") {
      if (!keyId || !ownerHash) return jsonResponse({ error: "Owner authentication is required for this mode" }, 401, corsHeaders);
      row = await env.DB.prepare(
        "SELECT * FROM contributor_gemini_keys WHERE key_id = ? AND owner_hash = ? AND revoked_at IS NULL"
      ).bind(keyId, ownerHash).first();
    } else {
      const candidates = await env.DB.prepare(
        `SELECT * FROM contributor_gemini_keys
         WHERE mode IN ('contributor', 'community') AND revoked_at IS NULL
           AND lease_until < ?
         ORDER BY last_activity_at DESC LIMIT 20`
      ).bind(new Date(Date.now() - CONTRIBUTOR_GRACE_MS).toISOString()).all();
      row = (candidates.results || []).find(candidate => !contributorKeyQuarantined(candidate.key_id));
    }
    if (!row || contributorKeyQuarantined(row.key_id) || (mode === "community"
      ? !contributorAvailableToCommunity(row)
      : !contributorLeaseValid(row))) {
      return jsonResponse({ error: "No active contributor capacity is available", retryable: true }, 503, corsHeaders);
    }
    if (mode === "private" && row.mode !== "private") return jsonResponse({ error: "Private key mode is unavailable for this key" }, 403, corsHeaders);
    if (mode === "contributor" && row.mode !== "contributor") return jsonResponse({ error: "Contributor mode is unavailable for this key" }, 403, corsHeaders);
    if (!await reserveContributorQuota(env, row, row.owner_hash, mode)) {
      return jsonResponse({ error: "Contributor AI quota is temporarily unavailable", retryable: true }, 429, corsHeaders);
    }
    try {
      const key = await decryptContributorKey(row, env);
      const model = env.GEMINI_SHARED_MODEL || "gemini-1.5-flash";
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 64 } }),
          signal: request.signal
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        sharedPoolState.keyCooldowns.set(`contributor:${row.key_id}`, Date.now() + SHARED_POOL_KEY_COOLDOWN_MS);
        return jsonResponse({ error: "Contributor AI provider is temporarily unavailable", retryable: true }, response.status === 429 ? 429 : 503, corsHeaders);
      }
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        sharedPoolState.keyCooldowns.set(`contributor:${row.key_id}`, Date.now() + SHARED_POOL_KEY_COOLDOWN_MS);
        return jsonResponse({ error: "Contributor AI provider returned no answer", retryable: true }, 503, corsHeaders);
      }
      return jsonResponse({ success: true, text: String(text).trim(), modelUsed: model }, 200, corsHeaders);
    } catch (_) {
      sharedPoolState.keyCooldowns.set(`contributor:${row.key_id}`, Date.now() + SHARED_POOL_KEY_COOLDOWN_MS);
      return jsonResponse({ error: "Contributor AI provider is temporarily unavailable", retryable: true }, 503, corsHeaders);
    } finally {
      await releaseContributorReservation(env, row.key_id);
    }
  } catch (_) {
    return jsonResponse({ error: "Contributor AI provider is temporarily unavailable", retryable: true }, 503, corsHeaders);
  }
}

async function handleSharedAiRequest(request, env, corsHeaders) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 16_384) {
    return jsonResponse({ error: "Shared AI request is too large" }, 413, corsHeaders);
  }
  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return jsonResponse({ error: "Invalid JSON request" }, 400, corsHeaders);
  }
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  const installationId = request.headers.get("X-AMAES-Installation");
  const maxOutputTokens = Number.isInteger(payload.maxOutputTokens)
    ? Math.min(128, Math.max(1, payload.maxOutputTokens))
    : 64;
  if (!prompt || prompt.length > 12_000 || !installationId || installationId.length > 128) {
    return jsonResponse({ error: "Invalid shared AI request" }, 400, corsHeaders);
  }
  const keys = sharedPoolKeys(env);
  if (keys.length === 0) {
    return jsonResponse({
      error: "Shared AI help is not currently configured",
      retryable: true
    }, 503, corsHeaders);
  }
  const reservation = reserveSharedPoolRequest(installationId, keys.length);
  if (!reservation.ok) {
    return jsonResponse({
      error: "Shared AI capacity is temporarily unavailable",
      reason: reservation.reason,
      retryable: true
    }, 429, corsHeaders);
  }
  const key = chooseSharedPoolKey(keys);
  if (!key) {
    return jsonResponse({ error: "Shared AI keys are temporarily rate-limited", retryable: true }, 429, corsHeaders);
  }
  try {
    const model = env.GEMINI_SHARED_MODEL || "gemini-1.5-flash";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens }
        }),
        signal: request.signal
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500) {
        quarantineSharedPoolKey(key);
      }
      return jsonResponse({
        error: response.status === 429
          ? "Shared AI capacity is rate-limited"
          : "Shared AI provider is temporarily unavailable",
        retryable: true
      }, response.status === 429 ? 429 : 503, corsHeaders);
    }
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return jsonResponse({ error: "Shared AI provider returned no answer", retryable: true }, 503, corsHeaders);
    return jsonResponse({ success: true, text: String(text).trim(), modelUsed: model }, 200, corsHeaders);
  } catch (_) {
    quarantineSharedPoolKey(key);
    return jsonResponse({ error: "Shared AI provider is temporarily unavailable", retryable: true }, 503, corsHeaders);
  }
}

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
      "Access-Control-Allow-Headers": "Content-Type, X-AMAES-Client-Version, X-AMAES-Installation, X-AMAES-Owner-Token",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "POST" && path === "/keys/register") {
      return registerContributorKey(request, env, corsHeaders);
    }

    if (request.method === "POST" && path === "/keys/revoke") {
      return updateContributorActivity(request, env, corsHeaders, "revoke");
    }

    if (request.method === "POST" && path === "/keys/delete") {
      return updateContributorActivity(request, env, corsHeaders, "delete");
    }

    if (request.method === "POST" && path === "/keys/activity") {
      return updateContributorActivity(request, env, corsHeaders, "activity");
    }

    if (request.method === "POST" && path === "/ai") {
      const clientVersion = request.headers.get("X-AMAES-Client-Version");
      const minimumVersion = env.MIN_CLIENT_VERSION || "1.7.5";
      if (env.REQUIRE_CLIENT_VERSION === "true" &&
          (!clientVersion || !isSupportedVersion(clientVersion, minimumVersion))) {
        return jsonResponse({
          error: "Client update required",
          minimumVersion,
          latestVersion: LATEST_VERSION,
          updateUrl: UPDATE_URL
        }, 426, corsHeaders);
      }
      let aiPayload = {};
      try { aiPayload = await request.clone().json(); } catch (_) {}
      if (contributorMode(aiPayload.mode)) {
        return contributorAiRequest(request, env, corsHeaders);
      }
      return handleSharedAiRequest(request, env, corsHeaders);
    }

    if (request.method === "GET" || request.method === "HEAD") {
      if (path === "/version") {
        const minimumVersion = env.MIN_CLIENT_VERSION || "1.7.5";
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
            submit: "POST /",
            ai: "POST /ai",
            contributorRegistration: "POST /keys/register",
            contributorRevoke: "POST /keys/revoke",
            contributorDelete: "POST /keys/delete",
            contributorActivity: "POST /keys/activity"
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
      const minimumVersion = env.MIN_CLIENT_VERSION || "1.7.5";
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
  },

  async scheduled(_controller, env) {
    if (!env.DB) return;
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      await env.DB.prepare(
        "DELETE FROM contributor_gemini_keys WHERE last_activity_at < ?"
      ).bind(cutoff).run();
      await env.DB.prepare(
        "DELETE FROM contributor_owner_usage WHERE owner_hash NOT IN (SELECT DISTINCT owner_hash FROM contributor_gemini_keys)"
      ).run();
    } catch (_) {
      // Scheduled cleanup is best-effort; no key material or request data is logged.
    }
  }
};
