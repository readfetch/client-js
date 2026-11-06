import assert from "node:assert/strict";
import { Client, probe, readfetchUrl, submitClaim } from "./index.mjs";
import { clientEnvFromOptions, normalizePrivateKey } from "./config.mjs";

const key = "0x" + "a".repeat(64);

assert.throws(() => normalizePrivateKey("short"), /64 hex/);
assert.equal(normalizePrivateKey("0x" + "A".repeat(64)), key);

const envSnake = clientEnvFromOptions({
  private_key: key,
  base_url: "https://readfetch.com",
  max_payment_usd: "0.5",
});
assert.equal(envSnake.EVM_PRIVATE_KEY, key);
assert.equal(envSnake.READFETCH_BASE_URL, "https://readfetch.com");
assert.equal(envSnake.READFETCH_MAX_PAYMENT_USD, "0.5");

const rf = new Client({ privateKey: key });
assert.equal(rf.env.EVM_PRIVATE_KEY, key);
assert.throws(() => new Client({ privateKey: "bad" }), /64 hex/);

const calls = [];
const realFetch = globalThis.fetch;

/** @param {RequestInfo | URL} input @param {RequestInit} [init] */
async function mockFetch(input, init) {
  let url;
  let method;
  let body;
  if (input instanceof Request) {
    url = input.url;
    method = input.method;
    if (input.body) {
      body = await input.clone().text();
    }
  } else {
    url = String(input);
    const opts = init ?? {};
    method = opts.method ?? "GET";
    body = typeof opts.body === "string" ? opts.body : undefined;
  }
  calls.push({ url, method, body, headers: input instanceof Request ? input.headers : new Headers(init?.headers) });
  return new Response(JSON.stringify({ text: "article", billed: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

globalThis.fetch = mockFetch;

try {
  await assert.rejects(() => probe(), /url is required/);
  await assert.rejects(() => submitClaim({}), /receipt is required/);
  await assert.rejects(
    () => submitClaim({ receipt: "r", reason: "bad", address: "a", signature: "s" }),
    /reason must be/,
  );

  const probeClient = new Client({});
  const probeBody = await probeClient.probe("https://example.com");
  assert.equal(probeBody.text, "article");
  const probeCall = calls.find((c) => c.url.endsWith("/v1/probe"));
  assert.ok(probeCall);
  assert.equal(probeCall.method, "POST");
  assert.equal(probeCall.headers.get("user-agent"), "readfetch-client-js/0.1.15");

  calls.length = 0;
  const paid = new Client({ privateKey: key });
  const page = await paid.fetch("https://example.com/article");
  assert.equal(page.text, "article");
  const textCall = calls.find((c) => c.url.endsWith("/v1/text"));
  assert.ok(textCall, `expected /v1/text in ${calls.map((c) => c.url).join(", ")}`);
  assert.equal(textCall.method, "POST");
  assert.equal(textCall.headers.get("user-agent"), "readfetch-client-js/0.1.15");
  assert.deepEqual(JSON.parse(textCall.body), { url: "https://example.com/article" });

  const page2 = await paid.text({ url: "https://example.com/other", format: "markdown" });
  assert.equal(page2.text, "article");
  const textCall2 = calls.filter((c) => c.url.endsWith("/v1/text")).at(-1);
  assert.deepEqual(JSON.parse(textCall2.body), {
    url: "https://example.com/other",
    format: "markdown",
  });

  const map = await paid.call("map", { url: "https://example.com", limit: 5 });
  assert.equal(map.text, "article");
  const mapCall = calls.find((c) => c.url.endsWith("/v1/map"));
  assert.ok(mapCall);

  assert.equal(
    readfetchUrl({ READFETCH_BASE_URL: "https://readfetch.com" }, "/v1/text"),
    "https://readfetch.com/v1/text",
  );
} finally {
  globalThis.fetch = realFetch;
}

console.log("client-js: client ok");
