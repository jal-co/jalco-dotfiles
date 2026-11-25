import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "node:http";
import { buildTrace, emit, type Entry, envSecrets, fit, isEnabled, loadPatterns, makeRedactor, parseNotes, prepare, scrubPII, sdkInstance, secretBearingCall, setEnabled, splitRuns } from "../pi-traces.ts";

const FAKE_KEY = "mk_FAKEfake0123456789abcdefFAKEfake0123456789ab";
const redact = makeRedactor([FAKE_KEY]);

test("known secrets, tokens, bearer headers, env values and PEM blocks are redacted", () => {
	const text = [
		`the key is ${FAKE_KEY}.`,
		"Authorization: Bearer abc.def-ghi_jkl123456",
		"ANTHROPIC_API_KEY=sk-ant-api03-FAKEfakeFAKEfake0000",
		'export DATABASE_PASSWORD="hunter2hunter2"',
		'{"clientSecret": "FAKE-client-secret-value"}',
		"gh token ghp_FAKEfakeFAKEfakeFAKEfake0000",
		"op token ops_eyFAKEfakeFAKEfakeFAKEfake",
		"aws AKIAFAKEFAKEFAKEFAKE",
		"postgres://admin:s3cretpass@db.example.com/app",
		["jwt eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "FAKEsignatureFAKE"].join("."),
		"-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAFAKE\n-----END OPENSSH PRIVATE KEY-----",
		"random Xk29fLq8ZmP3vB7nR4tY6wE1aS5dF0gHjK",
	].join("\n");
	const out = redact(text);
	for (const leak of ["abc.def-ghi_jkl123456", "sk-ant-api03", "hunter2hunter2", "FAKE-client-secret-value", "ghp_FAKE", "ops_ey", "AKIAFAKE", "s3cretpass", "eyJhbGci", "AAAAFAKE", "Xk29fLq8", FAKE_KEY]) {
		assert.ok(!out.includes(leak), `leaked ${leak}`);
	}
	assert.match(out, /Authorization: Bearer \[REDACTED\]/);
	assert.match(out, /ANTHROPIC_API_KEY=\[REDACTED\]/);
	assert.match(out, /postgres:\/\/\[REDACTED\]@db\.example\.com/);
	assert.match(out, /\[REDACTED PEM BLOCK\]/);
});

test("ordinary code, paths, commit hashes and uuids survive redaction", () => {
	const text = "git show 3f1c2a9b8e7d6c5b4a39281706f5e4d3c2b1a098 in /home/justin/dotfiles/pi/agent/extensions/session-sync.ts for 01a213bd-212e-7017-84c0-4019bfe08cf7\nconst token = getToken();\nauthor: pr.user?.login\nopen Basic Information. then token expiry\n2026-11-23T15-18-29-117Z_029ed285-72ac-4fce-b296-110048149556-01cd7b30-df132d5a-12ee.jsonl\ntoolCallId toolu_01AbCdEfGhIjKlMnOpQrStUv23 call_Xy12AbCdEfGhIjKlMnOpQrSt";
	assert.equal(redact(text), text);
});

test("secret-named environment values and user patterns are redacted literally", () => {
	assert.deepEqual(envSecrets({ OP_SERVICE_ACCOUNT_TOKEN: "ops_FAKEvalue123", HOME: "/home/x", SHORT_TOKEN: "abc" }), ["ops_FAKEvalue123"]);
	const dir = mkdtempSync(join(tmpdir(), "pi-traces-"));
	writeFileSync(join(dir, "patterns"), "# comment\nacme-internal-[a-z]+\n");
	const custom = makeRedactor(["ops_FAKEvalue123"], loadPatterns(join(dir, "patterns")));
	assert.equal(custom("x ops_FAKEvalue123 acme-internal-thing"), "x [REDACTED] [REDACTED]");
});

test("output of secret-bearing commands and files is withheld entirely", () => {
	assert.ok(secretBearingCall("bash", { command: "env | sort" }));
	assert.ok(secretBearingCall("bash", { command: "cd x && op read op://v/i/credential" }));
	assert.ok(secretBearingCall("bash", { command: "cat apps/web/.env.local" }));
	assert.ok(secretBearingCall("read", { path: "/home/justin/.config/op/agents.env" }));
	assert.ok(secretBearingCall("read", { path: "/home/justin/.pi/agent/auth.json" }));
	assert.ok(!secretBearingCall("bash", { command: "git status --short" }));
	assert.ok(!secretBearingCall("read", { path: "src/environment.ts" }));
	assert.ok(!secretBearingCall("bash", { command: "pnpm run settings" }));
});

const at = (s: number) => new Date(Date.UTC(2026, 10, 25, 12, 0, s)).toISOString();
const entries: Entry[] = [
	{ type: "session", id: "s", timestamp: at(0) },
	{ type: "message", id: "u1", timestamp: at(1), message: { role: "user", content: [{ type: "text", text: `use ${FAKE_KEY}` }] } },
	{
		type: "message",
		id: "a1",
		timestamp: at(4),
		message: {
			role: "assistant",
			provider: "claude-bridge",
			model: "claude-opus-5-5",
			durationMs: 2000,
			stopReason: "toolUse",
			usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 1, cost: { total: 0.01 } },
			content: [
				{ type: "thinking", text: "private thoughts" },
				{ type: "text", text: "checking" },
				{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "env" } },
				{ type: "toolCall", id: "c2", name: "bash", arguments: { command: "echo hi", apiKey: "FAKEFAKEFAKE" } },
			],
		},
	},
	{ type: "message", id: "r1", timestamp: at(5), message: { role: "toolResult", toolCallId: "c1", toolName: "bash", durationMs: 500, content: [{ type: "text", text: "SECRET=FAKE123456789" }] } },
	{ type: "message", id: "r2", timestamp: at(6), message: { role: "toolResult", toolCallId: "c2", toolName: "bash", isError: true, durationMs: 500, content: [{ type: "text", text: "boom" }] } },
	{ type: "message", id: "a2", timestamp: at(8), message: { role: "assistant", provider: "anthropic", model: "claude-opus-5-5", durationMs: 1000, stopReason: "stop", content: [{ type: "text", text: "done" }] } },
	{ type: "message", id: "u2", timestamp: at(9), message: { role: "user", content: "unanswered" } },
];

