import assert from "node:assert/strict";
import test from "node:test";
import { withAddedModels } from "../added-models.ts";

const model = (id: string, name: string, contextWindow = 1_000_000) => ({ id, name, contextWindow, maxTokens: 128_000, reasoning: true });

test("Fable 5.2 is added beside Fable 5.1 with the bare-id context window until Pi's catalog has it", () => {
  const models = [model("claude-fable-5-1", "Claude Fable 5.1 1M"), model("claude-opus-5-5", "Claude Opus 5.5 1M")];
  const result = withAddedModels(models);
  assert.deepEqual(result.map((entry) => entry.id), ["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5"]);
  assert.deepEqual(result[0], { id: "claude-fable-5-2", name: "Claude Fable 5.2", contextWindow: 200_000, maxTokens: 128_000, reasoning: true });
  assert.equal(models.length, 2);
});

test("a catalog that already has Fable 5.2, or lacks Fable 5.1, is left unchanged", () => {
  const native = [model("claude-fable-5-2", "Claude Fable 5.2 1M"), model("claude-fable-5-1", "Claude Fable 5.1 1M")];
  assert.deepEqual(withAddedModels(native), native);
  const older = [model("claude-opus-5-5", "Claude Opus 5.5 1M")];
  assert.deepEqual(withAddedModels(older), older);
});
