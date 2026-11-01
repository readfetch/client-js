import assert from "node:assert/strict";
import { endpointPath } from "./endpoints.mjs";

assert.throws(() => endpointPath("crawl_status", { id: "   " }));
assert.throws(() => endpointPath("crawl_status", { id: "x".repeat(513) }));
assert.equal(endpointPath("crawl_status", { id: "job-1" }), "/v1/crawl/job-1");

console.log("client-js: endpoints ok");
