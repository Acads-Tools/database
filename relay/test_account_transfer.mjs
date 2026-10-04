import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const transfers = new Map();
const attempts = [];
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
  fetch
});
vm.runInContext(workerSource, context, { filename: "worker.js" });

const env = {
  DB: {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async run() {
              if (sql.includes("DELETE FROM account_transfer_requests")) {
                const retained = attempts.filter(attempt => attempt.at > params[0]);
                attempts.splice(0, attempts.length, ...retained);
              } else if (sql.includes("INSERT INTO account_transfer_requests")) {
                attempts.push({ installationHash: params[0], action: params[1], at: params[2] });
              } else if (sql.includes("INSERT INTO account_transfers")) {
                const [lookupHash, iv, ciphertext] = params;
                if (transfers.has(lookupHash)) throw new Error("duplicate transfer");
                transfers.set(lookupHash, { iv, ciphertext });
              }
              return { meta: { changes: 1 } };
            },
            async first() {
              if (sql.includes("SELECT COUNT(*) AS request_count")) {
                const [installationHash, action, cutoff] = params;
                return {
                  request_count: attempts.filter(attempt =>
                    attempt.installationHash === installationHash &&
                    attempt.action === action &&
                    attempt.at > cutoff).length
                };
              }
              if (sql.includes("UPDATE account_transfers")) {
                throw new Error("Transfers should be consumed atomically by DELETE");
              }
              if (sql.includes("DELETE FROM account_transfers")) {
                const [lookupHash] = params;
                const row = transfers.get(lookupHash);
                if (!row) return null;
                transfers.delete(lookupHash);
                return { iv: row.iv, ciphertext: row.ciphertext };
              }
              return null;
            }
          };
        },
        async run() {
          return { meta: { changes: 0 } };
        }
      };
    }
  }
};

const worker = context.worker;
const corsHeaders = { "Access-Control-Allow-Origin": "*" };
const realNow = Date.now;
let simulatedNow = realNow();
Date.now = () => simulatedNow;
const installId = "0123456789abcdef-install";
function request(path, body, installation = installId) {
  return new Request(`https://relay.example/transfer/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AMAES-Installation": installation
    },
    body: JSON.stringify(body)
  });
}

const hash = "A".repeat(43);
const encrypted = { lookupHash: hash, iv: "B".repeat(16), ciphertext: "C".repeat(22) };
const created = await worker.fetch(request("create", encrypted), env, { corsHeaders });
assert.equal(created.status, 201);
const createResult = await created.json();
assert.equal(createResult.success, true);
assert.equal("expiresAt" in createResult, false);
assert.equal(transfers.get(hash).ciphertext, encrypted.ciphertext);
simulatedNow += 10 * 365 * 24 * 60 * 60 * 1000;

const consumed = await worker.fetch(request("consume", { lookupHash: hash }, "fedcba9876543210-other"), env, { corsHeaders });
assert.equal(consumed.status, 200);
assert.deepEqual(await consumed.json(), { iv: encrypted.iv, ciphertext: encrypted.ciphertext });
assert.equal(transfers.has(hash), false);

const reused = await worker.fetch(request("consume", { lookupHash: hash }, "fedcba9876543210-other"), env, { corsHeaders });
assert.equal(reused.status, 404);
assert.match((await reused.json()).error, /unavailable or has already been used/);

const malformed = await worker.fetch(request("create", { ...encrypted, ciphertext: "not allowed!" }), env, { corsHeaders });
assert.equal(malformed.status, 400);
const oversized = await worker.fetch(new Request("https://relay.example/transfer/create", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-AMAES-Installation": installId
  },
  body: JSON.stringify({ lookupHash: hash, iv: "B".repeat(16), ciphertext: "A".repeat(100_000) })
}), env, { corsHeaders });
assert.equal(oversized.status, 413);

const durableHash = "D".repeat(43);
const durableCreate = await worker.fetch(request("create", { ...encrypted, lookupHash: durableHash }, "install-durable-0001"), env, { corsHeaders });
assert.equal(durableCreate.status, 201);
const durableConsume = await worker.fetch(request("consume", { lookupHash: durableHash }, "install-durable-0002"), env, { corsHeaders });
assert.equal(durableConsume.status, 200, "Unconsumed transfers remain available regardless of age");

const limitedInstall = "install-rate-limit-0001";
for (let i = 0; i < 3; i++) {
  const response = await worker.fetch(request("create", { ...encrypted, lookupHash: String(i).repeat(43) }, limitedInstall), env, { corsHeaders });
  assert.equal(response.status, 201);
}
const rateLimited = await worker.fetch(request("create", { ...encrypted, lookupHash: "E".repeat(43) }, limitedInstall), env, { corsHeaders });
assert.equal(rateLimited.status, 429);

Date.now = realNow;
console.log("Encrypted account-transfer relay invariants passed");
