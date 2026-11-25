import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OP_ITEM = "op://o4g6exkkczbudy5cpn32s73scq/fuk5gjk4eoh4oszvtiszjz4ime";
const OP_GATEWAY_KEY = "op://o4g6exkkczbudy5cpn32s73scq/hzmyvb3rzt5qh7g73xp5g6xkmq/credential";
const DEFAULT_ENDPOINT = "https://observability.mastra.ai";
const DEFAULT_PII_MODEL = "mastra/google/gemini-3.1-flash-lite";
const GATEWAY_URL = "https://gateway-api.mastra.ai/v1";

export const stateDir = () => process.env.PI_TRACES_STATE ?? join(homedir(), ".local/state/pi-traces");
const enabledFile = () => join(stateDir(), "enabled");
const patternsFile = () => process.env.PI_TRACES_PATTERNS ?? join(homedir(), ".config/pi-traces/patterns");
export const isEnabled = () => existsSync(enabledFile());

export function setEnabled(on: boolean): void {
	if (!on) return rmSync(enabledFile(), { force: true });
	mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
	writeFileSync(enabledFile(), `${new Date().toISOString()}\n`, { mode: 0o600 });
}

const REDACTED = "[REDACTED]";
const SECRET_NAME = /(?:token|secret|passw(?:or)?d|passphrase|api[_-]?key|access[_-]?key|private[_-]?key|credential|cookie|authorization|dsn|signing[_-]?key)/i;

const RULES: [RegExp, string][] = [
	[/-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g, "[REDACTED PEM BLOCK]"],
	[/\b(Bearer|Basic)\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{12,}/gi, `$1 ${REDACTED}`],
	[/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
	[/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
	[/\b(?:sk|pk|rk)[-_](?:live|test|proj|ant|or)?[-_]?[A-Za-z0-9_-]{16,}/g, REDACTED],
	[/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,})/g, REDACTED],
	[/\b(?:xox[abposr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|ops_[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|lin_(?:api|oauth)_[A-Za-z0-9]{20,}|ph[cxs]_[A-Za-z0-9]{20,}|re_[A-Za-z0-9_]{20,}|sntry[su]_[A-Za-z0-9_=+/-]{20,})/g, REDACTED],
	[new RegExp(`((?:^|[\\s"'{,;(])(?:export\\s+)?["']?[A-Za-z0-9_.-]*${SECRET_NAME.source}[A-Za-z0-9_.-]*["']?\\s*[:=]\\s*)(["']?)[^\\s"',;}()]{8,}(?=$|[\\s"',;})])`, "gim"), `$1$2${REDACTED}`],
	[/(?<![A-Za-z0-9_-])(?!toolu_|call_|fc_)[A-Za-z0-9_-]*(?<![A-Za-z0-9])(?=[A-Za-z0-9]*[A-Z])(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{24,}[A-Za-z0-9_-]*/g, REDACTED],
];

export function envSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
	return Object.entries(env)
		.filter(([name, value]) => SECRET_NAME.test(name) && typeof value === "string" && value.length >= 8)
		.map(([, value]) => value as string);
}

export function loadPatterns(file = patternsFile()): RegExp[] {
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"))
		.map((line) => new RegExp(line, "g"));
}

export type Redactor = (text: string) => string;

export function makeRedactor(literals: string[] = [], patterns: RegExp[] = []): Redactor {
	const known = [...new Set(literals.filter((value) => value.length >= 8))].sort((a, b) => b.length - a.length);
	return (text) => {
		let out = text;
		for (const value of known) out = out.split(value).join(REDACTED);
		for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
		for (const pattern of patterns) out = out.replace(pattern, REDACTED);
		return out;
	};
}

const SECRET_COMMAND = /(^|[\s;&|(`$])(env|printenv|export\s+-p|set|declare\s+-x|op\s+(read|item|inject|run|document|signin|whoami|vault)|security\s+find-\S+|gh\s+auth\s+(token|status)|railway\s+variables|vercel\s+env|aws\s+(configure|sts)|gcloud\s+auth\s+print)(?=$|[\s;&|)`])/;
const SECRET_PATH = /(^|\/)(\.env(\.[^/]*)?|[^/]*\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa)[^/]*|auth\.json|mcp-auth\.json|credentials(\.json)?|\.npmrc|\.netrc|\.pgpass|agents\.env|[^/]*\.vars)$/;

export function secretBearingCall(name: string, args: unknown): boolean {
	const a = (args ?? {}) as Record<string, unknown>;
	if (typeof a.command === "string" && SECRET_COMMAND.test(a.command)) return true;
	if (typeof a.command === "string" && /(^|\s)(cat|less|head|tail|bat|sed|awk|grep|rg)\s[^|;&]*(\.env\b|\.pem\b|id_rsa|auth\.json|agents\.env|\.npmrc|\.netrc)/.test(a.command)) return true;
	const path = typeof a.path === "string" ? a.path : typeof a.file_path === "string" ? a.file_path : undefined;
	return name !== "write" && name !== "edit" && path !== undefined && SECRET_PATH.test(path);
}

export function redactValue(value: unknown, redact: Redactor): unknown {
	if (typeof value === "string") return redact(value);
	if (Array.isArray(value)) return value.map((item) => redactValue(item, redact));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, SECRET_NAME.test(key) && typeof item === "string" ? REDACTED : redactValue(item, redact)]),
		);
	}
	return value;
}

