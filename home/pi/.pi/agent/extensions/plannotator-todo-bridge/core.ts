import { createHash, randomUUID } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

export const BRIDGE_VERSION = 1;
export const BRIDGE_OWNER = "plannotator-todo-bridge";
export const BRIDGE_STATE_ENTRY = "plannotator-todo-bridge";
export const PLANNOTATOR_EXECUTE_ENTRY = "plannotator-execute";
export const PLANNOTATOR_REQUEST_CHANNEL = "plannotator:request";
export const TODO_REQUEST_CHANNEL = "rpiv-todo:request";
export const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

export interface ChecklistItem {
	step: number;
	text: string;
	completed: boolean;
	line: number;
}

export interface TaskRecord {
	id: number;
	subject: string;
	status: "pending" | "in_progress" | "completed" | "deleted";
	description?: string;
	activeForm?: string;
	owner?: string;
	metadata?: Record<string, unknown>;
}

export interface TodoSnapshot {
	tasks: TaskRecord[];
	nextId: number;
}

export interface TodoMutation {
	action: "create" | "update" | "delete";
	params: Record<string, unknown>;
}

export interface ExecuteMarker {
	id: string;
	path: string;
	index: number;
}

export interface PendingCompletion {
	planPath: string;
	steps: number[];
}

export interface BridgeState {
	processedMarkerIds: string[];
	activePlanPath?: string;
	pendingCompletions?: PendingCompletion[];
}

export interface LinkedMetadata extends Record<string, unknown> {
	bridge: typeof BRIDGE_OWNER;
	bridgeVersion: number;
	planPath: string;
	planStep: number;
	planItemKey: string;
}

export function normalizePlanPath(cwd: string, inputPath: string): string {
	const absolute = resolve(cwd, inputPath);
	const rel = relative(cwd, absolute);
	if (!rel || rel === ".") throw new Error("Plan path must point to a file inside the working directory.");
	if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error(`Plan path escapes the working directory: ${inputPath}`);
	return rel.split(sep).join("/");
}

export function parseChecklist(content: string): ChecklistItem[] {
	const items: ChecklistItem[] = [];
	const lines = content.split(/\r?\n/);
	for (let line = 0; line < lines.length; line += 1) {
		const match = lines[line]?.match(/^[-*]\s*\[([ xX])\]\s+(.+)$/);
		if (!match) continue;
		const text = match[2]?.trim() ?? "";
		if (!text) continue;
		items.push({ step: items.length + 1, text, completed: match[1] !== " ", line });
	}
	return items;
}

export function extractDoneSteps(text: string): number[] {
	const result: number[] = [];
	const seen = new Set<number>();
	for (const match of text.matchAll(/\[DONE:(\d+)\]/gi)) {
		const step = Number(match[1]);
		if (!Number.isSafeInteger(step) || step < 1 || seen.has(step)) continue;
		seen.add(step);
		result.push(step);
	}
	return result;
}

export function planItemKey(planPath: string, step: number): string {
	return createHash("sha256").update(`${planPath}\0${step}`).digest("hex").slice(0, 24);
}

export function linkedMetadata(planPath: string, step: number): LinkedMetadata {
	return {
		bridge: BRIDGE_OWNER,
		bridgeVersion: BRIDGE_VERSION,
		planPath,
		planStep: step,
		planItemKey: planItemKey(planPath, step),
	};
}

export function isLinkedTask(task: TaskRecord, planPath?: string): boolean {
	const metadata = task.metadata;
	return (
		metadata?.bridge === BRIDGE_OWNER &&
		typeof metadata.planPath === "string" &&
		typeof metadata.planStep === "number" &&
		(!planPath || metadata.planPath === planPath)
	);
}

export function reconcileChecklist(planPath: string, items: ChecklistItem[], snapshot: TodoSnapshot): TodoMutation[] {
	const mutations: TodoMutation[] = [];
	const linked = snapshot.tasks.filter((task) => isLinkedTask(task, planPath));
	const byKey = new Map(linked.map((task) => [String(task.metadata?.planItemKey), task]));
	const desiredKeys = new Set<string>();
	let predictedNextId = snapshot.nextId;

	for (const item of items) {
		const metadata = linkedMetadata(planPath, item.step);
		desiredKeys.add(metadata.planItemKey);
		const existing = byKey.get(metadata.planItemKey);
		const description = `Plannotator step ${item.step} from ${planPath}`;
		if (!existing || existing.status === "deleted") {
			const id = predictedNextId;
			predictedNextId += 1;
			mutations.push({
				action: "create",
				params: { subject: item.text, description, owner: BRIDGE_OWNER, metadata },
			});
			if (item.completed) mutations.push({ action: "update", params: { id, status: "completed" } });
			continue;
		}

		const params: Record<string, unknown> = { id: existing.id };
		let changed = false;
		if (existing.subject !== item.text) {
			params.subject = item.text;
			changed = true;
		}
		if (existing.description !== description) {
			params.description = description;
			changed = true;
		}
		if (existing.owner !== BRIDGE_OWNER) {
			params.owner = BRIDGE_OWNER;
			changed = true;
		}
		if (item.completed && existing.status !== "completed") {
			params.status = "completed";
			changed = true;
		}
		if (changed) mutations.push({ action: "update", params });
	}

	for (const task of linked) {
		const key = String(task.metadata?.planItemKey ?? "");
		if (task.status !== "deleted" && !desiredKeys.has(key)) {
			mutations.push({ action: "delete", params: { id: task.id } });
		}
	}

	return mutations;
}

