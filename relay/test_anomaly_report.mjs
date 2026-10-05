import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const githubRequests = [];
const workerSource = fs.readFileSync(fileURLToPath(new URL("./worker.js", import.meta.url)), "utf8")
  .replace("export default {", "globalThis.worker = {");
const context = vm.createContext({
  Response,
  Request,
  URL,
  TextEncoder,
  TextDecoder,
  crypto: webcrypto,
  btoa,
  atob,
  fetch: async (url, init = {}) => {
    githubRequests.push({ url: String(url), body: init.body || "" });
    if (String(url).endsWith("/issues")) {
      return new Response(JSON.stringify({ number: 99, html_url: "https://github.com/Acads-Tools/database/issues/99" }), { status: 201 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }
});
vm.runInContext(workerSource, context, { filename: "worker.js" });
const worker = context.worker;

const env = {
  GITHUB_BOT_TOKEN: "test-token",
  REPO_OWNER: "Acads-Tools",
  REPO_NAME: "database",
  DB: {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              return null;
            },
            async run() {
              return { meta: { changes: 1 } };
            }
          };
        },
        async run() {
          return { meta: { changes: 1 } };
        }
      };
    }
  }
};

const req1 = new Request("https://relay.example/telemetry/anomaly", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    anomalyType: "VERIFIED_ANSWER_FAILED",
    subjectCode: "ITE6200",
    activityTitle: "FINAL QUIZ 2",
    questionRaw: "IDENTIFICATION: It is used to get or set values from and to an input element particularly textboxes.",
    questionNorm: "it is used to get or set values from and to an input element particularly textboxes",
    domType: "shortanswer",
    submittedAnswer: "b. False",
    markScored: 0.0,
    maxMark: 1.0,
    attemptHistory: ["b. False"],
    dbCandidate: {
      ansRaw: "b. False",
      questionType: "multichoice",
      verified: true,
      source: "review_screen"
    },
    clientVersion: "1.11.19",
    contributorId: "anon_test123"
  })
});

const res1 = await worker.fetch(req1, env);
assert.strictEqual(res1.status, 200, "First anomaly report must succeed");
const data1 = await res1.json();
assert.strictEqual(data1.success, true, "Response should have success: true");
assert.strictEqual(data1.issueNumber, 99, "Issue number 99 should be returned");
assert.strictEqual(githubRequests.length, 1, "Exactly 1 GitHub issue request must be made");

// Test deduplication on repeated request
const req2 = new Request("https://relay.example/telemetry/anomaly", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    anomalyType: "VERIFIED_ANSWER_FAILED",
    subjectCode: "ITE6200",
    activityTitle: "FINAL QUIZ 2",
    questionRaw: "IDENTIFICATION: It is used to get or set values from and to an input element particularly textboxes.",
    questionNorm: "it is used to get or set values from and to an input element particularly textboxes",
    domType: "shortanswer",
    submittedAnswer: "b. False",
    markScored: 0.0,
    maxMark: 1.0
  })
});

const res2 = await worker.fetch(req2, env);
assert.strictEqual(res2.status, 200, "Repeated report must succeed with duplicate acknowledgement");
const data2 = await res2.json();
assert.strictEqual(data2.duplicate, true, "Should be flagged as duplicate");
assert.strictEqual(githubRequests.length, 1, "Duplicate report must not create another GitHub issue");

console.log("Anomaly reporting relay tests PASSED");
