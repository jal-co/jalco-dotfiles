import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const KEEP_RECENT_IMAGES = 12;
export const PRUNE_STEP = 6;
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
	const images: Part[] = [];
	for (const message of messages) {
		if (!Array.isArray(message.content)) continue;
		for (const part of message.content) if (isImage(part)) images.push(part);
	}
	const surplus = images.length - KEEP_RECENT_IMAGES;
	const dropByCount = surplus > 0 ? Math.floor((surplus + PRUNE_STEP - 1) / PRUNE_STEP) * PRUNE_STEP : 0;

	const dropped = new Set<Part>(images.slice(0, dropByCount));
	let budget = MAX_IMAGE_BYTES;
	for (let i = images.length - 1; i >= dropByCount; i--) {
		const size = imageBytes(images[i]);
		if (size <= budget) budget -= size;
		else dropped.add(images[i]);
	}

	let omitted = 0;
	const next = messages.map((message) => {
		const content = message.content;
		if (!Array.isArray(content) || !content.some((part) => isImage(part) && dropped.has(part))) return message;
		const replaced = content.map((part) => {
			if (!isImage(part) || !dropped.has(part)) return part;
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
