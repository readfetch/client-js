import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import {
  BY_NAME,
  CATALOG_ENDPOINTS,
  INTEGRATOR_ENDPOINTS,
  endpointPath,
  exportName,
} from "./endpoints.mjs";
import {
  loadAccountFromEnv,
  parseMaxPaymentUsd,
  readfetchBase,
  readfetchUrl,
  clientEnvFromOptions,
  x402Network,
} from "./config.mjs";
import { buyerAddress, paymentConfig, paymentFromResponse } from "./payment.mjs";

export {
  isDevHost,
  isProductionHost,
  clientEnvFromOptions,
  loadAccountFromEnv,
  normalizePrivateKey,
  parseMaxPaymentUsd,
  readfetchBase,
  readfetchUrl,
  x402Network,
} from "./config.mjs";
export { buyerAddress, paymentConfig, paymentFromResponse } from "./payment.mjs";
export {
  BY_NAME,
  CATALOG_ENDPOINTS,
  INTEGRATOR_ENDPOINTS,
  endpointPath,
  exportName,
} from "./endpoints.mjs";

const TIMEOUT_MS = 120_000;
const USER_AGENT = "readfetch-client-js/0.1.15";

const FEEDBACK_CATEGORIES = new Set(["integration", "docs", "site", "other"]);
const MAX_FEEDBACK_REQUEST_ID_LEN = 256;

/** Max JSON body size accepted from readfetch (16 MiB). */
export const MAX_JSON_RESPONSE_BYTES = 16 * 1024 * 1024;

/** @param {string} text @param {number} status */
function parseJsonBody(text, status) {
  if (!text) {
    return {};
  }
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_RESPONSE_BYTES) {
    throw new Error(`${status}: response body exceeds ${MAX_JSON_RESPONSE_BYTES} bytes`);
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected JSON object");
    }
    return parsed;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${status}: ${text.slice(0, 400)} (invalid JSON: ${detail})`);
  }
}

/** @param {string} privateKey @param {NodeJS.ProcessEnv} env */
function paidFetchCacheKey(privateKey, env) {
  const fingerprint = createHash("sha256").update(privateKey, "utf8").digest("hex");
  return `${fingerprint}:${x402Network(env)}:${parseMaxPaymentUsd(env)}`;
}

/** @type {Map<string, ReturnType<typeof wrapFetchWithPaymentFromConfig>>} */
const paidFetchByKey = new Map();

/** @param {NodeJS.ProcessEnv} [env] */
export function paidFetch(env = process.env) {
  let privateKey;
  try {
    privateKey = loadAccountFromEnv(env);
  } catch (error) {
    throw new Error(
      `Paid calls need EVM_PRIVATE_KEY (Base USDC): ${error instanceof Error ? error.message : error}`,
    );
  }
  const cacheKey = paidFetchCacheKey(privateKey, env);
  let wrapped = paidFetchByKey.get(cacheKey);
  if (!wrapped) {
    const account = privateKeyToAccount(privateKey);
    wrapped = wrapFetchWithPaymentFromConfig(globalThis.fetch, {
      schemes: [{ network: x402Network(env), client: new ExactEvmScheme(account) }],
      spendControls: { maxAmountPerPayment: `$${parseMaxPaymentUsd(env)}` },
    });
    paidFetchByKey.set(cacheKey, wrapped);
  }
  return wrapped;
}

/** Alias — `@x402/fetch` wrapper that signs and retries on 402. */
export const createPaidFetch = paidFetch;

/** `x-request-id` from any readfetch JSON response (for `submitFeedback`). */
export function requestIdFromResponse(response) {
  return response.headers.get("x-request-id") ?? response.headers.get("X-Request-Id");
}

/** @param {string} text @param {number} status */
function assertTextSize(text, status) {
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_RESPONSE_BYTES) {
    throw new Error(`${status}: response body exceeds ${MAX_JSON_RESPONSE_BYTES} bytes`);
  }
}

/** @param {Response} response */
function assertResponseSize(response) {
  const cl = response.headers.get("content-length");
  if (cl === null || cl === "") {
    return;
  }
  const n = Number(cl);
  if (!Number.isFinite(n) || n < 0) {
    return;
  }
  if (n > MAX_JSON_RESPONSE_BYTES) {
    throw new Error(
      `${response.status}: content-length ${n} exceeds ${MAX_JSON_RESPONSE_BYTES} bytes`,
    );
  }
}

/**
 * @param {string} name — e.g. `text`, `map`, `probe`, `crawl_status`
 * @param {object | null | undefined} body — JSON body (omit for GET `crawl_status`)
 * @param {{ pathParams?: Record<string, string>, env?: NodeJS.ProcessEnv }} [options]
 */
export async function call(name, body, options = {}) {
  const { data } = await callWithMeta(name, body, options);
  return data;
}

/**
 * @param {string} name
 * @param {object | null | undefined} body
 * @param {{ pathParams?: Record<string, string>, env?: NodeJS.ProcessEnv }} [options]
 */
export async function callWithMeta(name, body, options = {}) {
  const spec = BY_NAME.get(name);
  if (!spec) {
    throw new Error(`unknown endpoint \`${name}\``);
  }
  const env = options.env ?? process.env;
  const path = endpointPath(name, options.pathParams ?? {});
  const url = readfetchUrl(env, path);
  const method = spec.method;
  /** @type {RequestInit} */
  const init = {
    method,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": USER_AGENT },
  };
  if (method !== "GET") {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body ?? {});
  }
  const http = spec.free ? globalThis.fetch : paidFetch(env);
  const response = await http(url, init);
  assertResponseSize(response);
  const text = await response.text();
  assertTextSize(text, response.status);
  const okStatuses = spec.accept?.length ? spec.accept : [200];
  if (!okStatuses.includes(response.status)) {
    throw new Error(`${response.status}: ${text.slice(0, 400)}`);
  }
  const data = parseJsonBody(text, response.status);
  return {
    data,
    requestId: requestIdFromResponse(response),
    payment: paymentFromResponse(response),
    response,
  };
}