type Block = { type: string; text?: string; id?: string; name?: string; arguments?: unknown };
type Message = {
	role: string;
	content?: string | Block[];
	provider?: string;
	model?: string;
	usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; reasoning?: number; cost?: { total?: number } };
	stopReason?: string;
	errorMessage?: string;
	durationMs?: number;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
};
export type Entry = { type: string; id: string; timestamp: string; message?: Message };

export type Span = {
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	name: string;
	spanType: string;
	entityType?: string;
	entityName?: string;
	startedAt: string;
	endedAt: string;
	isEvent: boolean;
	attributes?: Record<string, unknown>;
	metadata: Record<string, unknown>;
	tags?: string[];
	input?: unknown;
	output?: unknown;
	error?: { message: string; name?: string } | null;
};

export type RunContext = { sessionId: string; sessionName?: string; cwd: string; host: string; agent: "pi" | "rex-agent" };

const hex = (length: number, ...parts: string[]) => createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, length);

const textOf = (content: Message["content"]) =>
	typeof content === "string"
		? content
		: (content ?? [])
				.map((block) => (block.type === "text" ? block.text : block.type === "image" ? "[image]" : undefined))
				.filter((part) => part !== undefined)
				.join("\n");

const iso = (ms: number) => new Date(ms).toISOString();

export function splitRuns(entries: Entry[]): Entry[][] {
	const runs: Entry[][] = [];
	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message) continue;
		if (entry.message.role === "user") runs.push([entry]);
		else if (runs.length > 0 && (entry.message.role === "assistant" || entry.message.role === "toolResult")) runs.at(-1)!.push(entry);
	}
	return runs.filter((run) => run.length > 1);
}