test("a run becomes one Mastra trace with a single root and linked children", () => {
	const runs = splitRuns(entries);
	assert.equal(runs.length, 1);
	const spans = buildTrace(runs[0], { sessionId: "sess", cwd: "/repo", host: "b1", agent: "pi" }, redact);
	const json = JSON.stringify(spans);
	assert.ok(!json.includes(FAKE_KEY) && !json.includes("FAKE123456789") && !json.includes("FAKEFAKEFAKE") && !json.includes("private thoughts"));
	const ids = new Set(spans.map((s) => s.spanId));
	assert.equal(ids.size, spans.length);
	assert.equal(spans.filter((s) => s.parentSpanId === null).length, 1);
	for (const span of spans) {
		assert.match(span.traceId, /^[0-9a-f]{32}$/);
		assert.match(span.spanId, /^[0-9a-f]{16}$/);
		assert.ok(span.parentSpanId === null || ids.has(span.parentSpanId));
		assert.ok(Date.parse(span.endedAt) >= Date.parse(span.startedAt));
	}
	assert.deepEqual(spans.map((s) => s.spanType), ["agent_run", "model_generation", "tool_call", "tool_call", "model_generation"]);
	assert.equal(spans[0].output, "done");
	assert.deepEqual((spans[1].attributes as { usage: unknown }).usage, { inputTokens: 111, outputTokens: 5, inputDetails: { text: 10, cacheRead: 100, cacheWrite: 1 } });
	assert.equal((spans[1].attributes as { provider: string }).provider, "anthropic");
	assert.equal(spans[1].metadata.piProvider, "claude-bridge");
	assert.equal((spans[1].attributes as { costContext?: unknown }).costContext, undefined);
	assert.equal(spans[4].metadata.piProvider, undefined);
	assert.equal(spans[2].output, "[REDACTED: output of a secret-bearing command or file]");
	assert.deepEqual(spans[3].error, { message: "boom", name: "ToolError" });
	assert.deepEqual(buildTrace(runs[0], { sessionId: "sess", cwd: "/repo", host: "b1", agent: "pi" }, redact).map((s) => s.spanId), spans.map((s) => s.spanId));
});

