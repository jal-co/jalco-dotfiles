import assert from "node:assert/strict";
import test from "node:test";
import { createRex } from "../src/rex.mjs";

function fake(responses) {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args]);
    return responses.shift() ?? { code: 0, stdout: "", stderr: "" };
  };
  return { rex: createRex(run), calls };
}

test("an existing session with the repository's label is reused", async () => {
  const { rex, calls } = fake([{ code: 0, stdout: JSON.stringify({ sessions: [{ session_id: "s:1", label: "r" }] }), stderr: "" }]);
  assert.equal(await rex.ensureSession(1234, "r", "/work/r", ["pi"]), false);
  assert.equal(calls.length, 1);
});

test("a missing session is created in the checkout", async () => {
  const { rex, calls } = fake([{ code: 0, stdout: JSON.stringify({ sessions: [] }), stderr: "" }]);
  assert.equal(await rex.ensureSession(1234, "r", "/work/r", ["pi"]), true);
  assert.deepEqual(calls[1], ["rex", "-S", "http://127.0.0.1:1234", "new", "r", "-c", "/work/r", "--", "pi"]);
});

test("an unreadable or failed session listing never creates a duplicate", async () => {
  for (const response of [{ code: 1, stdout: "", stderr: "x" }, { code: 0, stdout: "not json", stderr: "" }]) {
    const { rex, calls } = fake([response]);
    await assert.rejects(rex.ensureSession(1234, "r", "/work/r", ["pi"]), /rex ls/);
    assert.equal(calls.length, 1);
  }
});

test("registration stores the sandbox's host id so the Rex apps list it", async () => {
  const { rex, calls } = fake([
    { code: 0, stdout: JSON.stringify({ host_id: "vm-host" }), stderr: "" },
    { code: 0, stdout: JSON.stringify({ hosts: [{ id: "host:1", label: "Boat-R" }] }), stderr: "" },
  ]);
  await rex.registerHost("boat-r", 99, ["https://t.ts.net"]);
  assert.deepEqual(calls[0], ["rex", "-S", "http://127.0.0.1:99", "api", "call", "server.status"]);
  assert.deepEqual(calls[2].slice(0, 4), ["rex", "api", "call", "hosts.put"]);
  assert.deepEqual(JSON.parse(calls[2][4]), { host: { id: "host:1", label: "Boat-R", endpoints: ["https://t.ts.net", "http://127.0.0.1:99"], host_id: "vm-host", icon: "globe" } });
});

test("a new host lets the server choose its id", async () => {
  const { rex, calls } = fake([
    { code: 0, stdout: JSON.stringify({ host_id: "vm-host" }), stderr: "" },
    { code: 0, stdout: JSON.stringify({ hosts: [] }), stderr: "" },
  ]);
  await rex.registerHost("boat-r", 99, []);
  assert.equal(JSON.parse(calls[2][4]).host.id, undefined);
});

test("registration fails loudly when the host id cannot be read", async () => {
  const { rex, calls } = fake([{ code: 1, stdout: "", stderr: "down" }]);
  await assert.rejects(rex.registerHost("boat-r", 99, []), /host id/);
  assert.equal(calls.length, 1);
});

test("a host the Rex app already added for the same address is updated, not duplicated", async () => {
  const { rex, calls } = fake([
    { code: 0, stdout: JSON.stringify({ host_id: "vm-host" }), stderr: "" },
    { code: 0, stdout: JSON.stringify({ hosts: [{ id: "host:app", label: "boat-r.t.ts.net", endpoints: ["https://boat-r.t.ts.net"], icon: "globe" }] }), stderr: "" },
  ]);
  await rex.registerHost("boat-r", 99, ["https://boat-r.t.ts.net"]);
  const sent = JSON.parse(calls[2][4]).host;
  assert.equal(sent.id, "host:app");
  assert.equal(sent.label, "boat-r.t.ts.net");
  assert.deepEqual(sent.endpoints, ["https://boat-r.t.ts.net", "http://127.0.0.1:99"]);
});

test("when the CLI host and the app's host both exist the app's is kept and the other removed", async () => {
  const { rex, calls } = fake([
    { code: 0, stdout: JSON.stringify({ host_id: "vm-host" }), stderr: "" },
    { code: 0, stdout: JSON.stringify({ hosts: [
      { id: "host:cli", label: "boat-r", endpoints: ["http://127.0.0.1:99"] },
      { id: "host:app", label: "boat-r.t.ts.net", endpoints: ["https://boat-r.t.ts.net"] },
    ] }), stderr: "" },
  ]);
  await rex.registerHost("boat-r", 99, ["https://boat-r.t.ts.net"]);
  assert.equal(JSON.parse(calls[2][4]).host.id, "host:app");
  assert.deepEqual(calls[3].slice(0, 4), ["rex", "api", "call", "hosts.remove"]);
  assert.deepEqual(JSON.parse(calls[3][4]), { id: "host:cli" });
});

test("pairing is suggested only when no phone is connected to this Mac's server", async () => {
  const none = fake([
    { code: 0, stdout: JSON.stringify({ clients: [{ info: { platform: "macos" } }] }), stderr: "" },
    { code: 0, stdout: JSON.stringify({ url: "https://mac.t.ts.net" }), stderr: "" },
  ]);
  assert.equal(await none.rex.phonePairing(), "https://mac.t.ts.net");
  const connected = fake([{ code: 0, stdout: JSON.stringify({ clients: [{ info: { platform: "ios" } }] }), stderr: "" }]);
  assert.equal(await connected.rex.phonePairing(), undefined);
  assert.equal(connected.calls.length, 1);
  const off = fake([{ code: 0, stdout: JSON.stringify({ clients: [] }), stderr: "" }, { code: 1, stdout: "", stderr: "tailscale off" }]);
  assert.equal(await off.rex.phonePairing(), undefined);
});
