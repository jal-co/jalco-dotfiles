import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, join } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const CONFIG_DIR = join(homedir(), ".config", "mastra-observability");
const ENDPOINT = "https://observability.mastra.ai";
const PREVIEW_CHARS = 100;
const FULL_CHARS = 20_000;
const FLUSH_MS = 5000;
const CACHE_MISS_TOKENS = 10_000;

export type Content = "previews" | "full";

export interface Settings {
	token: string;
	projectId: string;
	content: Content;
}

const ConfigSchema = Type.Object({
	projectId: Type.String({ minLength: 1 }),
	content: Type.Optional(Type.Union([Type.Literal("previews"), Type.Literal("full")])),
});

export function loadSettings(dir = CONFIG_DIR, env = process.env): Settings | undefined {
	try {
		const config = Value.Parse(ConfigSchema, JSON.parse(readFileSync(join(dir, "config.json"), "utf8")));
		const token = env.MASTRA_PLATFORM_ACCESS_TOKEN || readFileSync(join(dir, "access-token"), "utf8").trim();
		if (!token) return undefined;
		return { token, projectId: config.projectId, content: config.content ?? "previews" };
	} catch {
		return undefined;
	}
}

export function clip(text: string | undefined, limit: number): string | undefined {
	return text?.slice(0, limit);
}

const hex = (bytes: number) => randomBytes(bytes).toString("hex");

export interface SpanMetadata {
	sessionId: string;
	repo: string;
	branch?: string;
	host: string;
	rexSession?: string;
	rexAgent: boolean;
	cacheMiss?: boolean;
	modelCalls?: number;
}

export interface ModelAttributes {
	model: string;
	provider: string;
	usage: UsageAttributes;
	finishReason: string;
}

export interface ToolAttributes {
	toolCallId: string;
	success: boolean;
}

export interface AgentAttributes {
	conversationId: string;
}

export interface SpanFields {
	id?: string;
	traceId: string;
	parentSpanId?: string;
	name: string;
	type: "agent_run" | "model_generation" | "tool_call";
	start: number;
	end: number;
	input?: string;
	output?: string;
	attributes?: ModelAttributes | ToolAttributes | AgentAttributes;
	metadata: SpanMetadata;
	tags?: string[];
	error?: string;
	content: Content;
}

export interface SpanRecord extends Omit<SpanFields, "start" | "end" | "content" | "error" | "input" | "output"> {
	spanId: string;
	spanType: SpanFields["type"];
	isRootSpan: boolean;
	isEvent: boolean;
	entityType: "agent";
	entityId: "pi";
	entityName: "pi";
	startTime: string;
	startedAt: string;
	endTime: string;
	endedAt: string;
	input?: string;
	output?: string;
	inputPreview?: string;
	outputPreview?: string;
	errorInfo: { message: string } | null;
	error: { message: string } | null;
	createdAt: string;
	updatedAt: null;
}

export function makeSpan(f: SpanFields): SpanRecord {
	const limit = f.content === "full" ? FULL_CHARS : PREVIEW_CHARS;
	const id = f.id ?? hex(8);
	const start = new Date(f.start).toISOString();
	const end = new Date(f.end).toISOString();
	const input = clip(f.input, limit);
	const output = clip(f.output, limit);
	const errorInfo = f.error === undefined ? null : { message: f.error.slice(0, limit) };
	return {
		id,
		spanId: id,
		traceId: f.traceId,
		parentSpanId: f.parentSpanId,
		name: f.name,
		type: f.type,
		spanType: f.type,
		isRootSpan: f.parentSpanId === undefined,
		isEvent: false,
		entityType: "agent",
		entityId: "pi",
		entityName: "pi",
		startTime: start,
		startedAt: start,
		endTime: end,
		endedAt: end,
		attributes: f.attributes,
		metadata: f.metadata,
		tags: f.tags,
		input,
		output,
		inputPreview: clip(input, PREVIEW_CHARS),
		outputPreview: clip(output, PREVIEW_CHARS),
		errorInfo,
		error: errorInfo,
		createdAt: new Date().toISOString(),
		updatedAt: null,
	};
}

