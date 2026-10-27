import {
	clampThinkingLevel,
	getSupportedThinkingLevels,
	type Model,
} from "@earendil-works/pi-ai";
import {
	createModelRegistryAdapter,
	type ModelRegistryAdapter,
	type RoutingModel,
	type RoutingRegistrySource,
} from "../../core/routing.ts";

export function wrapPiModelRegistry(
	registry: RoutingRegistrySource,
): ModelRegistryAdapter {
	return createModelRegistryAdapter(registry, {
		supportedThinkingLevels: (model) =>
			getSupportedThinkingLevels(asPiModel(model)),
		clampThinkingLevel: (model, level) =>
			clampThinkingLevel(asPiModel(model), level),
	});
}

function asPiModel(model: RoutingModel): Model<any> {
	return {
		provider: model.provider,
		id: model.id,
		name: model.id,
		api: "openai-completions",
		baseUrl: "",
		reasoning: model.reasoning,
		thinkingLevelMap: model.thinkingLevelMap,
		input: model.input?.filter(
			(entry): entry is "text" | "image" =>
				entry === "text" || entry === "image",
		) ?? ["text"],
		contextWindow: model.contextWindow ?? 0,
		maxTokens: model.maxTokens ?? 0,
		cost: {
			input: model.cost?.input ?? 0,
			output: model.cost?.output ?? 0,
			cacheRead: model.cost?.cacheRead ?? 0,
			cacheWrite: model.cost?.cacheWrite ?? 0,
		},
	};
}