test("project, endpoint and PII model come from the item notes", () => {
	assert.deepEqual(parseNotes("MASTRA_PROJECT_ID=abc-123\n"), { projectId: "abc-123", endpoint: "https://observability.mastra.ai", piiModel: "mastra/google/gemini-3.1-flash-lite" });
	assert.deepEqual(parseNotes("MASTRA_PROJECT_ID=p1\nMASTRA_PLATFORM_OBSERVABILITY_ENDPOINT=https://eu.example.com/\nPII_MODEL=mastra/anthropic/claude-haiku-5.5\n"), { projectId: "p1", endpoint: "https://eu.example.com", piiModel: "mastra/anthropic/claude-haiku-5.5" });
	assert.throws(() => parseNotes("MASTRA_PROJECT_ID=../x"));
	assert.throws(() => parseNotes("MASTRA_PROJECT_ID=p1\nMASTRA_PLATFORM_OBSERVABILITY_ENDPOINT=http://evil.example.com"));
});

const runCtx = { sessionId: "sess", cwd: "/repo", host: "b1", agent: "pi" as const };

test("PIIDetector output replaces each text field, and a failed check withholds the text", async () => {
	const spans = buildTrace(splitRuns(entries)[0], runCtx, redact);
	const detect = async (text: string) => {
		if (text.includes("boom")) throw new Error("gateway down");
		return text.replace(/done/g, "[NAME]");
	};
	const clean = await scrubPII(spans, detect);
	assert.equal(clean[0].output, "[NAME]");
	assert.equal(clean[4].output, "[NAME]");
	assert.deepEqual(clean[3].error, { message: "[REDACTED: PII check failed]", name: "ToolError" });
	assert.equal(clean[3].output, "[REDACTED: PII check failed]");
	assert.deepEqual(clean[2].input, { command: "env" });
	assert.equal(spans[0].output, "done");
	const big = await scrubPII([{ ...spans[0], input: "a".repeat(30_000), output: undefined }], async (t) => `<${t.length}>`);
	assert.equal(big[0].input, "<12000><12000><6000>");
});

test("export stops when the gateway key is missing, so text never skips the PII check", async () => {
	await assert.rejects(prepare(splitRuns(entries), runCtx, { token: FAKE_KEY, projectId: "p", endpoint: "https://x", piiModel: "m/m" }), /PII key could not be read/);
});

test("huge spans are clipped to fit a collector batch", () => {
	const span = { ...buildTrace(splitRuns(entries)[0], runCtx, redact)[1], output: "x".repeat(5 * 1024 * 1024) };
	assert.ok(Buffer.byteLength(JSON.stringify(fit(span))) < 4 * 1024 * 1024);
});

