import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { __test } from "pi-claude-bridge/src/index.ts";
import pool from "../../index.ts";

export default function smoke(pi) {
  const attempts = [];
  __test.setQuery(({ options }) => {
    const env = options?.env;
    const account = env?.CLAUDE_CODE_OAUTH_TOKEN === "first-smoke-token" ? "one" : env?.CLAUDE_CODE_OAUTH_TOKEN === "second-smoke-token" ? "two" : "unexpected";
    assert.notEqual(account, "unexpected");
    assert.equal(env?.CLAUDE_POOL_ONE, undefined);
    assert.equal(env?.CLAUDE_POOL_TWO, undefined);
    assert.equal(env?.ANTHROPIC_API_KEY, undefined);
    attempts.push(account);
    const sessionId = options?.sessionId ?? options?.resume ?? "smoke-session";
    async function* messages() {
      if (account === "one") {
        yield { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: Math.floor(Date.now() / 1000) + 60, rateLimitType: "five_hour" }, session_id: sessionId, uuid: "limit-event" };
        yield {
          type: "assistant", error: "rate_limit", session_id: sessionId, uuid: "synthetic-error", parent_tool_use_id: null,
          message: { id: "synthetic-error", role: "assistant", model: "<synthetic>", content: [{ type: "text", text: "You're out of extra usage" }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } },
        };
      }
      yield {
        type: "result", subtype: "success", is_error: account === "one", result: account === "one" ? "Subscription exhausted" : "pool smoke passed",
        session_id: sessionId, uuid: `result-${account}`, num_turns: 1, duration_ms: 1, duration_api_ms: 1, total_cost_usd: 0,
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, modelUsage: {}, permission_denials: [],
      };
    }
    const output = Object.assign(messages(), { close() {}, async interrupt() {} });
    writeFileSync(process.env.POOL_TEST_CAPTURE ?? "", JSON.stringify({ attempts }), { mode: 0o600 });
    return output;
  });
  pool(pi);
}
