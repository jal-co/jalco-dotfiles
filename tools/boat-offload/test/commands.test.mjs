import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { stageFiles } from "../src/accounts.mjs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { costLine, down, extend, money, offerPhone, offloadSession, overview, phone, up } from "../src/commands.mjs";

const repo = { owner: "o", repo: "r", branch: "feat/x", name: "N", email: "e@x.y", remoteBranchExists: true, pushed: true, dirty: false };

function harness(overrides = {}) {
  const calls = [];
  const logs = [];
  const staged = [];
  const created = [];
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
      create: async (options) => { calls.push("create"); created.push(options); return { id: "bx_1", url: "https://x" }; },
      usage: async () => ({ dollars: 0.05, seconds: 5000, running: true, perHour: 0.036 }),
      extend: async (_id, hours) => calls.push(`extend ${hours}`),
      list: async () => overrides.sandboxes ?? [],
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
      offerToPhone: async (address, _label, options) => { calls.push(`offer ${address}${options?.waitSeconds ? " wait" : ""}`); return overrides.phone ?? "sent"; },
      runBlock: async (_port, _session, command) => calls.push(`block ${command}`),
    },
  };
  return { deps, calls, logs, staged, state, created };
}

test("up provisions in a safe order and leaves no staged token files", async () => {
  const { deps, calls, logs, staged } = harness();
  const entry = await up(deps, { type: "small", plan: "max", hours: 1, preview: 3000, dev: "pnpm dev", pollMs: 1 });
  assert.deepEqual(calls.filter((call) => !["save", "probe"].includes(call)).slice(0, 14), [
    "create", "prepare", "push-pool", "push-pool", "push-pool", "push-pool", "copy /home/user/dotfiles/tools/anti-slop/package.json", "copy /home/user/dotfiles/tools/anti-slop/package-lock.json", "copy /home/user/.local/share/boat-offload/sync-pi.cjs",
    "copy /home/user/.config/boat-offload/claude-one.token", "copy /home/user/.config/boat-offload/claude-two.token",
    "provision", "rex-start", "host boat-r-feat-x",
  ]);
  assert.ok(calls.includes("session") && calls.some((call) => call.startsWith("block export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.on.boat.dev; cd '/home/user/work/r' && pnpm dev")));
  assert.equal(entry.previewUrl, "https://preview/3000");
  assert.equal(entry.localPort, 5000);
  for (const result of staged) assert.ok(result.files.every((file) => !existsSync(file.path)));
  assert.doesNotMatch(logs.join("\n"), /secret-one|secret-two/);
});

test("up refuses a branch origin does not have", async () => {
  const { deps, calls } = harness({ repo: { pushed: false } });
  await assert.rejects(up(deps, { type: "small", plan: "max", hours: 1 }), /Push it first/);
  assert.deepEqual(calls, []);
});

test("up reuses a live sandbox and resumes a stopped one", async () => {
  const live = harness();
  live.state.offloads["o/r#feat/x"] = { id: "bx_9", createdAt: "t" };
  await up(live.deps, { type: "small", plan: "max", hours: 1, pollMs: 1 });
  assert.ok(!live.calls.includes("create") && !live.calls.includes("resume"));
  const stopped = harness({ info: { state: "stopped" } });
  stopped.state.offloads["o/r#feat/x"] = { id: "bx_9", createdAt: "t" };
  await up(stopped.deps, { type: "small", plan: "max", hours: 1, pollMs: 1 });
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
  await assert.rejects(up(deps, { type: "small", plan: "max", hours: 1, pollMs: 1 }), /rex hosts failed/);
  assert.ok(calls.includes("stop-forward 4242"));
});

