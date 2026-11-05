import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { stageFiles } from "../src/accounts.mjs";
import { down, phone, up } from "../src/commands.mjs";

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
      exec: async (_id, script) => {
        if (script.includes("tailscale pair")) return { code: 0, stdout: JSON.stringify({ url: "https://boat-r-feat-x.tail1.ts.net" }), stderr: "" };
        if (script.includes("server status")) return { code: 0, stdout: JSON.stringify({ tailscale: { state: "running", dns_name: "boat-r-feat-x.tail1.ts.net" } }), stderr: "" };
        if (script.includes("tailscale on")) { calls.push("tailscale-on"); return { code: 0, stdout: "{}", stderr: "" }; }
        calls.push(script.includes("rex server start") ? "rex-start" : script.includes("sport") ? "probe" : script.includes("gh repo clone") ? "provision" : "prepare");
        return { code: 0, stdout: "listening", stderr: "" };
      },
      copy: async (_id, path, remote) => { calls.push(`copy ${remote}`); assert.ok(existsSync(path)); },
      copyDirectory: async () => calls.push("push-pool"),
      host: async (_id, port) => `https://preview/${port}`,
      resume: async () => calls.push("resume"),
      stop: async () => calls.push("stop"),
      remove: async () => calls.push("delete"),
    },
    rex: {
      waitReachable: async () => true,
      registerHost: async (label, _port, extra = []) => calls.push(`host ${label}${extra.length ? ` +${extra.join(",")}` : ""}`),
      removeHost: async (label) => calls.push(`unhost ${label}`),
      ensureSession: async () => { calls.push("session"); return true; },
      runBlock: async (_port, _session, command) => calls.push(`block ${command}`),
    },
  };
  return { deps, calls, logs, staged, state };
}

test("up provisions in a safe order and leaves no staged token files", async () => {
  const { deps, calls, logs, staged } = harness();
  const entry = await up(deps, { type: "small", plan: "max", preview: 3000, dev: "pnpm dev", pollMs: 1 });
  assert.deepEqual(calls.filter((call) => !["save", "probe"].includes(call)).slice(0, 10), [
    "create", "prepare", "push-pool", "push-pool", "copy /home/user/.local/share/boat-offload/sync-pi.cjs",
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
  await up(live.deps, { type: "small", plan: "max", pollMs: 1 });
  assert.ok(!live.calls.includes("create") && !live.calls.includes("resume"));
  const stopped = harness({ info: { state: "stopped" } });
  stopped.state.offloads["o/r#feat/x"] = { id: "bx_9", createdAt: "t" };
  await up(stopped.deps, { type: "small", plan: "max", pollMs: 1 });
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
  await assert.rejects(up(deps, { type: "small", plan: "max", pollMs: 1 }), /rex hosts failed/);
  assert.ok(calls.includes("stop-forward 4242"));
});

test("rerunning up keeps a live port forward instead of starting a second one", async () => {
  const { deps, calls } = harness();
  deps.state.offloads["o/r#feat/x"] = { id: "bx_9", createdAt: "t", localPort: 6001, forwardPid: 99 };
  deps.forward.isForwarding = async (pid) => pid === 99;
  deps.forward.start = () => { calls.push("start-forward"); return 1; };
  const entry = await up(deps, { type: "small", plan: "max", pollMs: 1 });
  assert.equal(entry.localPort, 6001);
  assert.equal(entry.forwardPid, 99);
  assert.ok(!calls.includes("start-forward"));
});

test("phone prints the sign-in link once, then returns the tailnet address", async () => {
  const { deps, logs } = harness();
  const statuses = [
    JSON.stringify({ tailscale: { state: "needs_login", auth_url: "https://login.tailscale.com/a/abc" } }),
    JSON.stringify({ tailscale: { state: "needs_login", auth_url: "https://login.tailscale.com/a/abc" } }),
    JSON.stringify({ tailscale: { state: "running" } }),
  ];
  const pairs = [{ code: 1, stdout: "", stderr: "not ready" }, { code: 1, stdout: "", stderr: "not ready" }, { code: 0, stdout: JSON.stringify({ url: "https://boat-r.tail1234.ts.net" }), stderr: "" }];
  deps.boat.exec = async (_id, script) => {
    if (script.includes("tailscale on")) return { code: 0, stdout: "{}", stderr: "" };
    if (script.includes("server status")) return { code: 0, stdout: statuses.shift() ?? statuses.at(-1), stderr: "" };
    return pairs.shift();
  };
  const entry = { id: "bx_1", label: "boat-r" };
  const address = await phone(deps, entry, { waitSeconds: 30, intervalMs: 1 });
  assert.equal(address, "https://boat-r.tail1234.ts.net");
  assert.equal(entry.phoneAddress, address);
  assert.equal(logs.filter((line) => line.includes("login.tailscale.com")).length, 1);
});

test("phone gives up with an actionable error when sign-in never happens", async () => {
  const { deps } = harness();
  deps.boat.exec = async (_id, script) => script.includes("server status")
    ? { code: 0, stdout: JSON.stringify({ tailscale: { state: "needs_login" } }), stderr: "" }
    : { code: script.includes("tailscale on") ? 0 : 1, stdout: "{}", stderr: "" };
  await assert.rejects(phone(deps, { id: "bx_1", label: "boat-r" }, { waitSeconds: 0.05, intervalMs: 1 }), /phone again/);
});

test("deleting a sandbox that joined the tailnet signs the node out first", async () => {
  const { deps, calls } = harness();
  const scripts = [];
  const original = deps.boat.exec;
  deps.boat.exec = async (id, script, options) => { scripts.push(script); return original(id, script, options); };
  const entry = { id: "bx_1", label: "boat-r-x", phoneAddress: "https://t.ts.net" };
  deps.state.offloads.k = entry;
  await down(deps, "k", entry, { remove: true });
  assert.ok(scripts.some((script) => script.includes("tailscale logout")));
  assert.ok(calls.includes("delete"));
});
