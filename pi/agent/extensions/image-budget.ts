import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const KEEP_RECENT_IMAGES = 4;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const OMITTED_NOTE =
	"[Earlier image omitted to keep the request under the provider size limit. Capture it again if you still need to see it.]";

interface Part {
	type?: string;
	data?: string;
	[key: string]: unknown;
}

interface Message {
	role?: string;
	content?: unknown;
	[key: string]: unknown;
}

function isImage(part: unknown): part is Part {
	return typeof part === "object" && part !== null && (part as Part).type === "image";
}

function imageBytes(part: Part): number {
	return typeof part.data === "string" ? part.data.length : 0;
}

export function pruneImages<T extends Message>(messages: T[]): { messages: T[]; omitted: number } {
	const kept = new Set<Part>();
	let budget = MAX_IMAGE_BYTES;
	let count = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		const content = messages[i].content;
		if (!Array.isArray(content)) continue;
		for (let j = content.length - 1; j >= 0; j--) {
			const part = content[j];
			if (!isImage(part)) continue;
			const size = imageBytes(part);
			if (count < KEEP_RECENT_IMAGES && size <= budget) {
				kept.add(part);
				budget -= size;
				count++;
			}
		}
	}

	let omitted = 0;
	const next = messages.map((message) => {
		const content = message.content;
		if (!Array.isArray(content) || !content.some((part) => isImage(part) && !kept.has(part))) return message;
		const replaced = content.map((part) => {
			if (!isImage(part) || kept.has(part)) return part;
			omitted++;
			return { type: "text", text: OMITTED_NOTE };
		});
		return { ...message, content: replaced };
	});
	return { messages: next, omitted };
}

export default function imageBudget(pi: ExtensionAPI): void {
	pi.on("context", (event) => {
		const { messages, omitted } = pruneImages(event.messages as Message[]);
		if (omitted === 0) return;
		return { messages: messages as typeof event.messages };
	});
}
