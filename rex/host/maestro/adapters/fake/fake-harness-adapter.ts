import type {
	HarnessAdapter,
	ResumeOptions,
	SpawnOptions,
} from "../../core/harness-adapter.ts";
import type {
	AgentHandle,
	AgentState,
	CompletionEvidence,
} from "../../core/types.ts";

const ABORT_MESSAGE = "Aborted while waiting for subagent to finish";

interface FakeHarnessRecord {
	handle: AgentHandle;
	request: SpawnOptions | ResumeOptions;
	state: AgentState;
	output: string[];
	inputs: string[];
	completion?: CompletionEvidence;
	exitCode?: number;
	waiters: Set<Waiter>;
}

interface Waiter {
	resolve(evidence: CompletionEvidence): void;
	reject(error: Error): void;
	signal: AbortSignal;
	onAbort(): void;
}

export class FakeHarnessAdapter implements HarnessAdapter {
	readonly name = "fake";

	#nextHandle = 1;
	#records = new Map<string, FakeHarnessRecord>();
	#sessionHandles = new Map<string, Set<string>>();

	isAvailable(): boolean {
		return true;
	}

	async spawn(opts: SpawnOptions): Promise<AgentHandle> {
		const handle: AgentHandle = {
			id: this.#newHandleId(),
			name: opts.name,
			role: opts.role.name,
			harness: this.name,
			cwd: opts.cwd,
			startedAt: Date.now(),
			sessionId: opts.sessionId,
			surfaceId: opts.surface?.id,
			worktree: opts.worktree,
		};
		this.#records.set(handle.id, {
			handle,
			request: cloneSpawnOptions(opts),
			state: "working",
			output: [],
			inputs: [],
			waiters: new Set(),
		});
		this.#rememberSession(handle);
		return {
			...handle,
			worktree: handle.worktree ? { ...handle.worktree } : undefined,
		};
	}

	async resume(opts: ResumeOptions): Promise<AgentHandle> {
		if (!opts.name) throw new Error("resume requires name");
		const prior = this.#latestSessionHandle(opts.sessionId);
		const handle: AgentHandle = {
			id: this.#newHandleId(),
			name: opts.name,
			role: prior?.role ?? "resumed",
			harness: this.name,
			cwd: prior?.cwd ?? process.cwd(),
			startedAt: Date.now(),
			sessionId: opts.sessionId,
			surfaceId: opts.surface?.id,
		};
		this.#records.set(handle.id, {
			handle,
			request: { ...opts },
			state: "working",
			output: [],
			inputs: opts.message ? [opts.message] : [],
			waiters: new Set(),
		});
		this.#rememberSession(handle);
		return { ...handle };
	}

	async getState(handle: AgentHandle): Promise<AgentState> {
		return this.#records.get(handle.id)?.state ?? "unknown";
	}

	async interrupt(handle: AgentHandle): Promise<void> {
		const record = this.#record(handle.id);
		if (record.state !== "done") record.state = "idle";
	}

	async kill(handle: AgentHandle): Promise<void> {
		const record = this.#record(handle.id);
		record.state = "done";
		this.#settle(handle.id, {
			reason: "error",
			exitCode: 143,
			errorMessage: "terminated by kill",
		});
	}

	async sendInput(handle: AgentHandle, text: string): Promise<void> {
		this.#record(handle.id).inputs.push(text);
	}

	async readOutput(handle: AgentHandle, lines?: number): Promise<string> {
		const output = this.#record(handle.id).output;
		return (lines === undefined ? output : output.slice(-lines)).join("\n");
	}

	exitCode(handle: AgentHandle): number | undefined {
		return this.#records.get(handle.id)?.exitCode;
	}

	awaitCompletion(
		handle: AgentHandle,
		signal: AbortSignal,
	): Promise<CompletionEvidence> {
		const record = this.#record(handle.id);
		if (signal.aborted) return Promise.reject(new Error(ABORT_MESSAGE));
		if (record.completion) return Promise.resolve({ ...record.completion });

		return new Promise((resolve, reject) => {
			const waiter: Waiter = {
				resolve: (evidence) => {
					signal.removeEventListener("abort", waiter.onAbort);
					resolve({ ...evidence });
				},
				reject: (error) => {
					signal.removeEventListener("abort", waiter.onAbort);
					reject(error);
				},
				signal,
				onAbort: () => {
					record.waiters.delete(waiter);
					waiter.reject(new Error(ABORT_MESSAGE));
				},
			};
			record.waiters.add(waiter);
			signal.addEventListener("abort", waiter.onAbort, { once: true });
		});
	}

	complete(handleId: string, evidence: CompletionEvidence): void {
		this.#settle(handleId, evidence);
	}

	fail(handleId: string, error: string): void {
		this.#settle(handleId, {
			reason: "error",
			exitCode: 1,
			errorMessage: error,
		});
	}

	ping(handleId: string, message: string): void {
		const record = this.#record(handleId);
		this.#settle(handleId, {
			reason: "ping",
			exitCode: 0,
			ping: { name: record.handle.name, message },
		});
	}

	spawned(): AgentHandle[] {
		return Array.from(this.#records.values(), (record) =>
			cloneHandle(record.handle),
		);
	}

	inputs(handleId: string): string[] {
		return [...this.#record(handleId).inputs];
	}

	request(handleId: string): SpawnOptions | ResumeOptions | undefined {
		const request = this.#records.get(handleId)?.request;
		return request ? cloneRequest(request) : undefined;
	}

	appendOutput(handleId: string, text: string): void {
		this.#record(handleId).output.push(...text.split("\n"));
	}

	#settle(handleId: string, evidence: CompletionEvidence): void {
		const record = this.#record(handleId);
		if (record.completion) return;
		const completion = {
			...evidence,
			sessionRef: evidence.sessionRef ?? record.handle.sessionId,
		};
		record.completion = completion;
		record.exitCode = completion.exitCode;
		record.state = "done";
		const waiters = [...record.waiters];
		record.waiters.clear();
		for (const waiter of waiters) waiter.resolve(completion);
	}

	#record(handleId: string): FakeHarnessRecord {
		const record = this.#records.get(handleId);
		if (!record) throw new Error(`unknown handle: ${handleId}`);
		return record;
	}

	#newHandleId(): string {
		const id = `fake-agent-${this.#nextHandle}`;
		this.#nextHandle += 1;
		return id;
	}

	#rememberSession(handle: AgentHandle): void {
		const handles =
			this.#sessionHandles.get(handle.sessionId) ?? new Set<string>();
		handles.add(handle.id);
		this.#sessionHandles.set(handle.sessionId, handles);
	}

	#latestSessionHandle(sessionId: string): AgentHandle | undefined {
		const handles = this.#sessionHandles.get(sessionId);
		if (!handles) return undefined;
		const handleId = Array.from(handles).at(-1);
		return handleId ? this.#records.get(handleId)?.handle : undefined;
	}
}

function cloneRequest(request: SpawnOptions | ResumeOptions) {
	if ("task" in request) return cloneSpawnOptions(request);
	return {
		...request,
		env: request.env ? { ...request.env } : undefined,
	};
}

function cloneSpawnOptions(options: SpawnOptions): SpawnOptions {
	return {
		...options,
		role: { ...options.role, allowedTools: [...options.role.allowedTools] },
		worktree: options.worktree ? { ...options.worktree } : undefined,
		worktreeRequest: options.worktreeRequest
			? { ...options.worktreeRequest }
			: undefined,
		env: options.env ? { ...options.env } : undefined,
	};
}

function cloneHandle(handle: AgentHandle): AgentHandle {
	return {
		...handle,
		worktree: handle.worktree ? { ...handle.worktree } : undefined,
	};
}
