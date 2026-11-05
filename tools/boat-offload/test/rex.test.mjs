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

const phoneClient = (state) => ({ code: 0, stdout: JSON.stringify({ clients: [{ client_id: "client:mac", info: { platform: "macos" }, connection_state: "connected" }, { client_id: "client:phone", info: { platform: "ios" }, connection_state: state }] }), stderr: "" });
const fast = { settleMs: 1, intervalMs: 1 };

test("the prompt goes to the connected iOS client with the address", async () => {
  const { rex, calls } = fake([phoneClient("connected"), { code: 0, stdout: "null", stderr: "" }, phoneClient("connected")]);
  assert.equal(await rex.offerToPhone("https://x.ts.net", "boat-r", fast), "sent");
  assert.deepEqual(calls[1].slice(0, 6), ["rex", "-C", "client:phone", "do", "client.host.add", "--args"]);
  assert.equal(JSON.parse(calls[1][6]).address, "https://x.ts.net");
});

test("a phone that drops right after the send is not counted as reached", async () => {
  const { rex } = fake([phoneClient("connected"), { code: 0, stdout: "null", stderr: "" }, phoneClient("lost")]);
  assert.equal(await rex.offerToPhone("https://x.ts.net", "l", fast), "asleep");
});

test("a lost phone gets nothing unless it reconnects within the wait", async () => {
  const gone = fake([phoneClient("lost")]);
  assert.equal(await gone.rex.offerToPhone("https://x.ts.net", "l", { ...fast, waitSeconds: 0 }), "asleep");
  assert.equal(gone.calls.length, 1);
  const returns = fake([phoneClient("lost"), phoneClient("lost"), phoneClient("connected"), { code: 0, stdout: "null", stderr: "" }, phoneClient("connected")]);
  assert.equal(await returns.rex.offerToPhone("https://x.ts.net", "l", { ...fast, waitSeconds: 5 }), "sent");
});

test("no iOS client at all is reported separately", async () => {
  const none = fake([{ code: 0, stdout: JSON.stringify({ clients: [] }), stderr: "" }]);
  assert.equal(await none.rex.offerToPhone("https://x.ts.net", "l", fast), "no-phone");
  const failed = fake([phoneClient("connected"), { code: 4, stdout: "", stderr: "waiting to reconnect" }]);
  assert.equal(await failed.rex.offerToPhone("https://x.ts.net", "l", fast), "asleep");
});
