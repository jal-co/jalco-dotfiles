import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clip, createExporter, loadSettings, makeSpan, textOf, usageAttributes, type SpanRecord } from "../mastra-traces.ts";

const metadata = { sessionId: "s", repo: "r", host: "h", rexAgent: false };
const base = { traceId: "a".repeat(32), name: "x", type: "tool_call" as const, start: 1000, end: 2000, metadata, content: "previews" as const };
const record = (id: string): SpanRecord => makeSpan({ ...base, id });

test("previews cut input and output to 100 characters and full keeps more", () => {
	const long = "z".repeat(500);
	const preview = makeSpan({ ...base, input: long, output: long });
	assert.equal(preview.input?.length, 100);
	const full = makeSpan({ ...base, input: long, content: "full" });
	assert.equal(full.input?.length, 500);
	assert.equal(full.inputPreview?.length, 100);
});

test("spans carry the ids and aliases the collector expects", () => {
	const root = makeSpan({ ...base, id: "r".repeat(16), type: "agent_run" });
	assert.equal(root.isRootSpan, true);
	assert.equal(root.spanId, root.id);
	assert.equal(root.startedAt, "1970-01-01T00:00:01.000Z");
	const child = makeSpan({ ...base, parentSpanId: "r".repeat(16), error: "boom" });
	assert.equal(child.isRootSpan, false);
	assert.deepEqual(child.errorInfo, { message: "boom" });
});

test("usage folds cache tokens into the input total", () => {
	assert.deepEqual(usageAttributes({ input: 10, output: 5, cacheRead: 100, cacheWrite: 1000 }), {
		inputTokens: 1110,
		outputTokens: 5,
		inputDetails: { text: 10, cacheRead: 100, cacheWrite: 1000 },
	});
	assert.equal(usageAttributes({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }).inputTokens, 0);
});

test("textOf reads strings and text blocks only", () => {
	assert.equal(textOf("hi"), "hi");
	assert.equal(textOf([{ type: "text", text: "a" }, { type: "thinking", thinking: "no" }, { type: "text", text: "b" }]), "a\nb");
	assert.equal(clip(undefined, 5), undefined);
	assert.equal(clip("abcdefg", 5), "abcde");
});

test("settings need both files and fall back to preview mode", () => {
	const dir = mkdtempSync(join(tmpdir(), "mastra-obs-"));
	assert.equal(loadSettings(dir, {}), undefined);
	writeFileSync(join(dir, "config.json"), JSON.stringify({ projectId: "p1" }));
	assert.equal(loadSettings(dir, {}), undefined);
	writeFileSync(join(dir, "access-token"), "tok\n");
	assert.deepEqual(loadSettings(dir, {}), { token: "tok", projectId: "p1", content: "previews" });
	assert.equal(loadSettings(dir, { MASTRA_PLATFORM_ACCESS_TOKEN: "env" })?.token, "env");
});

test("the exporter posts one batch with the bearer token and reports rejections once per call", async () => {
	const calls: { url: string; init: RequestInit }[] = [];
	const errors: string[] = [];
	const send: typeof fetch = async (url, init) => {
		calls.push({ url: String(url), init: init ?? {} });
		return new Response("no", { status: calls.length === 1 ? 200 : 401 });
	};
	const exporter = createExporter({ token: "secret", projectId: "p1", content: "previews" }, send, (m) => errors.push(m));
	exporter.add(record("1"));
	exporter.add(record("2"));
	await exporter.flush();
	await exporter.flush();
	exporter.add(record("3"));
	await exporter.flush();
	assert.equal(calls.length, 2);
	assert.equal(calls[0].url, "https://observability.mastra.ai/projects/p1/ai/spans/publish");
	assert.deepEqual(JSON.parse(String(calls[0].init.body)).spans.map((span: SpanRecord) => span.id), ["1", "2"]);
	assert.deepEqual(new Headers(calls[0].init.headers).get("authorization"), "Bearer secret");
	assert.deepEqual(errors, ["Mastra rejected 1 spans (HTTP 401)"]);
});
