import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { stageFiles } from "../src/accounts.mjs";
import { down, up } from "../src/commands.mjs";

const repo = { owner: "o", repo: "r", branch: "feat/x", name: "N", email: "e@x.y", remoteBranchExists: true, pushed: true, dirty: false };

function harness(overrides = {}) {
  const calls = [];
  const logs = [];
  const staged = [];
  const state = { offloads: {} };
  const deps = {
    log: (message) => logs.push(message),
    state,
    saveState: () => calls.push("save"),
    now: () => "now",
    today: () => "2026-11-05",
    repoInfo: async () => ({ ...repo, ...overrides.repo }),
    freePort: async () => 5000,
    forward: { start: () => 4242, stop: (pid) => calls.push(`stop-forward ${pid}`), isForwarding: async () => false },
    accounts: {
      resolve: async () => [{ id: "one", token: "secret-one" }, { id: "two", token: "secret-two" }],
      stage: (accounts) => {
        const result = stageFiles(accounts.map(({ id, token }) => ({ name: `claude-${id}.token`, content: token })));
        staged.push(result);
        return { files: result.files.map((file, index) => ({ id: accounts[index].id, path: file.path })), remove: result.remove };
      },
    },
    boat: {
      ensureEnvironment: async () => false,
      create: async () => { calls.push("create"); return { id: "bx_1", url: "https://x" }; },
      info: async () => overrides.info ?? { state: "ready" },
      exec: async (_id, script) => { calls.push(script.includes("rex server start") ? "rex-start" : script.includes("sport") ? "probe" : script.includes("gh repo clone") ? "provision" : "prepare"); return { code: 0, stdout: "listening", stderr: "" }; },
      copy: async (_id, path, remote) => { calls.push(`copy ${remote}`); assert.ok(existsSync(path)); },
      copyDirectory: async () => calls.push("push-pool"),
      host: async (_id, port) => `https://preview/${port}`,
      resume: async () => calls.push("resume"),
      stop: async () => calls.push("stop"),
      remove: async () => calls.push("delete"),
    },
    rex: {
      waitReachable: async () => true,
      registerHost: async (label) => calls.push(`host ${label}`),
      removeHost: async (label) => calls.push(`unhost ${label}`),
      ensureSession: async () => { calls.push("session"); return true; },
      runBlock: async (_port, _session, command) => calls.push(`block ${command}`),
    },
  };
  return { deps, calls, logs, staged, state };
}

test("up provisions in a safe order and leaves no staged token files", async () => {
  const { deps, calls, logs, staged } = harness();
  const entry = await up(deps, { type: "small", plan: "max", preview: 3000, dev: "pnpm dev" });
  assert.deepEqual(calls.filter((call) => !["save", "probe"].includes(call)).slice(0, 8), [
    "create", "prepare", "push-pool",
    "copy /home/user/.config/boat-offload/claude-one.token", "copy /home/user/.config/boat-offload/claude-two.token",
    "provision", "rex-start", "host boat-r-feat-x",
  ]);
  assert.ok(calls.includes("session") && calls.some((call) => call.startsWith("block cd '/home/user/work/r' && pnpm dev")));
  assert.equal(entry.previewUrl, "https://preview/3000");
  assert.equal(entry.localPort, 5000);
  for (const result of staged) assert.ok(result.files.every((file) => !existsSync(file.path)));
  assert.doesNotMatch(logs.join("\n"), /secret-one|secret-two/);
});

test("up refuses a branch origin does not have", async () => {
  const { deps, calls } = harness({ repo: { pushed: false } });
  await assert.rejects(up(deps, { type: "small", plan: "max" }), /Push it first/);
  assert.deepEqual(calls, []);
});

test("up reuses a live sandbox and resumes a stopped one", async () => {
  const live = harness();
  live.state.offloads["o/r#feat/x"] = { id: "bx_9", createdAt: "t" };
  await up(live.deps, { type: "small", plan: "max" });
  assert.ok(!live.calls.includes("create") && !live.calls.includes("resume"));
  const stopped = harness({ info: { state: "stopped" } });
  stopped.state.offloads["o/r#feat/x"] = { id: "bx_9", createdAt: "t" };
  await up(stopped.deps, { type: "small", plan: "max" });
  assert.ok(stopped.calls.includes("resume") && !stopped.calls.includes("create"));
});

test("down stops by default and deletes only when asked", async () => {
  const stopOnly = harness();
  const entry = { id: "bx_1", label: "boat-r-x", forwardPid: 7, localPort: 5000 };
  stopOnly.state.offloads.k = entry;
  await down(stopOnly.deps, "k", entry, { remove: false });
  assert.ok(stopOnly.calls.includes("stop") && !stopOnly.calls.includes("delete"));
  assert.ok(stopOnly.calls.includes("stop-forward 7") && stopOnly.calls.includes("unhost boat-r-x"));
  assert.ok(stopOnly.state.offloads.k);
  const removal = harness();
  removal.state.offloads.k = { ...entry };
  await down(removal.deps, "k", removal.state.offloads.k, { remove: true });
  assert.ok(removal.calls.includes("delete"));
  assert.equal(removal.state.offloads.k, undefined);
});

test("up stops a port forward it started when Rex registration fails", async () => {
  const { deps, calls } = harness();
  deps.rex.registerHost = async () => { throw new Error("rex hosts failed"); };
  await assert.rejects(up(deps, { type: "small", plan: "max" }), /rex hosts failed/);
  assert.ok(calls.includes("stop-forward 4242"));
});