export function buildTrace(run: Entry[], ctx: RunContext, redact: Redactor): Span[] {
	const [prompt, ...rest] = run;
	const traceId = hex(32, ctx.sessionId, prompt.id);
	const rootId = hex(16, ctx.sessionId, prompt.id, "root");
	const results = new Map(rest.filter((e) => e.message?.role === "toolResult").map((e) => [e.message!.toolCallId, e]));
	const assistants = rest.filter((e) => e.message?.role === "assistant");
	const end = Date.parse(run.at(-1)!.timestamp);
	const tags = [...new Set(["pi", ctx.agent, `host:${ctx.host}`])];
	const metadata = { host: ctx.host, cwd: ctx.cwd, sessionId: ctx.sessionId, ...(ctx.sessionName ? { sessionName: ctx.sessionName } : {}), source: "pi-traces" };
	const lastText = [...assistants].reverse().map((e) => textOf(e.message!.content)).find((text) => text.trim());
	const failed = assistants.find((e) => e.message!.stopReason === "error");

	const spans: Span[] = [
		{
			traceId,
			spanId: rootId,
			parentSpanId: null,
			name: ctx.agent,
			spanType: "agent_run",
			entityType: "agent",
			entityName: ctx.agent,
			startedAt: prompt.timestamp,
			endedAt: iso(Math.max(end, Date.parse(prompt.timestamp))),
			isEvent: false,
			attributes: { conversationId: ctx.sessionId },
			metadata,
			tags,
			input: redact(textOf(prompt.message!.content)),
			...(lastText ? { output: redact(lastText) } : {}),
			error: failed ? { message: redact(failed.message!.errorMessage ?? "model error"), name: "ModelError" } : null,
		},
	];

	for (const entry of assistants) {
		const m = entry.message!;
		const ended = Date.parse(entry.timestamp);
		const genId = hex(16, ctx.sessionId, entry.id);
		const u = m.usage ?? {};
		const text = textOf(m.content);
		const provider = m.provider === "claude-bridge" ? "anthropic" : m.provider;
		spans.push({
			traceId,
			spanId: genId,
			parentSpanId: rootId,
			name: `llm: ${m.model ?? "unknown"}`,
			spanType: "model_generation",
			startedAt: iso(Math.max(Date.parse(prompt.timestamp), ended - (m.durationMs ?? 0))),
			endedAt: entry.timestamp,
			isEvent: false,
			attributes: {
				model: m.model,
				provider,
				finishReason: m.stopReason,
				usage: {
					inputTokens: (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0),
					outputTokens: u.output ?? 0,
					inputDetails: { text: u.input ?? 0, cacheRead: u.cacheRead ?? 0, cacheWrite: u.cacheWrite ?? 0 },
					...(u.reasoning ? { outputDetails: { reasoning: u.reasoning } } : {}),
				},
				...(u.cost?.total !== undefined && provider === m.provider ? { costContext: { provider, model: m.model, estimatedCost: u.cost.total, costUnit: "USD" } } : {}),
			},
			metadata: provider === m.provider ? metadata : { ...metadata, piProvider: m.provider },
			...(text ? { output: redact(text) } : {}),
			error: m.stopReason === "error" ? { message: redact(m.errorMessage ?? "model error"), name: "ModelError" } : null,
		});

		for (const call of Array.isArray(m.content) ? m.content.filter((block) => block.type === "toolCall") : []) {
			const result = results.get(call.id);
			const r = result?.message;
			const resultEnd = result ? Date.parse(result.timestamp) : ended;
			const hidden = secretBearingCall(call.name ?? "", call.arguments);
			const output = r ? (hidden ? "[REDACTED: output of a secret-bearing command or file]" : redact(textOf(r.content))) : undefined;
			spans.push({
				traceId,
				spanId: hex(16, ctx.sessionId, call.id ?? entry.id, "tool"),
				parentSpanId: genId,
				name: call.name ?? "tool",
				spanType: "tool_call",
				entityType: "tool",
				entityName: call.name ?? "tool",
				startedAt: iso(Math.max(ended, resultEnd - (r?.durationMs ?? 0))),
				endedAt: iso(Math.max(ended, resultEnd)),
				isEvent: false,
				attributes: { toolCallId: call.id, success: r ? !r.isError : undefined },
				metadata,
				input: redactValue(call.arguments, redact),
				...(output !== undefined ? { output } : {}),
				error: r?.isError ? { message: output ?? "tool error", name: "ToolError" } : null,
			});
		}
	}
	return spans;
}

const MAX_SPAN_BYTES = 3 * 1024 * 1024;
const CLIPPED = "[truncated to fit the Mastra collector batch limit]";

export function fit(span: Span): Span {
	if (Buffer.byteLength(JSON.stringify(span)) <= MAX_SPAN_BYTES) return span;
	const clip = (value: unknown) => {
		const text = typeof value === "string" ? value : JSON.stringify(value);
		return text === undefined ? undefined : `${text.slice(0, MAX_SPAN_BYTES / 8)} ${CLIPPED}`;
	};
	return { ...span, input: clip(span.input), output: clip(span.output), ...(span.error ? { error: { ...span.error, message: clip(span.error.message)! } } : {}) };
}

export type Detect = (text: string) => Promise<string>;
const PII_CHUNK = 12_000;
const PII_FAILED = "[REDACTED: PII check failed]";
const PII_TYPES = ["email", "phone", "credit-card", "ssn", "api-key", "ip-address", "name", "address", "date-of-birth", "crypto-wallet", "iban"];

