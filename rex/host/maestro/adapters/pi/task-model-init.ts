import { getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import type {
	TaskModelRegistrySource,
	TaskModelRegistrySnapshot,
} from "../../core/config/task-model-init.ts";

const AUTH_SOURCES = new Set([
	"stored",
	"runtime",
	"environment",
	"fallback",
	"models_json_key",
	"models_json_command",
]);

/** Project only nonsecret registry facts; never resolve authentication or refresh providers. */
export function projectTaskModelRegistry(
	registry: TaskModelRegistrySource,
): TaskModelRegistrySnapshot {
	const extensionProviders = registry.getRegisteredProviderIds?.();
	const models = registry.getAvailable().map((model) => {
		const source = registry.getProviderAuthStatus?.(model.provider)?.source;
		return {
			ref: `${model.provider}/${model.id}`,
			provider: model.provider,
			id: model.id,
			name: model.name,
			extensionRegistered: extensionProviders?.includes(model.provider),
			auth: {
				configured: true as const,
				source: source && AUTH_SOURCES.has(source) ? source : undefined,
			},
			reasoning: model.reasoning,
			// SAFETY: the SDK helper reads only reasoning and thinkingLevelMap.
			// Pass the original active model, not a reconstructed SDK model.
			supportedThinkingLevels: getSupportedThinkingLevels(model as Model<any>),
			input: model.input?.filter(
				(value) => value === "text" || value === "image",
			),
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			cost: model.cost && {
				input: model.cost.input,
				output: model.cost.output,
				cacheRead: model.cost.cacheRead,
				cacheWrite: model.cost.cacheWrite,
			},
		};
	});
	models.sort((a, b) => {
		if (a.ref === b.ref) return 0;
		return a.ref < b.ref ? -1 : 1;
	});
	return { models };
}
