import type { Message as PiMessage } from "@earendil-works/pi-ai";
import type { Config } from "./config.js";
import { renderCompactedHistory, toCompactionMessages } from "./messages.js";
import { compact } from "./upstream/compact.js";
import { buildJevRequest, parseJevResponse } from "./upstream/request.js";
import { goalFromMessages } from "./upstream/state.js";
import type { CompactResult, JevAsker, JevQuestions, JevState } from "./upstream/types.js";

export interface PiCompactionResult {
	result: CompactResult;
	summary: string;
}

function asker(config: Config, apiKey: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): JevAsker {
	return {
		async ask(state: JevState, questions: JevQuestions) {
			const request = buildJevRequest(
				{ apiKey, model: config.model, baseUrl: config.baseUrl },
				state,
				questions,
			);
			const response = await fetcher(request.url, {
				method: request.method,
				headers: request.headers,
				body: request.body,
				signal,
			});
			return parseJevResponse(response.status, response.ok, await response.text());
		},
	};
}

export async function compactForPi(
	messages: PiMessage[],
	previousSummary: string | undefined,
	customInstructions: string | undefined,
	config: Config,
	apiKey: string,
	signal?: AbortSignal,
	fetcher: typeof fetch = fetch,
): Promise<PiCompactionResult> {
	const source = toCompactionMessages(messages);
	const goal = [goalFromMessages(source), customInstructions?.trim()].filter(Boolean).join("\n");
	const result = await compact(source, asker(config, apiKey, signal, fetcher), {
		goal,
		keepThreshold: config.keepThreshold,
		preserveRecentMessages: config.preserveRecentMessages,
		maxStateTokens: config.maxStateTokens,
		maxRequestTokens: config.maxRequestTokens,
		truncateHeadChars: config.truncateHeadChars,
	});
	return { result, summary: renderCompactedHistory(result.messages, previousSummary) };
}