async function scrubText(text: string, detect: Detect): Promise<string> {
	if (!text.trim()) return text;
	const parts: string[] = [];
	for (let i = 0; i < text.length; i += PII_CHUNK) parts.push(await detect(text.slice(i, i + PII_CHUNK)).catch(() => PII_FAILED));
	return parts.join("");
}

export async function scrubPII(spans: Span[], detect: Detect, concurrency = 4): Promise<Span[]> {
	const jobs: (() => Promise<void>)[] = [];
	const out = spans.map((span) => ({ ...span }));
	for (const span of out) {
		for (const field of ["input", "output"] as const) {
			const value = span[field];
			if (value === undefined || value === null) continue;
			const text = typeof value === "string" ? value : JSON.stringify(value);
			jobs.push(async () => {
				const clean = await scrubText(text, detect);
				if (clean !== text) span[field] = clean;
			});
		}
		if (span.error) {
			const error = span.error;
			jobs.push(async () => {
				span.error = { ...error, message: await scrubText(error.message, detect) };
			});
		}
	}
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
		while (next < jobs.length) await jobs[next++]();
	}));
	return out;
}

export type Target = { token: string; projectId: string; endpoint: string; gatewayKey?: string; piiModel: string };

export function parseNotes(notes: string): Omit<Target, "token" | "gatewayKey"> {
	const value = (name: string) => notes.match(new RegExp(`^\\s*${name}\\s*=\\s*(\\S+)\\s*$`, "m"))?.[1];
	const projectId = value("MASTRA_PROJECT_ID");
	if (!projectId || !/^[A-Za-z0-9_-]+$/.test(projectId)) throw new Error("MASTRA_PROJECT_ID is missing or invalid in the 1Password item notes");
	const url = new URL(value("MASTRA_PLATFORM_OBSERVABILITY_ENDPOINT") ?? DEFAULT_ENDPOINT);
	if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/, "")) {
		throw new Error("The observability endpoint must be a plain https origin");
	}
	return { projectId, endpoint: url.origin, piiModel: value("PII_MODEL") ?? DEFAULT_PII_MODEL };
}

const opRead = (ref: string) =>
	new Promise<string>((resolve, reject) =>
		execFile("op", ["read", "--no-newline", ref], { timeout: 60_000 }, (error, stdout) =>
			error ? reject(new Error(`op read ${ref.split("/").at(-1)} failed`)) : resolve(stdout),
		),
	);

let target: Promise<Target> | undefined;
const loadTarget = () =>
	(target ??= Promise.all([opRead(`${OP_ITEM}/credential`), opRead(`${OP_ITEM}/notesPlain`), opRead(OP_GATEWAY_KEY).catch(() => "")]).then(([token, notes, gatewayKey]) => {
		if (!token) throw new Error("the 1Password credential is empty");
		return { token, ...parseNotes(notes), ...(gatewayKey ? { gatewayKey } : {}) };
	})).catch((error) => {
		target = undefined;
		throw error;
	});

export const ownerNote = (owner: string) =>
	`This text comes from the account owner's own coding sessions. The owner's name and username, "${owner}" in any capitalization (for example "${owner[0].toUpperCase()}${owner.slice(1)}" or /home/${owner} and /Users/${owner} paths), are not PII: never flag or redact them. Still flag other people's names and all other PII.`;

let quieted = false;
function quietPIIDetectorConsole(): void {
	if (quieted) return;
	quieted = true;
	for (const level of ["info", "warn"] as const) {
		const original = console[level].bind(console);
		console[level] = (...args: unknown[]) => {
			if (typeof args[0] === "string" && /^(\[PIIDetector\]|PII detection failed)/.test(args[0])) return;
			original(...args);
		};
	}
}

