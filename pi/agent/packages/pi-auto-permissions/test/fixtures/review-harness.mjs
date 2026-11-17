import { createFauxCore, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { appendFileSync } from "node:fs";
import autoPermissions from "../../index.ts";

export default function reviewHarness(pi) {
  const agent = fauxProvider({ provider: "fixture-agent", api: "fixture-agent", models: [{ id: "agent" }] });
  const guardedCall = () => fauxAssistantMessage(fauxToolCall("bash", { command: process.env.AP_TEST_COMMAND }), { stopReason: "toolUse" });
  agent.setResponses([guardedCall(), guardedCall(), fauxAssistantMessage(fauxText("done"))]);
  pi.registerProvider(agent.provider);

  const mode = process.env.AP_TEST_REVIEWER;
  if (mode !== "missing") {
    const api = process.env.AP_TEST_REVIEWER_API ?? "fixture-reviewer";
    const reviewer = createFauxCore({ provider: "fixture-reviewer", api, models: [{ id: "reviewer", reasoning: true }] });
    const verdict = (context, options) => {
      const prompt = JSON.stringify(context.messages.at(-1)?.content);
      appendFileSync(process.env.AP_TEST_CALLS, `${JSON.stringify({
        reasoning: options?.reasoning,
        cacheRetention: options?.cacheRetention,
        evidence: prompt.match(/<EVIDENCE mode=\\"(\w+)\\">/)?.[1],
      })}\n`);
      return mode === "error"
        ? fauxAssistantMessage([], { stopReason: "error", errorMessage: "fixture reviewer outage" })
        : fauxAssistantMessage(fauxText('{"decision":"approve","reason":"fixture approval"}'));
    };
    reviewer.setResponses([verdict, verdict]);
    pi.registerProvider("fixture-reviewer", {
      baseUrl: "fixture-reviewer",
      apiKey: "not-used",
      api,
      models: reviewer.models.map(({ id, name, reasoning, input, cost, contextWindow, maxTokens }) => ({ id, name, reasoning, input, cost, contextWindow, maxTokens })),
      streamSimple: reviewer.streamSimple,
    });
  }

  autoPermissions(pi);
}
