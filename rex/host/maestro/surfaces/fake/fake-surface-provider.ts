import path from "node:path";
import type { OpenedPrimaryWorkspaceReport } from "../../core/opened-primary-workspace.ts";
import type {
	CreateSurfaceOptions,
	CreateWorktreeSurfaceOptions,
	ReportOpenedPrimaryWorkspaceInput,
	SurfaceInfo,
	SurfaceProcessInfo,
	SurfaceProvider,
	WorktreeSurface,
	WorktreeSurfaceInfo,
} from "../../core/surface-provider.ts";
import type { PaneInspection, SurfaceHandle } from "../../core/types.ts";

interface FakeSurfaceRecord extends SurfaceInfo {
	screen: string[];
	commands: string[];
	keys: string[];
	processInfo: SurfaceProcessInfo;
	inspection?: PaneInspection;
}

interface FakeWorktreeInfoRecord extends WorktreeSurfaceInfo {
	sourceCwd?: string;
}

interface FakeSurfaceProviderOptions {
	maxPerTab?: number;
}

export class FakeSurfaceProvider implements SurfaceProvider {
	readonly name = "fake";

	#nextSurface = 1;
	#nextWorkspace = 1;
	#nextWorkspaceGroup = 1;
	#maxPerTab: number;
	#surfaces = new Map<string, FakeSurfaceRecord>();
	#worktrees = new Map<string, WorktreeSurface>();
	#worktreeInfo: FakeWorktreeInfoRecord[] = [];
	#titles = new Map<"tab" | "workspace", string>();

	constructor(options: FakeSurfaceProviderOptions = {}) {
		this.#maxPerTab = options.maxPerTab ?? 4;
	}

	isAvailable(): boolean {
		return true;
	}

