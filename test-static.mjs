import assert from "node:assert/strict";
import {
  clientEnvFromOptions,
  isDevHost,
  isProductionHost,
  loadAccountFromEnv,
  normalizePrivateKey,
  parseMaxPaymentUsd,
  readfetchBase,
  readfetchUrl,
  x402Network,
} from "./config.mjs";
import { buyerAddress, paymentConfig, paymentFromResponse } from "./payment.mjs";
import { Client } from "./index.mjs";

assert.equal(isProductionHost("readfetch.com"), true);
assert.equal(isProductionHost("READFETCH.COM."), true);
assert.equal(isDevHost("127.0.0.1"), true);

assert.throws(() => readfetchBase({ READFETCH_BASE_URL: "http://readfetch.com" }));
assert.throws(() =>
  readfetchBase({ READFETCH_BASE_URL: "https://user:pass@readfetch.com" }),
);
assert.throws(() =>
  readfetchBase({ READFETCH_BASE_URL: "file:///etc/passwd" }),
);
assert.throws(() =>
  readfetchBase({ READFETCH_BASE_URL: "https://readfetch.com/evil" }),
);
assert.equal(
  readfetchBase({ READFETCH_BASE_URL: "https://readfetch.com" }),
  "https://readfetch.com",
);
assert.equal(
  readfetchBase({
    READFETCH_BASE_URL: "http://127.0.0.1:8080",
    READFETCH_DEV: "1",
  }),
  "http://127.0.0.1:8080",
);

assert.equal(
  readfetchUrl({ READFETCH_BASE_URL: "https://readfetch.com" }, "/v1/probe"),
  "https://readfetch.com/v1/probe",
);
assert.throws(() =>
  readfetchUrl({ READFETCH_BASE_URL: "https://readfetch.com" }, "v1/probe"),
);

assert.equal(parseMaxPaymentUsd({}), "1");
assert.equal(parseMaxPaymentUsd({ READFETCH_MAX_PAYMENT_USD: "0.5" }), "0.5");
assert.throws(() => parseMaxPaymentUsd({ READFETCH_MAX_PAYMENT_USD: "101" }));

assert.equal(x402Network({ READFETCH_BASE_URL: "https://readfetch.com" }), "eip155:8453");
assert.equal(
  x402Network({
    READFETCH_BASE_URL: "http://127.0.0.1:8080",
    READFETCH_DEV: "1",
  }),
  "eip155:84532",
);

const cfg = paymentConfig({
  READFETCH_BASE_URL: "https://readfetch.com",
  READFETCH_MAX_PAYMENT_USD: "0.5",
});
assert.equal(cfg.baseUrl, "https://readfetch.com");
assert.equal(cfg.network, "eip155:8453");
assert.equal(cfg.maxPaymentUsd, "0.5");
assert.equal(cfg.signingReady, false);
assert.equal(buyerAddress({}), null);
assert.equal(
  loadAccountFromEnv({
    EVM_PRIVATE_KEY: "0x" + "A".repeat(64),
  }),
  "0x" + "a".repeat(64),
);

const res = new Response("", {
  headers: { receipt: "r1", "payment-response": "p1", "x-credit-applied": "0.002" },
});
const pay = paymentFromResponse(res);
assert.equal(pay.receipt, "r1");
assert.equal(pay.paymentResponse, "p1");
assert.equal(pay.creditApplied, "0.002");
assert.equal(pay.paymentRequired, null);

const key = "0x" + "b".repeat(64);
assert.equal(normalizePrivateKey(key), key);
const env = clientEnvFromOptions({ privateKey: key, maxPaymentUsd: "0.25" });
assert.equal(env.EVM_PRIVATE_KEY, key);
assert.equal(env.READFETCH_MAX_PAYMENT_USD, "0.25");
const rf = new Client({ privateKey: key });
assert.equal(rf.env.EVM_PRIVATE_KEY, key);

console.log("client-js: ok");
