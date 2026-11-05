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

test("host registration edits an existing host and lists every endpoint", async () => {
  const hosts = { stdout: JSON.stringify({ hosts: [{ host: { label: "Boat-R" } }] }) };
  const { rex, calls } = fake([{ code: 0, ...hosts, stderr: "" }]);
  await rex.registerHost("boat-r", 99, ["https://t.ts.net"]);
  assert.deepEqual(calls[1], ["rex", "hosts", "edit", "boat-r", "--endpoint", "https://t.ts.net", "--endpoint", "http://127.0.0.1:99"]);
  const added = fake([{ code: 0, stdout: JSON.stringify({ hosts: [] }), stderr: "" }]);
  await added.rex.registerHost("boat-r", 99, []);
  assert.deepEqual(added.calls[1], ["rex", "hosts", "add", "boat-r", "http://127.0.0.1:99"]);
});
