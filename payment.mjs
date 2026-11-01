/** x402 payment helpers — quotes, receipts, wallet config. */

import { privateKeyToAccount } from "viem/accounts";
import {
  loadAccountFromEnv,
  parseMaxPaymentUsd,
  readfetchBase,
  x402Network,
} from "./config.mjs";

/** Settlement / receipt headers on a paid 200. */
export function paymentFromResponse(response) {
  const receipt =
    response.headers.get("receipt") ?? response.headers.get("RECEIPT");
  const paymentResponse =
    response.headers.get("payment-response") ??
    response.headers.get("PAYMENT-RESPONSE") ??
    response.headers.get("x-payment-response") ??
    response.headers.get("X-PAYMENT-RESPONSE");
  const creditApplied =
    response.headers.get("x-credit-applied") ??
    response.headers.get("X-CREDIT-APPLIED");
  const paymentRequired =
    response.headers.get("payment-required") ??
    response.headers.get("PAYMENT-REQUIRED");
  return {
    receipt: receipt || null,
    paymentResponse: paymentResponse || null,
    paymentRequired: paymentRequired || null,
    creditApplied: creditApplied || null,
  };
}

/** Payer address when `EVM_PRIVATE_KEY` is set. */
export function buyerAddress(env = process.env) {
  try {
    return privateKeyToAccount(loadAccountFromEnv(env)).address;
  } catch {
    return null;
  }
}

/** Wallet + network + spend cap — no network I/O. */
export function paymentConfig(env = process.env) {
  const address = buyerAddress(env);
  return {
    baseUrl: readfetchBase(env),
    network: x402Network(env),
    maxPaymentUsd: parseMaxPaymentUsd(env),
    buyerAddress: address,
    signingReady: address !== null,
  };
}
