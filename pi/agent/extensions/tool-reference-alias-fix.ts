import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// pi-claude-code-use renames flat extension tools to mcp__<server>__<tool> for
// Anthropic OAuth, but its remapMessageToolNames only rewrites "tool_use"
// blocks. Deferred-tool "tool_reference" blocks keep the flat name, so Anthropic
// rejects the request with "Tool reference '<name>' not found in available tools".

interface Block {
	type?: string;
	tool_name?: string;
	content?: unknown;
	[key: string]: unknown;
}

function isBlock(value: unknown): value is Block {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectToolNames(tools: unknown): Set<string> {
	const names = new Set<string>();
	if (!Array.isArray(tools)) return names;
	for (const tool of tools) {
		if (isBlock(tool) && typeof tool.name === "string") names.add(tool.name);
	}
	return names;
}

function resolveAlias(flatName: string, names: Set<string>): string | undefined {
	if (names.has(flatName)) return flatName;
	const suffix = `__${flatName}`;
	for (const name of names) {
		if (name.startsWith("mcp__") && name.endsWith(suffix)) return name;
	}
	return undefined;
}

function fixBlocks(blocks: unknown, names: Set<string>): { blocks: unknown; changed: boolean } {
	if (!Array.isArray(blocks)) return { blocks, changed: false };

	let changed = false;
	const next: unknown[] = [];

	for (const block of blocks) {
		if (!isBlock(block)) {
			next.push(block);
			continue;
		}

		if (block.type === "tool_reference" && typeof block.tool_name === "string") {
			const resolved = resolveAlias(block.tool_name, names);
			if (resolved === undefined) {
				changed = true;
				continue;
			}
			if (resolved !== block.tool_name) {
				changed = true;
				next.push({ ...block, tool_name: resolved });
				continue;
			}
			next.push(block);
			continue;
		}

		if (block.type === "tool_result") {
			const inner = fixBlocks(block.content, names);
			if (inner.changed) {
				changed = true;
				const content = Array.isArray(inner.blocks) && inner.blocks.length === 0 ? "" : inner.blocks;
				next.push({ ...block, content });
				continue;
			}
		}

		next.push(block);
	}

	return { blocks: next, changed };
}

export function alignToolReferences(payload: unknown): Record<string, unknown> | undefined {
	if (!isBlock(payload) || !Array.isArray(payload.messages)) return undefined;

	const names = collectToolNames(payload.tools);
	if (names.size === 0) return undefined;

	let changed = false;
	const messages = payload.messages.map((message) => {
		if (!isBlock(message)) return message;
		const result = fixBlocks(message.content, names);
		if (!result.changed) return message;
		changed = true;
		return { ...message, content: result.blocks };
	});

	return changed ? { ...payload, messages } : undefined;
}

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (event, ctx) => {
		if (ctx.model?.provider !== "anthropic") return undefined;
		return alignToolReferences(event.payload);
	});
}
