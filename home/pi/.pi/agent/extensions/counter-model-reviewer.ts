import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OPUS_REVIEWER = "anthropic/claude-opus-5";
const SOL_REVIEWER = "openai-codex/gpt-5.6-sol";

export function resolveReviewerModel(provider: string, modelId: string): string | undefined {
	if (provider === "openai-codex" || modelId.startsWith("gpt-")) return OPUS_REVIEWER;
	if (provider === "anthropic" || modelId.startsWith("claude-")) return SOL_REVIEWER;
	return undefined;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "spawn_agent") return;

		const input = event.input as { agent_type?: string; model?: string };
		if (input.agent_type !== "reviewer") return;

		const provider = ctx.model?.provider;
		const modelId = ctx.model?.id;
		if (!provider || !modelId) {
			return { block: true, reason: "Reviewer routing requires an active parent provider and model." };
		}

		const reviewerModel = resolveReviewerModel(provider, modelId);
		if (!reviewerModel) {
			return {
				block: true,
				reason: `No counter-provider reviewer is configured for ${provider}/${modelId}.`,
			};
		}

		input.model = reviewerModel;
	});
}
