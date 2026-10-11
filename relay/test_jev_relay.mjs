import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const relayDirectory = path.dirname(fileURLToPath(import.meta.url));
const worker = fs.readFileSync(path.join(relayDirectory, "worker.js"), "utf8");

assert.match(worker, /\/ai\/jev/);
assert.match(worker, /handleJevProxyRequest/);
assert.match(worker, /https:\/\/api\.typesafe\.ai\/v1\/systemone/);
assert.match(worker, /typesafe\/jev/);

console.log("Jev relay endpoint invariants passed");