export function completionMutations(snapshot: TodoSnapshot, planPath: string, steps: number[]): TodoMutation[] {
	const wanted = new Set(steps);
	return snapshot.tasks
		.filter(
			(task) =>
				isLinkedTask(task, planPath) &&
				wanted.has(Number(task.metadata?.planStep)) &&
				task.status !== "completed" &&
				task.status !== "deleted",
		)
		.map((task) => ({ action: "update" as const, params: { id: task.id, status: "completed" } }));
}

export function findExecuteMarkers(entries: Iterable<unknown>, cwd: string): ExecuteMarker[] {
	const markers: ExecuteMarker[] = [];
	let index = -1;
	for (const raw of entries) {
		index += 1;
		const entry = raw as { type?: string; id?: string; customType?: string; data?: { lastSubmittedPath?: unknown } };
		if (entry.type !== "custom" || entry.customType !== PLANNOTATOR_EXECUTE_ENTRY) continue;
		if (typeof entry.data?.lastSubmittedPath !== "string" || !entry.data.lastSubmittedPath.trim()) continue;
		markers.push({
			id: entry.id ?? `${index}:${entry.data.lastSubmittedPath}`,
			path: normalizePlanPath(cwd, entry.data.lastSubmittedPath),
			index,
		});
	}
	return markers;
}

export function restoreBridgeState(entries: Iterable<unknown>): BridgeState {
	let state: BridgeState = { processedMarkerIds: [] };
	for (const raw of entries) {
		const entry = raw as { type?: string; customType?: string; data?: Partial<BridgeState> };
		if (entry.type !== "custom" || entry.customType !== BRIDGE_STATE_ENTRY || !entry.data) continue;
		const pendingCompletions = Array.isArray(entry.data.pendingCompletions)
			? entry.data.pendingCompletions.filter(
					(value): value is PendingCompletion =>
						!!value &&
						typeof value === "object" &&
						typeof (value as PendingCompletion).planPath === "string" &&
						Array.isArray((value as PendingCompletion).steps) &&
						(value as PendingCompletion).steps.every((step) => Number.isSafeInteger(step) && step > 0),
				)
			: [];
		state = {
			processedMarkerIds: Array.isArray(entry.data.processedMarkerIds)
				? entry.data.processedMarkerIds.filter((id): id is string => typeof id === "string")
				: [],
			...(typeof entry.data.activePlanPath === "string" ? { activePlanPath: entry.data.activePlanPath } : {}),
			...(pendingCompletions.length > 0 ? { pendingCompletions } : {}),
		};
	}
	return state;
}

export function serializeSisyphusObjective(tasks: TaskRecord[]): string {
	const remaining = tasks
		.filter((task) => isLinkedTask(task) && (task.status === "pending" || task.status === "in_progress"))
		.sort((a, b) => {
			const pathOrder = String(a.metadata?.planPath).localeCompare(String(b.metadata?.planPath));
			return pathOrder || Number(a.metadata?.planStep) - Number(b.metadata?.planStep);
		});
	if (remaining.length === 0) throw new Error("No remaining Plannotator-linked todos.");
	const planPaths = new Set(remaining.map((task) => String(task.metadata?.planPath)));
	if (planPaths.size !== 1) throw new Error("Sisyphus todos must belong to exactly one active plan.");

	const lines = [
		"Complete the remaining approved Plannotator tasks in the exact order below.",
		"After each task: verify it, emit the matching [DONE:n] marker, and ensure its linked todo is completed.",
		"Continue after progress reports, tests, commits, and phase boundaries. Stop only when all listed tasks are complete or human action is required.",
		"",
	];
	for (const task of remaining) {
		const step = Number(task.metadata?.planStep);
		const path = String(task.metadata?.planPath);
		lines.push(`${step}. ${task.subject}`);
		lines.push(`   Done when: the task is implemented and verified; emit [DONE:${step}].`);
		lines.push(`   Plan: ${path}`);
	}
	return lines.join("\n");
}

export async function checkPlanSteps(cwd: string, planPath: string, steps: number[]): Promise<number[]> {
	if (steps.length === 0) return [];
	const normalized = normalizePlanPath(cwd, planPath);
	const fullPath = resolve(cwd, normalized);
	const original = await readFile(fullPath, "utf8");
	const newline = original.includes("\r\n") ? "\r\n" : "\n";
	const trailingNewline = original.endsWith("\n");
	const lines = original.split(/\r?\n/);
	if (trailingNewline) lines.pop();
	const items = parseChecklist(original);
	const wanted = new Set(steps);
	const changed: number[] = [];
	for (const item of items) {
		if (!wanted.has(item.step) || item.completed) continue;
		const line = lines[item.line];
		if (line === undefined) continue;
		const next = line.replace(/^([-*]\s*\[) (\]\s+)/, "$1x$2");
		if (next === line) continue;
		lines[item.line] = next;
		changed.push(item.step);
	}
	if (changed.length === 0) return [];
	const output = `${lines.join(newline)}${trailingNewline ? newline : ""}`;
	const tempPath = `${fullPath}.plannotator-todo-${randomUUID()}.tmp`;
	await mkdir(dirname(fullPath), { recursive: true });
	await writeFile(tempPath, output, "utf8");
	await rename(tempPath, fullPath);
	return changed;
}

export function makeRequestId(prefix: string): string {
	return `${prefix}-${randomUUID()}`;
}
