import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { createThinkingText } from "../thinking-text.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function assistant(thinking: string, signature = "sig-1"): AssistantMessage {
  return {
    role: "assistant", api: "claude-bridge", provider: "claude-bridge", model: "m", timestamp: 1, usage, stopReason: "toolUse",
    content: [{ type: "thinking", thinking, thinkingSignature: signature }, { type: "toolCall", id: "t1", name: "bash", arguments: {} }],
  };
}

const thinkingOf = (message: Message | undefined) => {
  if (message?.role !== "assistant") throw new Error("expected an assistant message");
  const block = message.content[0];
  if (block.type !== "thinking") throw new Error("expected a thinking block");
  return block.thinking;
};

test("text trimmed by another extension is restored to what the provider produced", () => {
  const store = createThinkingText();
  store.remember(assistant("Check the logs first.\n\n"));
  const user: Message = { role: "user", content: "hi", timestamp: 1 };
  const { messages, restored } = store.restore([user, assistant("Check the logs first.")]);
  assert.equal(restored, 1);
  assert.equal(thinkingOf(messages[1]), "Check the logs first.\n\n");
  assert.equal(messages[0], user);
});

test("remembering copies the text, so later edits to the stored message do not leak in", () => {
  const store = createThinkingText();
  const original = assistant("Plan.\n");
  store.remember(original);
  const block = original.content[0];
  if (block.type === "thinking") block.thinking = "\u001b[1mThinking:\u001b[0m Plan.";
  assert.equal(thinkingOf(store.restore([assistant("Plan.")]).messages[0]), "Plan.\n");
});

test("unknown signatures and identical text return the very same array", () => {
  const store = createThinkingText();
  store.remember(assistant("Same", "known"));
  const input: Message[] = [{ role: "user", content: "x", timestamp: 1 }, assistant("Same", "known"), assistant("Other\n", "unknown")];
  const { messages, restored } = store.restore(input);
  assert.equal(restored, 0);
  assert.equal(messages, input);
});

test("the stored messages are never mutated and only the thinking text changes", () => {
  const store = createThinkingText();
  store.remember(assistant("Raw\n\n"));
  const stored = assistant("Raw");
  const input: Message[] = [stored];
  const { messages } = store.restore(input);
  assert.notEqual(messages, input);
  assert.notEqual(messages[0], stored);
  assert.equal(thinkingOf(stored), "Raw");
  assert.equal(input[0], stored);
  const rebuilt = messages[0];
  assert.ok(rebuilt?.role === "assistant");
  assert.deepEqual(rebuilt.content[1], stored.content[1]);
});

test("the oldest remembered blocks are dropped first", () => {
  const store = createThinkingText();
  for (let n = 0; n < 4100; n++) store.remember(assistant(`t${n}\n`, `s${n}`));
  const { restored } = store.restore([assistant("t0", "s0"), assistant("t4099", "s4099")]);
  assert.equal(restored, 1);
});
