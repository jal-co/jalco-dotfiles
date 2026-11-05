import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AssistantMessage, AssistantMessageEvent, Model, TranscriptContext } from "@earendil-works/pi-ai";
import { AccountPool } from "../pool.ts";
import { accountFailure, SubscriptionRouter, type BridgeStream } from "../router.ts";

const accounts = [{ id: "one", token: "first-test-token" }, { id: "two", token: "second-test-token" }];
const model: Model<"claude-bridge"> = {
  id: "claude-test", name: "Claude test", api: "claude-bridge", provider: "claude-bridge", baseUrl: "claude-bridge",
  reasoning: true, input: ["text"], contextWindow: 200000, maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const context = { messages: [{ role: "user", content: "test", timestamp: 1 }] } as TranscriptContext;

function output(stopReason: AssistantMessage["stopReason"] = "stop", errorMessage?: string): AssistantMessage {
  return {
    role: "assistant", api: model.api, model: model.id, provider: model.provider, content: [], timestamp: 1, stopReason, errorMessage,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

function failure(message = "Claude quota exceeded: rate limit"): AssistantMessageEvent {
  return { type: "error", reason: "error", error: output("error", message) };
}

function success(): AssistantMessageEvent {
  return { type: "done", reason: "stop", message: output() };
}

function fixture(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "pi-claude-router-test-"));
  t.after(() => rmSync(dir, { recursive: true }));
  const pool = new AccountPool(join(dir, "state.sqlite"));
  return { pool, router: new SubscriptionRouter(pool, () => accounts) };
}

async function collect(stream: AsyncIterable<AssistantMessageEvent>) {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

test("retries a rejected account on the other token without changing provider or context", async (t) => {
  const { router } = fixture(t);
  const used: string[] = [];
  const source: BridgeStream = async function* (selected, received, options) {
    assert.equal(selected, model);
    assert.equal(received, context);
    used.push(options?.env?.CLAUDE_CODE_OAUTH_TOKEN ?? "missing");
    yield { type: "start", partial: output("pending") };
    yield used.length === 1 ? failure() : success();
  };
  const events = await collect(router.stream(source, model, context, { sessionId: "session" }));
  assert.deepEqual(used, accounts.map((account) => account.token));
  assert.deepEqual(events.map((event) => event.type), ["start", "done"]);
  await collect(router.stream(source, model, context, { sessionId: "session" }));
  assert.equal(used.at(-1), accounts[1].token);
});

test("quota headers preserve exact reset and response observer", async (t) => {
  const { pool, router } = fixture(t);
  const reset = Math.floor(Date.now() / 1000) + 3600;
  const response = { status: 200, headers: { "anthropic-ratelimit-unified-status": "rejected", "anthropic-ratelimit-unified-reset": String(reset) } };
  let observed = 0;
  const source: BridgeStream = async function* (_, __, options) {
    if (options?.env?.CLAUDE_CODE_OAUTH_TOKEN === accounts[0].token) {
      await options.onResponse?.(response, model);
      yield failure("You're out of extra usage");
    } else yield success();
  };
  await collect(router.stream(source, model, context, { sessionId: "session", onResponse: (received) => { assert.equal(received, response); observed++; } }));
  assert.equal(observed, 1);
  assert.equal(pool.select(accounts, "next", new Set(), reset * 1000 - 1).id, "two");
  assert.equal(pool.select(accounts, "after-reset", new Set(), reset * 1000 + 1).id, "one");
});

test("both accounts exhausted terminates after one attempt each", async (t) => {
  const { router } = fixture(t);
  let attempts = 0;
  const source: BridgeStream = async function* () { attempts++; yield failure(); };
  const events = await collect(router.stream(source, model, context, { sessionId: "session" }));
  assert.equal(attempts, 2);
  const last = events.at(-1);
  assert.ok(last?.type === "error");
  assert.match(last.error.errorMessage ?? "", /subscriptions unavailable/);
  await collect(router.stream(source, model, context, { sessionId: "session" }));
  assert.equal(attempts, 2);
});

for (const eventType of ["text_start", "thinking_start", "toolcall_start"] as const) {
  test(`never replays after ${eventType}`, async (t) => {
    const { router } = fixture(t);
    let attempts = 0;
    const source: BridgeStream = async function* () {
      attempts++;
      yield { type: "start", partial: output("pending") };
      yield { type: eventType, contentIndex: 0, partial: output("pending") };
      yield failure();
    };
    const events = await collect(router.stream(source, model, context, { sessionId: "session" }));
    assert.equal(attempts, 1);
    const last = events.at(-1);
    assert.ok(last?.type === "error");
    assert.match(last.error.errorMessage ?? "", /No automatic replay/);
    assert.doesNotMatch(last.error.errorMessage ?? "", /rate limit|429/i);
  });
}

test("completed tool results stay on the parked account even if another process blocks it", async (t) => {
  const { router, pool } = fixture(t);
  const toolMessage = output("toolUse");
  toolMessage.content = [{ type: "toolCall", id: "tool-1", name: "write", arguments: { path: "test.txt", content: "done" } }];
  const tokens: string[] = [];
  const source: BridgeStream = async function* (_, received, options) {
    tokens.push(options?.env?.CLAUDE_CODE_OAUTH_TOKEN ?? "missing");
    if (tokens.length === 1) {
      yield { type: "start", partial: toolMessage };
      yield { type: "done", reason: "toolUse", message: toolMessage };
    } else if (tokens.length === 2) yield failure();
    else {
      assert.equal(received.messages.at(-1)?.role, "toolResult");
      yield success();
    }
  };
  await collect(router.stream(source, model, context, { sessionId: "session" }));
  pool.block(accounts[0], "quota", Date.now() + 60_000);
  const continuation = { messages: [...context.messages, toolMessage, { role: "toolResult", toolCallId: "tool-1", toolName: "write", content: [{ type: "text", text: "written" }], isError: false, timestamp: 2 }] } as TranscriptContext;
  const events = await collect(router.stream(source, model, continuation, { sessionId: "session" }));
  assert.deepEqual(tokens, [accounts[0].token, accounts[0].token, accounts[1].token]);
  assert.equal(events.at(-1)?.type, "done");
});

test("concurrent sessions keep credentials isolated without process.env mutation", async (t) => {
  const { router } = fixture(t);
  const previous = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const seen = new Map<string, string>();
  const source: BridgeStream = async function* (_, __, options) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    seen.set(options?.sessionId ?? "missing", options?.env?.CLAUDE_CODE_OAUTH_TOKEN ?? "missing");
    yield success();
  };
  await Promise.all(["one", "two"].map((sessionId) => collect(router.stream(source, model, context, { sessionId }))));
  assert.deepEqual(new Set(seen.values()), new Set(accounts.map((account) => account.token)));
  assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN, previous);
});