export async function piiDetect(model: string, apiKey: string): Promise<Detect> {
	const { PIIDetector } = await import("@mastra/core/processors");
	const { noopLogger } = await import("@mastra/core/logger");
	quietPIIDetectorConsole();
	const options = {
		model: { providerId: "mastra-gateway", modelId: model.replace(/^mastra\//, ""), url: GATEWAY_URL, apiKey },
		strategy: "redact" as const,
		redactionMethod: "placeholder" as const,
		errorStrategy: "strict" as const,
		detectionTypes: PII_TYPES,
	};
	const defaults = (new PIIDetector(options) as unknown as { createDefaultInstructions(): string }).createDefaultInstructions();
	const owner = userInfo().username;
	const detector = new PIIDetector({ ...options, instructions: `${defaults}\n\n${ownerNote(owner)}` });
	(detector as unknown as { detectionAgent: { __setLogger(logger: unknown): void } }).detectionAgent.__setLogger(noopLogger);
	return async (text) => {
		const message = { id: "m", role: "user" as const, createdAt: new Date(), content: { format: 2 as const, parts: [{ type: "text" as const, text }] } };
		const [result] = await detector.processInput({
			messages: [message],
			abort: (reason?: string): never => {
				throw new Error(reason ?? "PII check aborted");
			},
		});
		if (!result) return "[REDACTED: PII]";
		if (result === message) return text;
		const part = result.content.parts?.find((p) => p.type === "text") as { text?: string } | undefined;
		return part?.text ?? PII_FAILED;
	};
}

type SdkSpan = {
	createChildSpan(options: Record<string, unknown>): SdkSpan;
	error(options: Record<string, unknown>): void;
	end(options: Record<string, unknown>): void;
};
type SdkInstance = { startSpan(options: Record<string, unknown>): SdkSpan; flush(): Promise<void>; shutdown(): Promise<void> };

export function emit(spans: Span[], instance: SdkInstance): void {
	const live = new Map<string, SdkSpan>();
	const children = new Map<string | null, Span[]>();
	for (const span of spans) children.set(span.parentSpanId, [...(children.get(span.parentSpanId) ?? []), span]);
	const open = (span: Span) => {
		const options = {
			type: span.spanType,
			name: span.name,
			startTime: new Date(span.startedAt),
			attributes: span.attributes,
			metadata: span.metadata,
			...(span.input !== undefined ? { input: span.input } : {}),
			...(span.entityType ? { entityType: span.entityType, entityName: span.entityName } : {}),
		};
		const sdk = span.parentSpanId
			? live.get(span.parentSpanId)!.createChildSpan(options)
			: instance.startSpan({ ...options, traceId: span.traceId, tracingOptions: { tags: span.tags } });
		live.set(span.spanId, sdk);
		for (const child of children.get(span.spanId) ?? []) open(child);
		if (span.error) sdk.error({ error: Object.assign(new Error(span.error.message), { name: span.error.name ?? "Error", stack: undefined }), endSpan: false });
		sdk.end({ endTime: new Date(span.endedAt), ...(span.output !== undefined ? { output: span.output } : {}) });
	};
	for (const root of children.get(null) ?? []) open(root);
}

export async function sdkInstance(t: Target, redact: Redactor, exporter?: unknown): Promise<SdkInstance> {
	const obs = await import("@mastra/observability");
	const final = {
		name: "pi-traces-redactor",
		process: (span: Record<string, unknown>) => {
			for (const key of ["input", "output", "attributes", "metadata", "errorInfo"]) if (span[key] !== undefined) span[key] = redactValue(span[key], redact);
			return span;
		},
		shutdown: async () => {},
	};
	return new obs.DefaultObservabilityInstance({
		serviceName: "pi",
		name: "pi-traces",
		sampling: { type: "always" },
		exporters: [
			exporter ??
				new obs.MastraPlatformExporter({ accessToken: t.token, projectId: t.projectId, endpoint: t.endpoint, resolveFromEnv: false, byteBatching: { maxBatchBytes: 4 * 1024 * 1024 } }),
		],
		spanOutputProcessors: [new obs.SensitiveDataFilter(), final],
	} as never) as unknown as SdkInstance;
}

export function runContext(sessionId: string, cwd: string, sessionName?: string): RunContext {
	return { sessionId, sessionName, cwd, host: hostname().split(".")[0].toLowerCase(), agent: process.env.PI_REX_AGENT === "1" ? "rex-agent" : "pi" };
}

export async function prepare(runs: Entry[][], run: RunContext, t: Target, detect?: Detect): Promise<Span[]> {
	const redact = makeRedactor([t.token, ...(t.gatewayKey ? [t.gatewayKey] : []), ...envSecrets()], loadPatterns());
	const spans = runs.flatMap((r) => buildTrace(r, run, redact)).map(fit);
	if (!detect) throw new Error("the Mastra Gateway PII key could not be read from 1Password, so PIIDetector cannot run");
	return scrubPII(spans, detect);
}

export default function piTraces(pi: ExtensionAPI): void {
	const exported = new Map<string, string>();
	let sdk: Promise<{ instance: SdkInstance; detect: Detect; t: Target }> | undefined;
	let queue = Promise.resolve();

	const pending = (entries: Entry[], sessionId: string) => {
		const after = exported.get(sessionId);
		const index = after ? entries.findIndex((e) => e.id === after) : -1;
		if (index >= 0) return entries.slice(index + 1);
		const lastPrompt = entries.findLastIndex((e) => e.type === "message" && e.message?.role === "user");
		return lastPrompt >= 0 ? entries.slice(lastPrompt) : [];
	};

	const ready = () =>
		(sdk ??= (async () => {
			const t = await loadTarget();
			if (!t.gatewayKey) throw new Error("the Mastra Gateway PII key could not be read from 1Password, so PIIDetector cannot run");
			const redact = makeRedactor([t.token, t.gatewayKey, ...envSecrets()], loadPatterns());
			return { t, instance: await sdkInstance(t, redact), detect: await piiDetect(t.piiModel, t.gatewayKey) };
		})()).catch((error) => {
			sdk = undefined;
			throw error;
		});

	pi.on("agent_settled", (_event, ctx) => {
		if (!isEnabled()) return;
		const sm = ctx.sessionManager;
		const sessionId = sm.getSessionId();
		const entries = sm.getBranch() as Entry[];
		const runs = splitRuns(pending(entries, sessionId));
		if (entries.length > 0) exported.set(sessionId, entries.at(-1)!.id);
		if (runs.length === 0) return;
		const run = runContext(sessionId, ctx.cwd, sm.getSessionName());
		const status = (text: string | undefined) => {
			try {
				ctx.ui.setStatus("pi-traces", text);
			} catch {}
		};
		queue = queue
			.then(async () => {
				const { instance, detect, t } = await ready();
				emit(await prepare(runs, run, t, detect), instance);
				await instance.flush();
			})
			.then(
				() => status(undefined),
				(error) => status(`traces: ${(error as Error).message}`),
			);
	});

	pi.on("session_shutdown", async () => {
		await queue;
		const current = sdk;
		if (current) await current.then(({ instance }) => instance.shutdown()).catch(() => {});
	});

	pi.registerCommand("traces", {
		description: "Export this machine's Pi sessions to Mastra observability. Args: on | off | status | preview",
		handler: async (args, ctx) => {
			const arg = (args ?? "").trim() || "status";
			if (arg === "on" || arg === "off") {
				setEnabled(arg === "on");
				ctx.ui.setStatus("pi-traces", undefined);
				return ctx.ui.notify(`Trace export is ${arg} on ${hostname()}. Runs are sent when the agent settles.`, "info");
			}
			if (arg === "preview") {
				const sm = ctx.sessionManager;
				const runs = splitRuns(sm.getBranch() as Entry[]);
				if (runs.length === 0) return ctx.ui.notify("traces: no finished run in this session yet", "warning");
				const spans = await loadTarget()
					.then(async (t) => prepare(runs.slice(-1), runContext(sm.getSessionId(), ctx.cwd, sm.getSessionName()), t, t.gatewayKey ? await piiDetect(t.piiModel, t.gatewayKey) : undefined))
					.catch((error: Error) => error);
				if (spans instanceof Error) return ctx.ui.notify(`traces: ${spans.message}`, "error");
				mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
				const file = join(stateDir(), "preview.json");
				writeFileSync(file, `${JSON.stringify({ spans }, null, 2)}\n`, { mode: 0o600 });
				return ctx.ui.notify(`traces: wrote ${spans.length} redacted spans for the last run to ${file}. Nothing was sent.`, "info");
			}
			ctx.ui.notify(`Trace export is ${isEnabled() ? "on" : "off"} on ${hostname()} (${enabledFile()}).`, "info");
		},
	});
}
