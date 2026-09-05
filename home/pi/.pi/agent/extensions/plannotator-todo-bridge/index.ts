import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	BRIDGE_STATE_ENTRY,
	BRIDGE_OWNER,
	checkPlanSteps,
	completionMutations,
	extractDoneSteps,
	findExecuteMarkers,
	isLinkedTask,
	normalizePlanPath,
	parseChecklist,
	reconcileChecklist,
	restoreBridgeState,
	serializeSisyphusObjective,
	type BridgeState,
} from "./core.js";
import { getTodos, mutateTodos, startPlanningTask } from "./requests.js";

const PLANNOTATOR_WIDGET_KEY = "plannotator-progress";
const TOOL_NAME = "start_plannotator";
const COMMAND_NAME = "plan-task";
const SISYPHUS_COMMAND = "sisyphus-todos";

function assistantText(message: unknown): string {
	const content = (message as { content?: unknown })?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return !!part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string";
		})
		.map((part) => part.text)
		.join("\n");
}

function hasCommand(pi: ExtensionAPI, name: string): boolean {
	return pi.getCommands().some((command) => command.name === name);
}

export default function plannotatorTodoBridge(pi: ExtensionAPI): void {
	let state: BridgeState = { processedMarkerIds: [] };
	let operation = Promise.resolve();

	function persistState(): void {
		pi.appendEntry(BRIDGE_STATE_ENTRY, state);
	}

	function hideDuplicateWidget(ctx: ExtensionContext): void {
		if (!state.activePlanPath || !ctx.hasUI) return;
		ctx.ui.setWidget(PLANNOTATOR_WIDGET_KEY, undefined);
	}

	function deferDuplicateWidgetHide(ctx: ExtensionContext): void {
		setTimeout(() => {
			try {
				hideDuplicateWidget(ctx);
			} catch (error) {
				if (!/stale after session replacement/.test(String(error))) {
					console.error("Plannotator todo bridge widget cleanup failed:", error);
				}
			}
		}, 0);
	}

	function enqueue(ctx: ExtensionContext, work: () => Promise<void>): Promise<void> {
		operation = operation.then(work).catch((error) => {
			ctx.ui.notify(`Plannotator todo bridge: ${error instanceof Error ? error.message : String(error)}`, "error");
		});
		return operation;
	}

	async function reconcilePlan(ctx: ExtensionContext, planPath: string): Promise<void> {
		const normalized = normalizePlanPath(ctx.cwd, planPath);
		const content = await readFile(resolve(ctx.cwd, normalized), "utf8");
		const items = parseChecklist(content);
		if (items.length === 0) throw new Error(`Approved plan has no Markdown checklist items: ${normalized}`);
		const snapshot = await getTodos(pi.events);
		const mutations = reconcileChecklist(normalized, items, snapshot);
		if (mutations.length > 0) await mutateTodos(pi.events, mutations);
		state = { ...state, activePlanPath: normalized };
		persistState();
		hideDuplicateWidget(ctx);
	}

	async function reconcileMarkers(ctx: ExtensionContext): Promise<void> {
		const branch = ctx.sessionManager.getBranch();
		const markers = findExecuteMarkers(branch, ctx.cwd);
		const processed = new Set(state.processedMarkerIds);
		let imported = false;
		for (const marker of markers) {
			if (processed.has(marker.id)) continue;
			await reconcilePlan(ctx, marker.path);
			processed.add(marker.id);
			state = { ...state, processedMarkerIds: [...processed], activePlanPath: marker.path };
			persistState();
			imported = true;
		}
		if (!imported && state.activePlanPath) {
			await reconcilePlan(ctx, state.activePlanPath);
		}
		hideDuplicateWidget(ctx);
	}

	async function processPendingCompletions(ctx: ExtensionContext): Promise<void> {
		const pending = state.pendingCompletions ?? [];
		for (const completion of pending) {
			await checkPlanSteps(ctx.cwd, completion.planPath, completion.steps);
			const snapshot = await getTodos(pi.events);
			const mutations = completionMutations(snapshot, completion.planPath, completion.steps);
			const next = mutations.length > 0 ? await mutateTodos(pi.events, mutations) : snapshot;
			state = {
				...state,
				pendingCompletions: (state.pendingCompletions ?? []).filter((item) => item !== completion),
			};
			if (state.pendingCompletions?.length === 0) delete state.pendingCompletions;
			const remaining = next.tasks.some(
				(task) =>
					isLinkedTask(task, completion.planPath) &&
					(task.status === "pending" || task.status === "in_progress"),
			);
			if (!remaining && state.activePlanPath === completion.planPath) delete state.activePlanPath;
			persistState();
		}
	}

	async function startPlanning(task: string, ctx: ExtensionContext): Promise<void> {
		const trimmed = task.trim();
		if (!trimmed) throw new Error("A planning task is required.");
		if (!hasCommand(pi, "plannotator")) throw new Error("Plannotator is not installed or its command is unavailable.");
		await startPlanningTask(pi.events, trimmed, (prompt) => {
			pi.sendUserMessage(prompt, { deliverAs: "followUp" });
		});
		ctx.ui.notify("Plannotator planning started. The task is queued.", "info");
	}

	pi.registerCommand(COMMAND_NAME, {
		description: "Enter Plannotator mode and immediately hand off the supplied task for planning",
		handler: async (args, ctx) => {
			try {
				await startPlanning(args, ctx);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerTool({
		name: TOOL_NAME,
		label: "Start Plannotator",
		description:
			"Enter Plannotator for cross-system architectural design whose implementation path or completion standard remains undefined, or when explicitly requested. Use a checklist for approved, bounded work. Submit the plan with plannotator_submit_plan before implementation.",
		promptSnippet: "Start Plannotator for unresolved cross-system architectural design or an explicit planning request.",
		promptGuidelines: [
			"Use start_plannotator before implementation only when cross-system architectural design is required and its implementation path or completion standard remains undefined, or when the user explicitly requests Plannotator. File count, unfamiliar code, and test work alone do not qualify. Execute approved, bounded work with a checklist without another approval gate for the same decisions.",
			"start_plannotator enters planning immediately without asking for another confirmation, then hands off the supplied task. During planning, write the plan and call plannotator_submit_plan to open browser review before implementation.",
			"When using Plannotator, MUST NOT manually create duplicate todo tasks from the plan. The bridge imports approved checklist items into rpiv-todo and makes that overlay the single visible execution checklist.",
		],
		parameters: Type.Object({
			task: Type.String({ description: "The complete feature, change, or investigation task to plan" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				await startPlanning(params.task, ctx);
				return {
					content: [{ type: "text", text: "Plannotator planning mode entered and the task was queued." }],
					details: { phase: "planning", task: params.task },
					terminate: true,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Error: ${message}` }],
					details: { error: message },
				};
			}
		},
	});

	pi.registerCommand(SISYPHUS_COMMAND, {
		description: "Start Sisyphus from remaining Plannotator-linked todos in plan order",
		handler: async (_args, ctx) => {
			try {
				if (!hasCommand(pi, "sisyphus-set")) throw new Error("pi-goal-x is unavailable: /sisyphus-set is not registered.");
				if (!state.activePlanPath) throw new Error("No active Plannotator-linked plan.");
				const snapshot = await getTodos(pi.events);
				const objective = serializeSisyphusObjective(
					snapshot.tasks.filter((task) => isLinkedTask(task, state.activePlanPath)),
				);
				pi.sendUserMessage(`/sisyphus-set ${objective}`, { deliverAs: "followUp" });
				ctx.ui.notify("Queued /sisyphus-set from remaining linked todos.", "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		await enqueue(ctx, async () => {
			await reconcileMarkers(ctx);
			await processPendingCompletions(ctx);
		});
	});

	pi.on("turn_end", async (event, ctx) => {
		const text = assistantText(event.message);
		const steps = extractDoneSteps(text);
		if (steps.length === 0 || !state.activePlanPath) {
			deferDuplicateWidgetHide(ctx);
			return;
		}
		await enqueue(ctx, async () => {
			const planPath = state.activePlanPath;
			if (!planPath) return;
			const existing = (state.pendingCompletions ?? []).find((item) => item.planPath === planPath);
			if (existing) {
				existing.steps = [...new Set([...existing.steps, ...steps])].sort((a, b) => a - b);
			} else {
				state = {
					...state,
					pendingCompletions: [...(state.pendingCompletions ?? []), { planPath, steps: [...steps] }],
				};
			}
			persistState();
			await processPendingCompletions(ctx);
			deferDuplicateWidgetHide(ctx);
		});
	});

	async function restore(ctx: ExtensionContext): Promise<void> {
		state = restoreBridgeState(ctx.sessionManager.getBranch());
		await enqueue(ctx, async () => {
			await reconcileMarkers(ctx);
			await processPendingCompletions(ctx);
		});
		deferDuplicateWidgetHide(ctx);
	}

	function isStaleContext(error: unknown): boolean {
		return /stale after session replacement/.test(String(error));
	}

	pi.on("session_start", async (_event, ctx) => {
		operation = Promise.resolve();
		await restore(ctx);
	});
	pi.on("session_compact", async (_event, ctx) => {
		try {
			operation = Promise.resolve();
			await restore(ctx);
		} catch (error) {
			if (!isStaleContext(error)) throw error;
		}
	});
	pi.on("session_tree", async (_event, ctx) => {
		operation = Promise.resolve();
		await restore(ctx);
	});
}
