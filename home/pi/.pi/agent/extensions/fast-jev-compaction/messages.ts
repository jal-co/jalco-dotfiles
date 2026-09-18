import type { ImageContent, Message as PiMessage, TextContent } from "@earendil-works/pi-ai";
import type { Message, ToolUse } from "./upstream/types.js";

function contentText(content: string | (TextContent | ImageContent)[]): string {
	if (!Array.isArray(content)) return content;
	return content
		.map(item => (item.type === "text" ? item.text : `[image ${item.mimeType} omitted]`))
		.join("\n");
}

function assistantText(message: Extract<PiMessage, { role: "assistant" }>): string {
	return message.content.flatMap(item => (item.type === "text" ? [item.text] : [])).join("\n");
}

function toMessage(message: PiMessage): Message {
	if (message.role === "user") {
		return { role: "user", text: contentText(message.content), toolUses: [] };
	}
	if (message.role === "toolResult") {
		return {
			role: "user",
			text: "",
			toolUses: [],
			toolResults: [
				{
					tool_use_id: message.toolCallId,
					text: contentText(message.content),
					isError: message.isError,
				},
			],
		};
	}
	return {
		role: "assistant",
		text: assistantText(message),
		toolUses: message.content.flatMap(item =>
			item.type === "toolCall"
				? [{ tool_use_id: item.id, tool: item.name, input: item.arguments }]
				: [],
		),
	};
}

export function toCompactionMessages(messages: PiMessage[]): Message[] {
	return messages.map(toMessage);
}

function json(value: ToolUse["input"]): string {
	try {
		return JSON.stringify(value);
	} catch {
		return "[unserializable tool input]";
	}
}

export function renderCompactedHistory(messages: readonly Message[], previousSummary?: string): string {
	const parts: string[] = [];
	if (previousSummary?.trim()) parts.push(previousSummary.trim());
	for (const message of messages) {
		if (message.text) parts.push(`[${message.role === "user" ? "User" : "Assistant"}]\n${message.text}`);
		for (const tool of message.toolUses) {
			parts.push(`[Assistant tool call ${tool.tool} ${tool.tool_use_id}]\n${json(tool.input)}`);
		}
		for (const result of message.toolResults ?? []) {
			parts.push(`[Tool result ${result.tool_use_id}${result.isError ? " error" : ""}]\n${result.text}`);
		}
	}
	return parts.join("\n\n");
}
