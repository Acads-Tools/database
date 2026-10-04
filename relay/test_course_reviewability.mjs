import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const reports = [];
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
  fetch: async () => { throw new Error("Unexpected network request"); }
});
vm.runInContext(workerSource, context, { filename: "worker.js" });
const worker = context.worker;

const env = {
  DB: {
    prepare(sql) {
      return {
        async run() { return { meta: { changes: 0 } }; },
        bind(...params) {
          return {
            async run() {
              if (!sql.includes("INSERT INTO course_reviewability_reports")) return { meta: { changes: 0 } };
              const [installationHash, subjectCode, reportedAt, refreshBefore] = params;
              const prior = reports.find(row =>
                row.installationHash === installationHash && row.subjectCode === subjectCode);
              if (!prior) reports.push({ installationHash, subjectCode, reportedAt });
              else if (prior.reportedAt < refreshBefore) prior.reportedAt = reportedAt;
              return { meta: { changes: prior ? 0 : 1 } };
            },
            async first() {
              if (!sql.includes("COUNT(*) AS report_count")) return null;
              const [subjectCode, since] = params;
              const current = reports.filter(row => row.subjectCode === subjectCode && row.reportedAt >= since);
              return {
                report_count: current.length,
                last_reported_at: current.length ? Math.max(...current.map(row => row.reportedAt)) : null
              };
            }
          };
        }
      };
    }
  }
};

const corsHeaders = { "Access-Control-Allow-Origin": "*" };
function reportRequest(subjectCode, installationId, reviewPermitted = false) {
  return new Request("https://relay.example/course-reviewability/report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AMAES-Installation": installationId
    },
    body: JSON.stringify({ subjectCode, reviewPermitted })
  });
}

async function status(subjectCode) {
  return worker.fetch(new Request(
    `https://relay.example/course-reviewability?subjectCode=${encodeURIComponent(subjectCode)}`
  ), env, { corsHeaders });
}

for (const installationId of ["installation-identifier-0001", "installation-identifier-0002"]) {
  const response = await worker.fetch(reportRequest("GE6106", installationId), env, { corsHeaders });
  assert.equal(response.status, 202);
}
assert.equal((await (await status("GE6106")).json()).status, "unknown",
  "Fewer than three distinct installations must not label a course restricted");

const thirdReport = await worker.fetch(
  reportRequest("GE6106", "installation-identifier-0003"), env, { corsHeaders });
assert.equal(thirdReport.status, 202);
const sharedStatus = await (await status("GE6106")).json();
assert.equal(sharedStatus.status, "restricted-reported");
assert.equal(sharedStatus.reportCount, 3);
assert.equal(sharedStatus.threshold, 3);
assert.ok(reports.every(row => !row.installationHash.includes("installation-identifier")),
  "Only hashed installation identifiers may be stored");

const duplicate = await worker.fetch(
  reportRequest("GE6106", "installation-identifier-0001"), env, { corsHeaders });
assert.equal(duplicate.status, 202);
assert.equal((await (await status("GE6106")).json()).reportCount, 3,
  "A single installation must not count more than once for a course");
assert.equal((await (await status("GE6107")).json()).reportCount, 0,
  "Reports must remain isolated by course code");

assert.equal((await worker.fetch(
  reportRequest("GE6106", "installation-identifier-0004", true), env, { corsHeaders })).status, 400,
"Only explicit restricted-review observations may be reported");
assert.equal((await worker.fetch(
  reportRequest("GE6106", "short"), env, { corsHeaders })).status, 400,
"Installation identifiers must meet the anonymous ID format");
assert.equal((await worker.fetch(new Request(
  "https://relay.example/course-reviewability?subjectCode=bad%20code"
), env, { corsHeaders })).status, 400);

console.log("Course reviewability reporting invariants passed");
