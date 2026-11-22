/**
 * No-wallet fallback: a page-read call with no key answers from the free probe instead of
 * throwing about EVM_PRIVATE_KEY. Offline — global fetch is stubbed.
 */
import assert from "node:assert/strict";
import { callWithMeta, quote } from "./index.mjs";
import { hasWallet } from "./config.mjs";

assert.equal(hasWallet({}), false);
assert.equal(hasWallet({ EVM_PRIVATE_KEY: "ab" }), true);
assert.equal(hasWallet({ X402_BUYER_KEY: "ab" }), true);
assert.equal(hasWallet({ EVM_PRIVATE_KEY: "   " }), false);

const PROBE = {
  status: "success",
  status_code: 200,
  preview: "the whole page",
  billed: false,
};

/** @type {string[]} */
const seen = [];
globalThis.fetch = async (url) => {
  seen.push(String(url));
  return new Response(JSON.stringify(PROBE), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "rid_1" },
  });
};

// The client pins the base URL to readfetch.com; fetch is stubbed, so nothing leaves the box.
const env = { READFETCH_BASE_URL: "https://readfetch.com" };

// A page read with no wallet goes to /v1/probe and says so.
const result = await callWithMeta("text", { url: "https://example.com" }, { env });
assert.equal(seen.at(-1), "https://readfetch.com/v1/probe");
assert.equal(result.freeTrial, true);
assert.match(result.note, /free probe/);
assert.equal(result.data.preview, "the whole page");

// Endpoints a probe cannot stand in for keep the wallet error.
for (const name of ["screenshot", "pdf", "batch", "crawl", "fetch"]) {
  seen.length = 0;
  await assert.rejects(
    () => callWithMeta(name, { url: "https://example.com", urls: ["https://example.com"] }, { env }),
    /EVM_PRIVATE_KEY/,
    `${name} must not silently downgrade`,
  );
  assert.equal(seen.length, 0, `${name} must not reach the network`);
}

// A configured key means the paid route, and the paid path needs a real signer — the point
// here is only that it does not take the probe branch.
seen.length = 0;
await assert.rejects(
  () => callWithMeta("text", { url: "https://example.com" }, { env: { ...env, EVM_PRIVATE_KEY: "zz" } }),
  /EVM_PRIVATE_KEY|private_key|hex/i,
);
assert.equal(seen.filter((u) => u.endsWith("/v1/probe")).length, 0);

// quote() never falls back: it is the "what would this cost" call and takes no wallet.
seen.length = 0;
await assert.rejects(() => quote("text", { url: "https://example.com" }, { env }), /402/);
assert.equal(seen.at(-1), "https://readfetch.com/v1/text");

console.log("test-free-probe.mjs: ok");