/**
 * Unpaid request — returns the 402 quote (`accepts`, `price_usd`, …). No wallet required.
 * @param {string} name — paid catalog route only
 */
export async function quote(name, body, options = {}) {
  const spec = BY_NAME.get(name);
  if (!spec) {
    throw new Error(`unknown endpoint \`${name}\``);
  }
  if (spec.free) {
    throw new Error(`\`${name}\` is free — use call() instead of quote()`);
  }
  const env = options.env ?? process.env;
  const path = endpointPath(name, options.pathParams ?? {});
  const url = readfetchUrl(env, path);
  const method = spec.method;
  /** @type {RequestInit} */
  const init = {
    method,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "content-type": "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify(body ?? {}),
  };
  if (method === "GET") {
    delete init.body;
    delete init.headers["content-type"];
  }
  const response = await fetch(url, init);
  assertResponseSize(response);
  const text = await response.text();
  assertTextSize(text, response.status);
  if (response.status !== 402) {
    throw new Error(`expected 402 quote, got ${response.status}: ${text.slice(0, 400)}`);
  }
  return {
    status: 402,
    body: parseJsonBody(text, 402),
    paymentRequired:
      response.headers.get("payment-required") ??
      response.headers.get("PAYMENT-REQUIRED"),
    requestId: requestIdFromResponse(response),
  };
}

/**
 * Paid route: sign via `@x402/fetch` and return JSON. Same as `call()` on paid endpoints.
 */
export async function pay(name, body, options = {}) {
  return call(name, body, options);
}

/** Free route — call before paying for `/v1/text`. Returns body only. */
export async function probe(url, env = process.env) {
  const { data } = await probeWithMeta(url, env);
  return data;
}

/** Like `probe`, but includes `requestId` from response headers. */
export async function probeWithMeta(url, env = process.env) {
  return callWithMeta("probe", { url: requiredString(url, "url") }, { env });
}

