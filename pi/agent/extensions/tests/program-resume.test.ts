import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import programResume, { clear, keptLaunchFlags, report, sequence, takeToken } from "../program-resume.ts";

const token = "dummy-token-replace-me";

test("the mac matches the protocol's published examples", () => {
	const lazygit = "pid=74877:time=1795543200:argv=bGF6eWdpdA==:cwd=L2hvbWUvdXNlci9zcmMvcHJvamVjdA==";
	assert.equal(sequence(lazygit, token), `\u001b]7577;${lazygit}:mac=35cb909805c380336efd3689a125acc774a9dec8422a1d21492ebec06ca758e1\u001b\\`);
	assert.equal(report(["lazygit"], "/home/user/src/project", 74877, 1795543200, token), sequence(lazygit, token));
	assert.equal(clear(74877, 1795543200, token), "\u001b]7577;pid=74877:time=1795543200:clear=1:mac=c30603369f98fef581a4098be889175b0c74f0641e49f8b25f4326cb38f97c93\u001b\\");
});

test("each argv element is encoded separately and the hash covers the body and token", () => {
	const text = report(["pi", "--session", "/s/a b.jsonl"], "/w", 7, 9, token)!;
	const body = text.slice("\u001b]7577;".length, text.indexOf(":mac="));
	assert.equal(body, `pid=7:time=9:argv=cGk=,LS1zZXNzaW9u,L3MvYSBiLmpzb25s:cwd=L3c=`);
	assert.equal(text.slice(text.indexOf(":mac=") + 5, -2), createHash("sha256").update(`${body}:${token}`).digest("hex"));
	assert.ok(!text.includes(token));
});

test("commands that cannot be reported are refused", () => {
	assert.equal(report(["pi", "--session", "/s/a\nb"], "/w", 7, 9, token), undefined);
	assert.equal(report(["pi"], "relative", 7, 9, token), undefined);
	assert.equal(report(["pi", "--session", "/".repeat(2048)], "/w", 7, 9, token), undefined);
});

test("only known launch flags are accepted, and only --approve comes back", () => {
	assert.deepEqual(keptLaunchFlags(["--approve", "--model", "anthropic/claude-opus-5-5"]), ["--approve"]);
	assert.deepEqual(keptLaunchFlags(["-a", "--model=x", "--session", "/s/x.jsonl", "-c", "fix the bug"]), ["--approve"]);
	assert.deepEqual(keptLaunchFlags(["--", "--system-prompt", "secret"]), []);
	assert.equal(keptLaunchFlags(["--system-prompt", "secret"]), undefined);
	assert.equal(keptLaunchFlags(["--no-session"]), undefined);
	assert.equal(keptLaunchFlags(["-p", "hello"]), undefined);
	assert.equal(keptLaunchFlags(["--session-dir", "/tmp"]), undefined);
});

test("the token is taken out of the environment even when it is invalid", () => {
	globalThis.programResumeToken = undefined;
	const env: NodeJS.ProcessEnv = { OSC7577_TOKEN: "short" };
	assert.equal(takeToken(env), undefined);
	assert.equal("OSC7577_TOKEN" in env, false);
	assert.equal(takeToken({ OSC7577_TOKEN: token }), token);
	assert.equal(takeToken({}), token);
	globalThis.programResumeToken = undefined;
});

function fixture() {
	const home = mkdtempSync(join(tmpdir(), "program-resume-"));
	const release = join(home, ".pi/agent/install/releases/1.0.0/cli.js");
	mkdirSync(join(home, ".pi/agent/install/releases/1.0.0"), { recursive: true });
	writeFileSync(release, "");
	mkdirSync(join(home, ".pi/agent/sessions/--w--"), { recursive: true });
	return { home: realpathSync(home), release };
}

type Context = { mode: string; cwd: string; sessionManager: { isPersisted: () => boolean; getSessionFile: () => string | undefined } };
type Handler = (event: { reason?: string }, ctx: Context) => void;
type Overrides = NonNullable<Parameters<typeof programResume>[1]>;

function start(overrides: Overrides = {}) {
	globalThis.programResumeToken = undefined;
	globalThis.programResumeCleanup?.();
	const { home, release } = fixture();
	const handlers = new Map<string, Handler[]>();
	const pi = { on: (name: string, handler: Handler) => {
		handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		return () => handlers.set(name, (handlers.get(name) ?? []).filter((entry) => entry !== handler));
	} };
	const written: string[] = [];
	const env: NodeJS.ProcessEnv = { OSC7577_TOKEN: token };
	let file: string | undefined = join(home, ".pi/agent/sessions/--w--/one.jsonl");
	const ctx: Context = { mode: "tui", cwd: "/work", sessionManager: { isPersisted: () => true, getSessionFile: () => file } };
	programResume(pi, { env, args: [], script: release, home, write: (text) => written.push(text), now: () => 100, pid: 42, ...overrides });
	const emit = (name: string, event: { reason?: string } = {}, context: Context = ctx) => (handlers.get(name) ?? []).forEach((handler) => handler(event, context));
	return { home, env, written, ctx, emit, handlers, setFile: (next: string | undefined) => { file = next; } };
}

