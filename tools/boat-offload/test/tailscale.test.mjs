import assert from "node:assert/strict";
import test from "node:test";
import { createTailscale } from "../src/tailscale.mjs";

function fakeApi(devices, { deleteStatus = 200 } = {}) {
  const calls = [];
  const request = async (url, options) => {
    calls.push([options.method, url.replace("https://api.tailscale.com/api/v2", ""), options.headers.Authorization]);
    if (options.method === "DELETE") return { ok: deleteStatus < 300, status: deleteStatus };
    return { ok: true, status: 200, json: async () => ({ devices }) };
  };
  return { calls, tailscale: createTailscale(async () => "tskey-api-test", request) };
}

test("removes only the Linux device whose DNS name matches the sandbox", async () => {
  const { calls, tailscale } = fakeApi([
    { nodeId: "n1", name: "boat-r-x.t.ts.net", os: "linux" },
    { nodeId: "n2", name: "boat-r-x.t.ts.net", os: "macOS" },
    { nodeId: "n3", name: "boat-r-x-2.t.ts.net", os: "linux" },
  ]);
  assert.equal(await tailscale.removeDevice("https://boat-r-x.t.ts.net"), 1);
  assert.deepEqual(calls.filter(([method]) => method === "DELETE").map(([, path]) => path), ["/device/n1"]);
  assert.ok(calls.every(([, , auth]) => auth === "Bearer tskey-api-test"));
});

test("reports API failures without the key", async () => {
  const { tailscale } = fakeApi([{ nodeId: "n1", name: "boat-r-x.t.ts.net", os: "linux" }], { deleteStatus: 403 });
  await assert.rejects(tailscale.removeDevice("https://boat-r-x.t.ts.net"), (error) => /HTTP 403/.test(error.message) && !error.message.includes("tskey"));
});

test("a missing device is not an error", async () => {
  const { tailscale } = fakeApi([]);
  assert.equal(await tailscale.removeDevice("https://boat-r-x.t.ts.net"), 0);
});