test("abort before or during a failure never tries another account", async (t) => {
  const { router } = fixture(t);
  const controller = new AbortController();
  let calls = 0;
  const source: BridgeStream = async function* () { calls++; controller.abort(); yield failure(); };
  const events = await collect(router.stream(source, model, context, { sessionId: "session", signal: controller.signal }));
  assert.equal(calls, 1);
  assert.equal(events.at(-1)?.type, "error");
  await collect(router.stream(source, model, context, { sessionId: "session", signal: controller.signal }));
  assert.equal(calls, 1);
});

test("invalid authentication fails over but model-access and network errors do not", async (t) => {
  const { router } = fixture(t);
  let calls = 0;
  const source: BridgeStream = async function* () { calls++; yield calls === 1 ? failure("API Error: 401 Unauthorized") : success(); };
  await collect(router.stream(source, model, context, { sessionId: "session" }));
  assert.equal(calls, 2);
  for (const message of ["HTTP 403 forbidden", "model unavailable", "socket disconnected", "write failed: rate limit"] ) {
    assert.equal(accountFailure(message), undefined);
  }
});

test("exception and malformed streams produce terminal errors without replay", async (t) => {
  const { router } = fixture(t);
  for (const source of [
    () => { throw new Error(accounts[0].token); },
    async function* (): AsyncGenerator<AssistantMessageEvent> { yield { type: "start", partial: output("pending") }; },
  ]) {
    const events = await collect(router.stream(source, model, context, { sessionId: "session" }));
    const last = events.at(-1);
    assert.ok(last?.type === "error");
    assert.equal(JSON.stringify(events).includes(accounts[0].token), false);
  }
});

test("reported errors redact account tokens", async (t) => {
  const { router } = fixture(t);
  const source: BridgeStream = async function* () {
    const error = output("error", `Rejected secret ${accounts[0].token}`);
    error.content = [{ type: "text", text: `Rejected secret ${accounts[0].token}` }];
    yield { type: "error", reason: "error", error };
  };
  const events = await collect(router.stream(source, model, context, { sessionId: "session" }));
  assert.equal(JSON.stringify(events).includes(accounts[0].token), false);
});

test("unknown quota reset uses a finite cooldown, not a permanent lockout", () => {
  assert.deepEqual(accountFailure("Claude quota exceeded", undefined, 1000), { reason: "quota", until: 61_000 });
  assert.deepEqual(accountFailure("limit", { status: 429, headers: { "retry-after": "90" } }, 1000), { reason: "quota", until: 91_000 });
});

test("refuses missing session identity and simultaneous requests for one session", async (t) => {
  const { router } = fixture(t);
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const source: BridgeStream = async function* () { calls++; await gate; yield success(); };
  const missing = await collect(router.stream(source, model, context));
  assert.equal(calls, 0);
  const first = collect(router.stream(source, model, context, { sessionId: "session" }));
  const second = await collect(router.stream(source, model, context, { sessionId: "session" }));
  release();
  assert.equal((await first).at(-1)?.type, "done");
  assert.equal(calls, 1);
  assert.ok(missing[0].type === "error" && second[0].type === "error");
  assert.match(second[0].error.errorMessage ?? "", /already has a request/);
});

test("isolated summary requests can use the pool without a session id", async (t) => {
  const { router } = fixture(t);
  let calls = 0;
  const source: BridgeStream = async function* () { calls++; yield calls === 1 ? failure("You're out of extra usage") : success(); };
  const events = await collect(router.stream(source, model, context, { cacheRetention: "none" }));
  assert.equal(calls, 2);
  assert.equal(events.at(-1)?.type, "done");
});

test("malformed reset headers cannot create an invalid persistent date", () => {
  for (const reset of ["Infinity", "bad", "-100", "9000000000000"]) {
    assert.deepEqual(accountFailure("Claude quota exceeded", { status: 200, headers: { "anthropic-ratelimit-unified-reset": reset } }, 1000), { reason: "quota", until: 61_000 });
  }
});
