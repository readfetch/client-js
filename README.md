# @readfetch/client

x402 REST client for [readfetch.com](https://readfetch.com): every **published** catalog route plus **`/v1/feedback`** and **`/v1/claims`**.

Source: `tools/client-js`. GitHub: `./scripts/publish-client-js.sh`. Registry: `npm publish --access public` from this directory.

## Install

```bash
npm install @readfetch/client
```

## Use

```javascript
import { Client } from "@readfetch/client";

const rf = new Client({ privateKey: "0x…" }); // or export EVM_PRIVATE_KEY
const result = await rf.fetch("https://example.com/article");
console.log(result.text);
```

`fetch()` is **`/v1/text`** (field `text`). On **402**, `@x402/fetch` signs and retries — no extra config.

Full API (every route, feedback, claims):

```bash
export EVM_PRIVATE_KEY=0x…   # not needed for probe / feedback / crawl_status
```

```javascript
import {
  call,
  probeWithMeta,
  readfetchText,
  readfetchMap,
  readfetchCrawl,
  readfetchCrawlStatus,
  submitFeedback,
  submitClaim,
} from "@readfetch/client";

const { data: check, requestId } = await probeWithMeta("https://example.com");
if (!check.challenge) {
  await readfetchText("https://example.com");
  // or: await call("text", { url: "https://example.com" });
}

await readfetchMap({ url: "https://example.com", limit: 20 });
const job = await readfetchCrawl({ url: "https://example.com", max_pages: 3 });
await readfetchCrawlStatus(job.job_id);

await submitFeedback(requestId, "integration", "402 confused my parser");
// await submitClaim({ receipt, reason, address, signature });
```

### Named helpers (same as `call(name, body)`)

| Name | Function | Paid |
|------|----------|------|
| `text` | `readfetchText(url \| body)` | yes |
| `map` | `readfetchMap(body)` | yes |
| `scrape` | `readfetchScrape(body)` | yes |
| `residential` | `readfetchResidential(body)` | yes |
| `fetch` | `readfetchFetch(body)` | yes |
| `batch` | `readfetchBatch(body)` | yes |
| `pdf` | `readfetchPdf(body)` | yes |
| `section` | `readfetchSection(body)` | yes |
| `diff` | `readfetchDiff(body)` | yes |
| `screenshot` | `readfetchScreenshot(body)` | yes |
| `search` | `readfetchSearch(body)` | yes |
| `crawl` | `readfetchCrawl(body)` | yes |
| `crawl_status` | `readfetchCrawlStatus(jobId)` | no (GET) |
| `probe` | `probe(url)` / `probeWithMeta(url)` | no |

Integrator: `submitFeedback`, `submitClaim`. Generic: `call("search", { query: "…" })`, `callWithMeta` for `X-Request-Id` and settlement headers.

## Payment (x402)

Paid catalog routes use **`@x402/fetch`**: first request may return **402** with `PAYMENT-REQUIRED`; the client signs and retries automatically.

```javascript
import {
  paymentConfig,
  paidFetch,
  quote,
  callWithMeta,
} from "@readfetch/client";

// No network — is the wallet configured?
console.log(paymentConfig()); // { baseUrl, network, maxPaymentUsd, buyerAddress, signingReady }

// Quote without a key (402 body + PAYMENT-REQUIRED header)
const q = await quote("text", { url: "https://example.com" });

// Paid call — signing + retry handled for you
const { data, requestId, payment } = await callWithMeta("text", { url: "https://example.com" });
// payment.receipt, payment.paymentResponse, payment.creditApplied on 200

// Custom fetch to readfetch URLs (same signer + spend cap)
const http = paidFetch();
await http("https://readfetch.com/v1/map", { method: "POST", body: "…" });
```

`pay(name, body)` is an alias for `call()` on paid routes. Free routes (`probe`, `feedback`, `crawl_status`) use plain `fetch`.

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `EVM_PRIVATE_KEY` / `X402_BUYER_KEY` | — | Required before paid calls |
| `READFETCH_BASE_URL` | `https://readfetch.com` | Production host only unless dev |
| `READFETCH_MAX_PAYMENT_USD` | `1` | Per-payment spend cap |
| `READFETCH_DEV=1` | off | Allow `localhost` / `127.0.0.1` + Sepolia (`eip155:84532`) |

Framework examples: [readfetch/readfetch](https://github.com/readfetch/readfetch/tree/main/examples). MCP: [`@readfetch/mcp-x402-proxy@0.1.14`](https://github.com/readfetch/mcp-x402-proxy).

Feedback vs claims: [readfetch.com/docs#feedback](https://readfetch.com/docs#feedback).
