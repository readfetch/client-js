/**
 * Base URL and env validation for readfetch REST clients.
 */

const PRODUCTION_HOSTS = new Set(["readfetch.com", "www.readfetch.com"]);
const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** @param {URL} url */
function assertNoUserinfo(url) {
  if (url.username || url.password) {
    throw new Error("READFETCH_BASE_URL must not include userinfo");
  }
}

/** @param {URL} url */
function formatOrigin(url) {
  if (!url.hostname) {
    throw new Error("READFETCH_BASE_URL must include a hostname");
  }
  let origin = `${url.protocol}//${url.hostname}`;
  if (url.port) {
    origin += `:${url.port}`;
  }
  return origin;
}

export function normalizeHostname(hostname) {
  return hostname.replace(/\.+$/, "").toLowerCase();
}

export function isProductionHost(hostname) {
  return PRODUCTION_HOSTS.has(normalizeHostname(hostname));
}

export function isDevHost(hostname) {
  return DEV_HOSTS.has(normalizeHostname(hostname));
}

/** @param {NodeJS.ProcessEnv} [env] */
export function readfetchBase(env = process.env) {
  const raw = (env.READFETCH_BASE_URL || "https://readfetch.com").replace(/\/$/, "");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("READFETCH_BASE_URL is not a valid URL");
  }
  assertNoUserinfo(url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("READFETCH_BASE_URL must use http or https");
  }
  if (isProductionHost(url.hostname)) {
    if (url.protocol !== "https:") {
      throw new Error("READFETCH_BASE_URL must use https for readfetch.com");
    }
    if (url.pathname !== "" && url.pathname !== "/") {
      throw new Error("READFETCH_BASE_URL must not include a path on readfetch.com");
    }
    if (url.port && url.port !== "443") {
      throw new Error("READFETCH_BASE_URL must use default https port for readfetch.com");
    }
    return formatOrigin(url);
  }
  if (env.READFETCH_DEV === "1" && isDevHost(url.hostname)) {
    return formatOrigin(url);
  }
  throw new Error(
    "READFETCH_BASE_URL must be https://readfetch.com (or localhost with READFETCH_DEV=1)",
  );
}

/** @param {string} path — must start with `/` (from `endpointPath`) */
export function readfetchUrl(env = process.env, path) {
  const base = readfetchBase(env);
  if (!path.startsWith("/")) {
    throw new Error("endpoint path must start with /");
  }
  const url = `${base}${path}`;
  if (new URL(url).origin !== new URL(base).origin) {
    throw new Error("request URL origin must match READFETCH_BASE_URL");
  }
  return url;
}

/** @param {NodeJS.ProcessEnv} [env] */
export function parseMaxPaymentUsd(env = process.env) {
  const raw = env.READFETCH_MAX_PAYMENT_USD?.trim() || "1";
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) {
    throw new Error("READFETCH_MAX_PAYMENT_USD must be a decimal amount");
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 100) {
    throw new Error("READFETCH_MAX_PAYMENT_USD must be between 0 and 100");
  }
  return raw;
}

/** @param {NodeJS.ProcessEnv} [env] */
export function x402Network(env = process.env) {
  const base = readfetchBase(env);
  try {
    const host = new URL(base).hostname;
    if (env.READFETCH_DEV === "1" && isDevHost(host)) {
      return "eip155:84532";
    }
  } catch {
    /* readfetchBase already validated */
  }
  return "eip155:8453";
}

/** @param {string} raw */
export function normalizePrivateKey(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    throw new Error("private_key is required");
  }
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("private_key must be 64 hex bytes (optional 0x prefix)");
  }
  return hex.toLowerCase();
}

/** @param {NodeJS.ProcessEnv} [env] */
export function loadAccountFromEnv(env = process.env) {
  const raw = env.EVM_PRIVATE_KEY?.trim() || env.X402_BUYER_KEY?.trim();
  if (!raw) {
    throw new Error("Set EVM_PRIVATE_KEY (Base wallet with USDC)");
  }
  return normalizePrivateKey(raw);
}

/**
 * Env overlay for {@link Client} — constructor args override process.env.
 * @param {{ privateKey?: string, private_key?: string, baseUrl?: string, base_url?: string, maxPaymentUsd?: string, max_payment_usd?: string }} [options]
 */
export function clientEnvFromOptions(options = {}) {
  const env = { ...process.env };
  const key = options.privateKey ?? options.private_key;
  if (key != null && String(key).trim()) {
    env.EVM_PRIVATE_KEY = normalizePrivateKey(key);
  }
  const base = options.baseUrl ?? options.base_url;
  if (base != null && String(base).trim()) {
    env.READFETCH_BASE_URL = String(base).replace(/\/$/, "");
  }
  const cap = options.maxPaymentUsd ?? options.max_payment_usd;
  if (cap != null && String(cap).trim()) {
    env.READFETCH_MAX_PAYMENT_USD = String(cap).trim();
  }
  return env;
}