export function createExporter(settings: Settings, send: typeof fetch = fetch, onError: (message: string) => void = () => {}) {
	const url = `${ENDPOINT}/projects/${settings.projectId}/ai/spans/publish`;
	let buffer: SpanRecord[] = [];
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function flush(): Promise<void> {
		if (timer) clearTimeout(timer);
		timer = undefined;
		if (!buffer.length) return;
		const spans = buffer;
		buffer = [];
		try {
			const response = await send(url, {
				method: "POST",
				headers: { Authorization: `Bearer ${settings.token}`, "Content-Type": "application/json", "x-mastra-observability-capabilities": "quota-pause-v1" },
				body: JSON.stringify({ spans }),
			});
			if (!response.ok) onError(`Mastra rejected ${spans.length} spans (HTTP ${response.status})`);
		} catch (error) {
			onError(`Mastra export failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	function add(span: SpanRecord): void {
		buffer.push(span);
		timer ??= setTimeout(() => void flush(), FLUSH_MS).unref();
	}

	return { add, flush };
}

interface TextPart {
	type: string;
	text?: string;
}

export function textOf(content: string | TextPart[]): string {
	if (!Array.isArray(content)) return content;
	return content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n");
}

export interface UsageAttributes {
	inputTokens: number;
	outputTokens: number;
	inputDetails: { text: number; cacheRead: number; cacheWrite: number };
}

export function usageAttributes(usage: Pick<Usage, "input" | "output" | "cacheRead" | "cacheWrite">): UsageAttributes {
	const { input, output, cacheRead, cacheWrite } = usage;
	return { inputTokens: input + cacheRead + cacheWrite, outputTokens: output, inputDetails: { text: input, cacheRead, cacheWrite } };
}

function gitBranch(cwd: string): string | undefined {
	try {
		return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return undefined;
	}
}

interface Run {
	traceId: string;
	rootId: string;
	start: number;
	turnStart: number;
	input?: string;
	output?: string;
	modelCalls: number;
	tools: Map<string, { start: number; args: string }>;
	metadata: SpanMetadata;
}

export default function mastraTraces(pi: ExtensionAPI): void {
	const settings = loadSettings();
	if (!settings) return;
	let warned = false;
	let notify: ((message: string) => void) | undefined;
	const exporter = createExporter(settings, fetch, (message) => {
		if (warned) return;
		warned = true;
		notify?.(message);
	});
	let run: Run | undefined;

	pi.on("agent_start", async (_event, ctx) => {
		notify = (message) => ctx.ui.notify(message, "warning");
		const now = Date.now();
		run = {
			traceId: hex(16),
			rootId: hex(8),
			start: now,
			turnStart: now,
			modelCalls: 0,
			tools: new Map(),
			metadata: {
				sessionId: ctx.sessionManager.getSessionId(),
				repo: basename(ctx.cwd),
				branch: gitBranch(ctx.cwd),
				host: hostname(),
				rexSession: process.env.REX_SESSION,
				rexAgent: process.env.PI_REX_AGENT === "1",
			},
		};
	});

	pi.on("turn_start", async (event) => {
		if (run) run.turnStart = event.timestamp;
	});

	pi.on("message_end", async (event) => {
		const message = event.message;
		if (!run) return;
		if (message.role === "user") {
			run.input ??= textOf(message.content);
			return;
		}
		if (message.role !== "assistant") return;
		const usage = usageAttributes(message.usage);
		const cacheMiss = run.modelCalls > 0 && usage.inputDetails.cacheWrite >= CACHE_MISS_TOKENS;
		const text = textOf(message.content);
		if (text) run.output = text;
		exporter.add(makeSpan({
			traceId: run.traceId,
			parentSpanId: run.rootId,
			name: `${message.model}`,
			type: "model_generation",
			start: run.turnStart,
			end: Date.now(),
			output: text,
			attributes: { model: message.model, provider: message.provider, usage, finishReason: message.stopReason },
			metadata: { ...run.metadata, cacheMiss },
			error: message.stopReason === "error" ? message.errorMessage ?? "error" : undefined,
			content: settings.content,
		}));
		run.modelCalls++;
	});

	pi.on("tool_execution_start", async (event) => {
		run?.tools.set(event.toolCallId, { start: Date.now(), args: JSON.stringify(event.args) });
	});

	pi.on("tool_execution_end", async (event) => {
		const started = run?.tools.get(event.toolCallId);
		if (!run || !started) return;
		run.tools.delete(event.toolCallId);
		exporter.add(makeSpan({
			traceId: run.traceId,
			parentSpanId: run.rootId,
			name: event.toolName,
			type: "tool_call",
			start: started.start,
			end: Date.now(),
			input: started.args,
			output: JSON.stringify(event.result),
			attributes: { toolCallId: event.toolCallId, success: !event.isError },
			metadata: run.metadata,
			error: event.isError ? "tool error" : undefined,
			content: settings.content,
		}));
	});

	pi.on("agent_end", async () => {
		if (!run) return;
		const finished = run;
		run = undefined;
		exporter.add(makeSpan({
			id: finished.rootId,
			traceId: finished.traceId,
			name: "pi prompt",
			type: "agent_run",
			start: finished.start,
			end: Date.now(),
			input: finished.input,
			output: finished.output,
			attributes: { conversationId: finished.metadata.sessionId },
			metadata: { ...finished.metadata, modelCalls: finished.modelCalls },
			tags: [`repo:${finished.metadata.repo}`, `host:${finished.metadata.host}`],
			content: settings.content,
		}));
		await exporter.flush();
	});

	pi.on("session_shutdown", async () => {
		await exporter.flush();
	});
}