const decode = (text: string) => {
	const body = text.slice("\u001b]7577;".length, text.indexOf(":mac="));
	if (body.includes("clear=1")) return "clear";
	const argv = body.match(/argv=([^:]*)/)![1].split(",").map((part) => Buffer.from(part, "base64").toString());
	return { argv, cwd: Buffer.from(body.match(/cwd=([^:]*)/)![1], "base64").toString() };
};

test("a saved interactive session reports its exact file and working directory", () => {
	const run = start();
	const file = join(run.home, ".pi/agent/sessions/--w--/one.jsonl");
	writeFileSync(file, "{}\n");
	run.emit("session_start", { reason: "startup" });
	assert.equal("OSC7577_TOKEN" in run.env, false);
	assert.deepEqual(run.written.map(decode), [{ argv: ["pi", "--session", file], cwd: "/work" }]);
	assert.ok(run.written[0].includes("pid=42:time=100:"));
	run.emit("message_end");
	run.emit("agent_settled");
	assert.equal(run.written.length, 1);
});

test("a new session clears the record until its file is saved, then reports it", () => {
	const run = start();
	const first = join(run.home, ".pi/agent/sessions/--w--/one.jsonl");
	writeFileSync(first, "{}\n");
	run.emit("session_start", { reason: "startup" });
	const second = join(run.home, ".pi/agent/sessions/--w--/two.jsonl");
	run.setFile(second);
	run.emit("session_start", { reason: "new" });
	assert.equal(decode(run.written.at(-1)!), "clear");
	run.emit("message_end");
	assert.equal(run.written.length, 2);
	writeFileSync(second, "{}\n");
	run.emit("message_end");
	assert.deepEqual(decode(run.written.at(-1)!), { argv: ["pi", "--session", second], cwd: "/work" });
});

test("shutdown never clears the record, so a terminal restart can bring it back", () => {
	const run = start();
	writeFileSync(join(run.home, ".pi/agent/sessions/--w--/one.jsonl"), "{}\n");
	run.emit("session_start", { reason: "startup" });
	run.emit("session_shutdown", { reason: "quit" });
	run.emit("message_end");
	assert.equal(run.written.length, 1);
	assert.equal([...run.handlers.values()].flat().length, 0);
});

test("the coordinator's --approve comes back and its --model is left to the saved session", () => {
	const run = start({ args: ["--approve", "--model", "anthropic/claude-opus-5-5"] });
	const file = join(run.home, ".pi/agent/sessions/--w--/one.jsonl");
	writeFileSync(file, "{}\n");
	run.emit("session_start", { reason: "startup" });
	assert.deepEqual(decode(run.written[0]), { argv: ["pi", "--session", file, "--approve"], cwd: "/work" });
});

test("ephemeral, headless, managed, unknown-flag and foreign-install runs never report", () => {
	const ephemeral = start();
	ephemeral.emit("session_start", {}, { ...ephemeral.ctx, sessionManager: { isPersisted: () => false, getSessionFile: () => undefined } });
	assert.equal(ephemeral.written.length, 0);
	const headless = start();
	headless.emit("session_start", {}, { ...headless.ctx, mode: "print" });
	assert.equal(headless.written.length, 0);
	for (const overrides of [
		{ env: { OSC7577_TOKEN: token, PI_REX_AGENT: "1" } },
		{ env: { OSC7577_TOKEN: token, PI_SUBAGENT_ID: "task" } },
		{ args: ["--append-system-prompt", "secret"] },
		{ script: "/opt/dev/pi/cli.js" },
		{ env: {} },
	]) {
		const run = start(overrides);
		run.emit("session_start", { reason: "startup" });
		assert.equal(run.written.length, 0);
		assert.equal(run.handlers.size, 0);
	}
});

test("a managed agent still has the token removed from its tools", () => {
	const env: NodeJS.ProcessEnv = { OSC7577_TOKEN: token, PI_REX_AGENT: "1" };
	start({ env });
	assert.equal("OSC7577_TOKEN" in env, false);
});

test("a session file outside the Pi sessions folder is not reported", () => {
	const run = start();
	const outside = join(run.home, "elsewhere.jsonl");
	writeFileSync(outside, "{}\n");
	run.setFile(outside);
	run.emit("session_start", { reason: "resume" });
	assert.equal(decode(run.written[0]), "clear");
});