/** POST /v1/feedback — free; bind with `requestId` from a prior call's `X-Request-Id`. */
export async function submitFeedback(requestId, category, message, env = process.env) {
  const id = String(requestId ?? "").trim();
  const cat = String(category ?? "").trim();
  const msg = String(message ?? "").trim();
  if (!id) throw new Error("request_id is required");
  if (id.length > MAX_FEEDBACK_REQUEST_ID_LEN) {
    throw new Error(`request_id exceeds ${MAX_FEEDBACK_REQUEST_ID_LEN} characters`);
  }
  if (!FEEDBACK_CATEGORIES.has(cat)) {
    throw new Error("category must be integration, docs, site, or other");
  }
  if (!msg || msg.length > 500) {
    throw new Error("message is required (max 500 characters)");
  }
  return call(
    "feedback",
    { request_id: id, category: cat, message: msg },
    { env },
  );
}

/** POST /v1/claims — paid delivery dispute (receipt + signature). Not integrator feedback. */
export async function submitClaim(claim, env = process.env) {
  return call("claims", normalizeClaim(claim), { env });
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function normalizeClaim(claim) {
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
    throw new Error("claim must be an object");
  }
  for (const name of ["receipt", "reason", "address", "signature"]) {
    requiredString(claim[name], name);
  }
  if (!new Set(["empty", "truncated", "stale", "wrong_content"]).has(claim.reason)) {
    throw new Error("reason must be empty, truncated, stale, or wrong_content");
  }
  if (claim.note !== undefined && (typeof claim.note !== "string" || claim.note.length > 500)) {
    throw new Error("note must be at most 500 characters");
  }
  return claim;
}

/** POST /v1/text — x402 402 handling is automatic. */
export async function readfetchText(url, env = process.env) {
  const body = typeof url === "string" ? { url } : url;
  return call("text", body, { env });
}

export function readfetchMap(body, env = process.env) {
  return call("map", body, { env });
}
export function readfetchScrape(body, env = process.env) {
  return call("scrape", body, { env });
}
export function readfetchResidential(body, env = process.env) {
  return call("residential", body, { env });
}
export function readfetchFetch(body, env = process.env) {
  return call("fetch", body, { env });
}
export function readfetchBatch(body, env = process.env) {
  return call("batch", body, { env });
}
export function readfetchPdf(body, env = process.env) {
  return call("pdf", body, { env });
}
export function readfetchSection(body, env = process.env) {
  return call("section", body, { env });
}
export function readfetchDiff(body, env = process.env) {
  return call("diff", body, { env });
}
export function readfetchScreenshot(body, env = process.env) {
  return call("screenshot", body, { env });
}
export function readfetchSearch(body, env = process.env) {
  return call("search", body, { env });
}
export function readfetchCrawl(body, env = process.env) {
  return call("crawl", body, { env });
}
/** GET /v1/crawl/{id} — poll async crawl (free). */
export function readfetchCrawlStatus(jobId, env = process.env) {
  return call("crawl_status", null, { pathParams: { id: jobId }, env });
}

/**
 * One-line setup: `new Client({ privateKey: "0x…" })` then `await client.fetch(url)`.
 * Paid routes use the same x402 402 → sign → retry as `call()`.
 */
export class Client {
  /** @param {{ privateKey?: string, private_key?: string, baseUrl?: string, base_url?: string, maxPaymentUsd?: string, max_payment_usd?: string }} [options] */
  constructor(options = {}) {
    this.env = clientEnvFromOptions(options);
  }

  /** `POST /v1/text` — response includes `text`. */
  text(url) {
    const body = typeof url === "string" ? { url } : url;
    return call("text", body, { env: this.env });
  }

  /** Same as `text` (article read, not raw `/v1/fetch`). */
  fetch(url) {
    return this.text(url);
  }

  probe(url) {
    return probe(url, this.env);
  }

  /** Any published route — same as top-level `call()` with this client's env. */
  call(name, body, options = {}) {
    return callWithMeta(name, body, { env: this.env, ...options }).then(({ data }) => data);
  }
}

/** OpenAI Agents SDK — attach `execute` to your host's tool wrapper. */
export const readfetchTextToolDefinition = {
  type: "function",
  name: "readfetch_text",
  description:
    "Read a public URL and return main article text as Markdown with metadata (readfetch.com).",
  parameters: {
    type: "object",
    required: ["url"],
    properties: { url: { type: "string", format: "uri" } },
  },
  execute: async ({ url }) => readfetchText(url),
};