test("rerunning up keeps a live port forward instead of starting a second one", async () => {
  const { deps, calls } = harness();
  deps.state.offloads["o/r#feat/x"] = { id: "bx_9", createdAt: "t", localPort: 6001, forwardPid: 99 };
  deps.forward.isForwarding = async (pid) => pid === 99;
  deps.forward.start = () => { calls.push("start-forward"); return 1; };
  const entry = await up(deps, { type: "small", plan: "max", hours: 1, pollMs: 1 });
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

function sessionFile(t, content) {
  const root = mkdtempSync(join(tmpdir(), "boat-offload-session-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "2026-11-05T01-01-43-670Z_01a1a939-db75-73c7-9044-6a861783c377.jsonl");
  writeFileSync(path, content);
  return path;
}

test("offloading a session copies it and forks it in a new Rex session", async (t) => {
  const { deps, calls } = harness();
  deps.rex.reachable = async () => true;
  deps.rex.ensureSession = async (port, label, cwd, command) => { calls.push(`session ${label} ${cwd} ${command.join(" ")}`); return true; };
  const label = await offloadSession(deps, { id: "bx_1", repo: "r", localPort: 5000 }, sessionFile(t, '{"a":1}'));
  assert.equal(label, "r-fork-01a1a939");
  assert.ok(calls.some((call) => call.startsWith("copy /home/user/.local/share/boat-offload/sessions/")));
  assert.ok(calls.includes("session r-fork-01a1a939 /home/user/work/r pi --fork /home/user/.local/share/boat-offload/sessions/2026-11-05T01-01-43-670Z_01a1a939-db75-73c7-9044-6a861783c377.jsonl"));
});

test("offloading refuses a session that contains a credential and copies nothing", async (t) => {
  const { deps, calls } = harness();
  deps.rex.reachable = async () => true;
  await assert.rejects(offloadSession(deps, { id: "bx_1", repo: "r", localPort: 5000 }, sessionFile(t, `{"x":"ghp_${"z".repeat(30)}"}`)), /looks like a credential/);
  assert.deepEqual(calls, []);
});

test("deleting a sandbox also removes its Tailscale device when an admin key is configured", async () => {
  const { deps, logs } = harness();
  const removed = [];
  deps.tailscale = { removeDevice: async (address) => { removed.push(address); return 1; } };
  const entry = { id: "bx_1", label: "boat-r-x", phoneAddress: "https://boat-r-x.t.ts.net" };
  deps.state.offloads.k = entry;
  await down(deps, "k", entry, { remove: true });
  assert.deepEqual(removed, ["https://boat-r-x.t.ts.net"]);
  assert.ok(logs.some((line) => line.includes("Removed the sandbox's Tailscale device")));
});

test("a failing Tailscale cleanup is reported but does not undo the delete", async () => {
  const { deps, logs, calls } = harness();
  deps.tailscale = { removeDevice: async () => { throw new Error("HTTP 403"); } };
  const entry = { id: "bx_1", label: "boat-r-x", phoneAddress: "https://boat-r-x.t.ts.net" };
  deps.state.offloads.k = entry;
  await down(deps, "k", entry, { remove: true });
  assert.ok(calls.includes("delete"));
  assert.ok(logs.some((line) => line.includes("Delete it in the Tailscale admin page")));
  assert.equal(deps.state.offloads.k, undefined);
});

test("a new sandbox gets a lifetime and the cost is printed", async () => {
  const { deps, created, logs } = harness();
  await up(deps, { type: "small", plan: "max", hours: 2, pollMs: 1 });
  assert.equal(created[0].ttlSeconds, 7200);
  assert.ok(logs.some((line) => /Cost: \$0\.036\/hour.*\$0\.050 so far.*after 2 hours.*at most \$0\.072/.test(line)), logs.join("\n"));
});

test("reusing a sandbox resets its lifetime so it does not stop mid-work", async () => {
  const { deps, calls } = harness();
  deps.state.offloads["o/r#feat/x"] = { id: "bx_9", createdAt: "t" };
  await up(deps, { type: "small", plan: "max", hours: 3, pollMs: 1 });
  assert.ok(calls.includes("extend 3"));
});

test("money keeps sub-dime amounts readable", () => {
  assert.equal(money(0.00749), "$0.007");
  assert.equal(money(1.5), "$1.50");
});

test("costLine degrades instead of failing when usage is unavailable", async () => {
  assert.equal(await costLine({ usage: async () => null }, "bx_1", 1), "Cost: unavailable");
});

test("status shows each offload's cost and flags untracked running sandboxes", async () => {
  const { deps, logs } = harness({ info: { state: "idle", archiveAfter: "2026-11-05T18:00:00Z" }, sandboxes: [{ id: "bx_1", state: "idle" }, { id: "bx_stray", name: "old", state: "idle" }, { id: "bx_done", state: "stopped" }] });
  deps.state.offloads["o/r#b"] = { id: "bx_1", label: "boat-r-b" };
  await overview(deps);
  const text = logs.join("\n");
  assert.match(text, /o\/r#b\s+bx_1\s+idle, auto-stops/);
  assert.match(text, /\$0\.050 so far, \$0\.036\/hour/);
  assert.match(text, /Not tracked.*bx_stray \(old, idle\)/);
  assert.doesNotMatch(text, /bx_done/);
});

test("extend sets the remaining lifetime and reports the cap", async () => {
  const { deps, calls, logs } = harness();
  await extend(deps, { id: "bx_1" }, 4);
  assert.ok(calls.includes("extend 4"));
  assert.ok(logs.some((line) => line.includes("after 4 hours")));
});

test("down reports what the sandbox cost in total", async () => {
  const { deps, logs } = harness();
  const entry = { id: "bx_1", label: "boat-r-x" };
  deps.state.offloads.k = entry;
  await down(deps, "k", entry, { remove: false });
  assert.ok(logs.some((line) => line.includes("Total cost of sandbox bx_1: $0.05")));
});

test("up opens Add Remote Host on the phone once per address", async () => {
  const { deps, calls, logs } = harness();
  await up(deps, { type: "small", plan: "max", hours: 1, pollMs: 1 });
  assert.ok(calls.includes("offer https://boat-r-feat-x.tail1.ts.net"));
  assert.ok(logs.some((line) => line.includes("Opened Add Remote Host on your phone")));
  assert.deepEqual(deps.state.phoneOffered, ["https://boat-r-feat-x.tail1.ts.net"]);
  calls.length = 0;
  await up(deps, { type: "small", plan: "max", hours: 1, pollMs: 1 });
  assert.ok(!calls.some((call) => call.startsWith("offer ")));
});

test("a sleeping or unconnected phone gets a hint and is not marked as offered", async () => {
  for (const [phoneState, text] of [["asleep", /was not connected when the prompt was sent/], ["no-phone", /not connected to this Mac/]]) {
    const { deps, logs } = harness({ phone: phoneState });
    await offerPhone(deps, "boat-r", "https://x.ts.net", { force: false });
    assert.ok(logs.some((line) => text.test(line)), phoneState);
    assert.deepEqual(deps.state.phoneOffered, []);
  }
});

test("phone command re-sends the prompt even if it was offered before", async () => {
  const { deps, calls } = harness();
  deps.state.phoneOffered = ["https://boat-r.tail1.ts.net"];
  deps.boat.exec = async (_id, script) => {
    if (script.includes("tailscale on")) return { code: 0, stdout: "{}", stderr: "" };
    if (script.includes("server status")) return { code: 0, stdout: JSON.stringify({ tailscale: { state: "running", dns_name: "boat-r.tail1.ts.net" } }), stderr: "" };
    return { code: 0, stdout: JSON.stringify({ url: "https://boat-r.tail1.ts.net" }), stderr: "" };
  };
  await phone(deps, { id: "bx_1", label: "boat-r", localPort: 5000 }, { waitSeconds: 5, intervalMs: 1 });
  assert.ok(calls.includes("offer https://boat-r.tail1.ts.net wait"));
});