	createSurface(opts: CreateSurfaceOptions): string {
		const id = `fake-surface-${this.#nextSurface}`;
		this.#nextSurface += 1;
		const group = this.#groupFor(opts.placement?.kind ?? "grouped");
		this.#surfaces.set(id, {
			id,
			name: opts.name,
			cwd: opts.cwd,
			group,
			screen: [],
			commands: [],
			keys: [],
			processInfo: { pids: [], foregroundProcesses: [] },
		});
		return id;
	}

	runCommand(surfaceId: string, command: string): void {
		const surface = this.#surface(surfaceId);
		surface.commands.push(command);
		surface.screen.push(`$ ${command}`);
		const echoText = echoOutput(command);
		if (echoText !== null) {
			surface.screen.push(echoText);
		}
	}

	readScreen(surfaceId: string, lines?: number): string {
		const surface = this.#surface(surfaceId);
		const screen =
			lines === undefined ? surface.screen : surface.screen.slice(-lines);
		return screen.join("\n");
	}

	closeSurface(surfaceId: string): void {
		this.removeSurface(surfaceId);
	}

	listSurfaces(_opts?: { timeoutMs?: number }): SurfaceInfo[] {
		return Array.from(
			this.#surfaces.values(),
			({ id, name, cwd, group, workspaceId }) => {
				const info: SurfaceInfo = { id, name, cwd, group };
				if (workspaceId) info.workspaceId = workspaceId;
				return info;
			},
		);
	}

	attachSurface(id: string): SurfaceHandle {
		this.#surface(id);
		return {
			id,
			runCommand: (command) => this.runCommand(id, command),
			readScreen: (lines) => this.readScreen(id, lines),
			sendKeys: (keys) => this.sendKeys(id, keys),
			close: () => this.closeSurface(id),
		};
	}

	createWorktreeSurface(opts: CreateWorktreeSurfaceOptions): WorktreeSurface {
		const workspaceId = `fake-workspace-${this.#nextWorkspace}`;
		this.#nextWorkspace += 1;
		const worktreePath = path.join(opts.cwd, sanitizePathPart(opts.branch));
		const surfaceId = this.createSurface({
			name: opts.name,
			cwd: worktreePath,
			placement: { kind: "tab" },
		});
		const surface = this.#surface(surfaceId);
		surface.workspaceId = workspaceId;
		const worktree = {
			path: worktreePath,
			branch: opts.branch,
			workspaceId,
			surfaceId,
		};
		this.#worktrees.set(workspaceId, worktree);
		this.#worktreeInfo.push({
			path: worktree.path,
			branch: worktree.branch,
			workspaceId,
			isLinkedWorktree: true,
			sourceCwd: opts.cwd,
		});
		return worktree;
	}

	removeWorktreeSurface(
		workspaceId: string,
		_opts?: { timeoutMs?: number },
	): void {
		const worktree = this.#worktrees.get(workspaceId);
		if (!worktree) return;
		this.#worktrees.delete(workspaceId);
		this.#worktreeInfo = this.#worktreeInfo.filter(
			(info) => info.workspaceId !== workspaceId,
		);
		this.removeSurface(worktree.surfaceId);
	}

	reportOpenedPrimaryWorkspace(
		_input: ReportOpenedPrimaryWorkspaceInput,
	): OpenedPrimaryWorkspaceReport | undefined {
		return undefined;
	}

	setupHint(): string {
		return "Fake surface provider is always available in memory.";
	}

	runScript(
		surfaceId: string,
		command: string,
		options: { scriptPath: string; scriptPreamble: string },
	): string {
		const surface = this.#surface(surfaceId);
		surface.commands.push(command);
		surface.screen.push(`$ ${options.scriptPath}`);
		if (options.scriptPreamble.length > 0) {
			surface.screen.push(options.scriptPreamble);
		}
		const echoText = echoOutput(command);
		if (echoText !== null) {
			surface.screen.push(echoText);
		}
		return options.scriptPath;
	}

	async inspectSurface(surfaceId: string): Promise<PaneInspection> {
		const surface = this.#surfaces.get(surfaceId);
		if (!surface) {
			return { kind: "missing", error: `surface not found: ${surfaceId}` };
		}
		return (
			surface.inspection ?? {
				kind: "present",
				agentStatus: "idle",
				observedAt: Date.now(),
			}
		);
	}

	sendKeys(surfaceId: string, keys: string): void {
		this.#surface(surfaceId).keys.push(keys);
	}

	getProcessInfo(
		surfaceId: string,
		_opts?: { timeoutMs?: number },
	): SurfaceProcessInfo {
		const processInfo = this.#surface(surfaceId).processInfo;
		return {
			shellPid: processInfo.shellPid,
			foregroundProcessGroupId: processInfo.foregroundProcessGroupId,
			pids: [...processInfo.pids],
			foregroundProcesses: processInfo.foregroundProcesses.map((process) => ({
				...process,
				argv: process.argv ? [...process.argv] : undefined,
			})),
		};
	}

	async waitForShellReady(surfaceId: string): Promise<void> {
		this.#surface(surfaceId);
	}

	async waitForSurfaceAbsence(
		surfaceId: string,
		opts: { timeoutMs?: number } = {},
	): Promise<void> {
		if (!this.#surfaces.has(surfaceId)) return;
		throw new Error(
			`surface still present after ${opts.timeoutMs ?? 0}ms: ${surfaceId}`,
		);
	}

	async listWorktreeSurfaces(opts?: {
		cwd?: string;
		timeoutMs?: number;
	}): Promise<WorktreeSurfaceInfo[]> {
		void opts?.timeoutMs;
		return this.#worktreeInfo
			.filter(
				(worktree) =>
					opts?.cwd === undefined || worktree.sourceCwd === opts.cwd,
			)
			.map(({ sourceCwd, ...worktree }) => {
				void sourceCwd;
				return { ...worktree };
			});
	}

	focusWorkspace(workspaceId: string): void {
		void workspaceId;
	}

	setTitle(target: "tab" | "workspace", title: string): void {
		this.#titles.set(target, title);
	}

	scriptInspection(surfaceId: string, inspection: PaneInspection): void {
		this.#surface(surfaceId).inspection = inspection;
	}

	appendScreen(surfaceId: string, text: string): void {
		this.#surface(surfaceId).screen.push(...text.split("\n"));
	}

	commands(surfaceId: string): string[] {
		return [...this.#surface(surfaceId).commands];
	}

	recordWorktreeInfo(info: WorktreeSurfaceInfo, opts?: { cwd?: string }): void {
		this.#worktreeInfo.push({ ...info, sourceCwd: opts?.cwd });
	}

	removeSurface(surfaceId: string): void {
		this.#surfaces.delete(surfaceId);
		for (const [workspaceId, worktree] of this.#worktrees) {
			if (worktree.surfaceId === surfaceId) {
				this.#worktrees.delete(workspaceId);
				this.#worktreeInfo = this.#worktreeInfo.filter(
					(info) => info.workspaceId !== workspaceId,
				);
			}
		}
	}

	#surface(surfaceId: string): FakeSurfaceRecord {
		const surface = this.#surfaces.get(surfaceId);
		if (!surface) {
			throw new Error(`surface not found: ${surfaceId}`);
		}
		return surface;
	}

	#groupFor(kind: "grouped" | "split" | "tab"): string {
		if (kind === "tab") {
			const group = `fake-tab-group-${this.#nextWorkspaceGroup}`;
			this.#nextWorkspaceGroup += 1;
			return group;
		}
		if (kind === "split") {
			return "fake-split-group";
		}
		const groupCounts = new Map<number, number>();
		for (const surface of this.#surfaces.values()) {
			const match = /^fake-agents-(\d+)$/.exec(surface.group ?? "");
			if (!match) continue;
			const groupIndex = Number(match[1]);
			groupCounts.set(groupIndex, (groupCounts.get(groupIndex) ?? 0) + 1);
		}
		for (let groupIndex = 1; ; groupIndex += 1) {
			if ((groupCounts.get(groupIndex) ?? 0) < this.#maxPerTab) {
				return `fake-agents-${groupIndex}`;
			}
		}
	}
}

function echoOutput(command: string): string | null {
	const match = /^echo(?:\s+(.+))?$/.exec(command.trim());
	return match ? (match[1] ?? "") : null;
}

function sanitizePathPart(value: string): string {
	return value.replaceAll(/[^A-Za-z0-9._-]/g, "-");
}