test("Mastra's SDK uploads the spans with real times, a bearer token, final redaction and priced usage", async () => {
	const got: { url?: string; auth?: string; body: { spans?: Record<string, unknown>[]; metrics?: Record<string, unknown>[] } }[] = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (d) => (body += d)).on("end", () => {
			got.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
			res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const t = { token: "FAKE", projectId: "proj_1", endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}`, gatewayKey: "msk-gateway-FAKE", piiModel: "m/m" };
	const spans = await prepare(splitRuns(entries), runCtx, t, async (text) => text);
	spans[0].output = "leaked msk-gateway-FAKE and ghp_FAKEfakeFAKEfakeFAKEfake0000";
	const instance = await sdkInstance(t, makeRedactor([t.gatewayKey]));
	emit(spans, instance);
	await instance.flush();
	await instance.shutdown();
	server.close();
	const sent = got.filter((g) => g.url === "/projects/proj_1/ai/spans/publish").flatMap((g) => g.body.spans ?? []);
	const metrics = got.filter((g) => g.url === "/projects/proj_1/ai/metrics/publish").flatMap((g) => g.body.metrics ?? []);
	assert.ok(got.every((g) => g.auth === "Bearer FAKE"));
	assert.equal(sent.length, spans.length);
	const root = sent.find((s) => s.parentSpanId === undefined || s.parentSpanId === null)!;
	assert.equal(root.traceId, spans[0].traceId);
	assert.equal(root.startedAt, spans[0].startedAt);
	assert.equal(root.endedAt, spans[0].endedAt);
	assert.equal(root.output, "leaked [REDACTED] and [REDACTED]");
	assert.ok(!JSON.stringify(got).includes("msk-gateway-FAKE") && !JSON.stringify(got).includes(FAKE_KEY));
	const priced = metrics.filter((m) => (m.costContext as { estimatedCost?: number } | undefined)?.estimatedCost !== undefined);
	assert.ok(priced.length > 0, "token metrics carry a Mastra price");
	assert.equal(sent.filter((s) => s.spanType === "tool_call" && s.error).length, 1);
	const gen = sent.find((s) => s.spanType === "model_generation")!;
	assert.deepEqual(gen.attributes, { model: "claude-opus-5-5", provider: "anthropic", finishReason: "toolUse", usage: { inputTokens: 111, outputTokens: 5, inputDetails: { text: 10, cacheRead: 100, cacheWrite: 1 } } });
	assert.deepEqual(root.metadata, { host: "b1", cwd: "/repo", sessionId: "sess", source: "pi-traces" });
	assert.deepEqual(root.tags, ["pi", "host:b1"]);
});

test("the toggle is a per-machine file outside git and defaults off", () => {
	process.env.PI_TRACES_STATE = mkdtempSync(join(tmpdir(), "pi-traces-state-"));
	assert.equal(isEnabled(), false);
	setEnabled(true);
	assert.equal(isEnabled(), true);
	setEnabled(false);
	assert.equal(isEnabled(), false);
});

test("when on without a gateway key, a settled run reports the problem and sends nothing", async () => {
	const bin = mkdtempSync(join(tmpdir(), "pi-traces-op-"));
	writeFileSync(join(bin, "op"), `#!/bin/sh\ncase "$3" in *fuk5gjk4eoh4oszvtiszjz4ime/credential) printf '%s' '${FAKE_KEY}';; *notesPlain) printf 'MASTRA_PROJECT_ID=proj_1\\n';; *) exit 1;; esac\n`, { mode: 0o755 });
	process.env.PATH = `${bin}:${process.env.PATH}`;
	process.env.PI_TRACES_STATE = mkdtempSync(join(tmpdir(), "pi-traces-state-"));
	const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
	const { default: piTraces } = await import("../pi-traces.ts");
	piTraces({ on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => (handlers[name] = fn), registerCommand: () => {} } as never);
	const statuses: (string | undefined)[] = [];
	const ctx = { cwd: "/repo", ui: { setStatus: (_k: string, v?: string) => statuses.push(v) }, sessionManager: { getSessionId: () => "sess", getSessionName: () => undefined, getBranch: () => entries.slice(0, -1) } };
	handlers.agent_settled({}, ctx);
	setEnabled(true);
	handlers.agent_settled({}, ctx);
	for (let i = 0; i < 100 && statuses.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
	assert.deepEqual(statuses, ["traces: the Mastra Gateway PII key could not be read from 1Password, so PIIDetector cannot run"]);
	await handlers.session_shutdown({}, ctx);
});
