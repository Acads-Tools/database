import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const requests = [];
const refreshRows = [];
const fetchMock = async (input, init = {}) => {
  const url = String(input);
  requests.push({ url, method: init.method || "GET", body: init.body });
  if (url.includes("raw.githubusercontent.com")) {
    const code = url.split("/").pop().replace(/\.json$/, "");
    return new Response(code === "CS6204" ? JSON.stringify({ subjectCode: code }) : "not found", {
      status: code === "CS6204" ? 200 : 404,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (url.endsWith("/labels")) return new Response("already exists", { status: 422 });
  if (url.endsWith("/issues")) return new Response(JSON.stringify({ number: 42 }), { status: 201 });
  throw new Error(`Unexpected request ${url}`);
};

const workerSource = fs.readFileSync(fileURLToPath(new URL("./worker.js", import.meta.url)), "utf8")
  .replace("export default {", "globalThis.worker = {");
const context = vm.createContext({
  Response,
  Request,
  URL,
  TextEncoder,
  crypto: webcrypto,
  btoa,
  atob,
  fetch: fetchMock
});
vm.runInContext(workerSource, context, { filename: "worker.js" });
const worker = context.worker;

const env = {
  GITHUB_BOT_TOKEN: "test-token",
  DB: {
    prepare(sql) {
      return {
        async run() { return { meta: { changes: 0 } }; },
        bind(...params) {
          return {
            async run() {
              if (sql.includes("INSERT INTO study_guide_refresh_requests")) {
                const [installationHash, subjectCode, requestedAt, issueNumber] = params;
                const prior = refreshRows.find(row =>
                  row.installationHash === installationHash && row.subjectCode === subjectCode);
                if (prior) Object.assign(prior, { requestedAt, issueNumber });
                else refreshRows.push({ installationHash, subjectCode, requestedAt, issueNumber });
              }
              return { meta: { changes: 1 } };
            },
            async first() {
              if (!sql.includes("SELECT requested_at")) return null;
              const [subjectCode, installationHash, installationCutoff, globalCutoff] = params;
              return refreshRows.find(row => row.subjectCode === subjectCode &&
                ((row.installationHash === installationHash && row.requestedAt > installationCutoff) ||
                  row.requestedAt > globalCutoff)) || null;
            }
          };
        }
      };
    }
  }
};

function request(subjectCode, installationId = "random-installation-id-1234") {
  return new Request("https://relay.example/study-guides/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AMAES-Installation": installationId
    },
    body: JSON.stringify({ subjectCode })
  });
}

const corsHeaders = { "Access-Control-Allow-Origin": "*" };
const queuedResponse = await worker.fetch(request("CS6204"), env, { corsHeaders });
assert.equal(queuedResponse.status, 202);
assert.deepEqual(await queuedResponse.json(), { success: true, queued: true, issueNumber: 42 });
assert.equal(requests.filter(item => item.url.endsWith("/issues")).length, 1);
assert.match(requests.find(item => item.url.endsWith("/issues")).body, /automated-study-guide-refresh/);
assert.doesNotMatch(requests.find(item => item.url.endsWith("/issues")).body, /questions|answer|user/i);

const duplicateResponse = await worker.fetch(request("CS6204"), env, { corsHeaders });
assert.equal(duplicateResponse.status, 200);
assert.equal((await duplicateResponse.json()).duplicate, true);
assert.equal(requests.filter(item => item.url.endsWith("/issues")).length, 1);

const unknownResponse = await worker.fetch(request("NOTACOURSE"), env, { corsHeaders });
assert.equal(unknownResponse.status, 404);
assert.equal(requests.filter(item => item.url.endsWith("/issues")).length, 1);

console.log("On-access study-guide refresh relay invariants passed");
