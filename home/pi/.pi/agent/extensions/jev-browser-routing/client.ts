import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { Parse } from "typebox/value";
import { serverResponseSchema, type ServerData, type ServerRequest, type ServerResponse } from "./protocol.js";
import { browserEnvironment } from "../../browser-testing/policy.mjs";

interface PendingRequest {
	resolve: (value: ServerData) => void;
	reject: (error: Error) => void;
}

export class JevClient {
	private child?: ChildProcessWithoutNullStreams;
	private lines?: Interface;
	private pending: PendingRequest[] = [];
	private stderr = "";

	constructor(
		private readonly command = resolveJevCommand(),
		private readonly cwd = process.cwd(),
	) {}

	request(payload: ServerRequest, signal?: AbortSignal): Promise<ServerData> {
		this.start();
		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				reject(new Error("Jev request cancelled"));
				return;
			}
			const onAbort = () => {
				this.stop(new Error("Jev request cancelled"));
			};
			signal?.addEventListener("abort", onAbort, { once: true });
			this.pending.push({
				resolve: value => {
					signal?.removeEventListener("abort", onAbort);
					resolve(value);
				},
				reject: error => {
					signal?.removeEventListener("abort", onAbort);
					reject(error);
				},
			});
			this.child?.stdin.write(`${JSON.stringify(payload)}\n`);
		});
	}

	stop(error = new Error("Jev server stopped")): void {
		this.lines?.close();
		this.lines = undefined;
		this.child?.kill();
		this.child = undefined;
		for (const request of this.pending.splice(0)) request.reject(error);
	}

	private start(): void {
		if (this.child) return;
		this.stderr = "";
		const child = spawn(this.command, [], { cwd: this.cwd, env: browserEnvironment(), stdio: "pipe" });
		this.child = child;
		this.lines = createInterface({ input: child.stdout });
		this.lines.on("line", line => this.handleLine(line));
		child.stderr.on("data", chunk => {
			this.stderr = `${this.stderr}${String(chunk)}`.slice(-4000);
		});
		child.on("error", error => this.stop(error));
		child.on("exit", code => {
			if (this.child !== child) return;
			const detail = this.stderr.trim();
			this.stop(new Error(detail || `Jev server exited with code ${code ?? "unknown"}`));
		});
	}

	private handleLine(line: string): void {
		const request = this.pending.shift();
		if (!request) return;
		let response: ServerResponse;
		try {
			response = Parse(serverResponseSchema, JSON.parse(line));
		} catch {
			request.reject(new Error("Jev server returned invalid JSON"));
			return;
		}
		if (!response.ok) {
			request.reject(new Error(response.error || "Jev request failed"));
			return;
		}
		request.resolve(response.data);
	}
}

export function resolveJevCommand(): string {
	const configured = process.env.JEV_AGENT_BROWSER_COMMAND;
	if (configured) return configured;
	const candidates = [
		join(homedir(), ".local", "share", "jev-agent-browser", "venv", "bin", "jev-agent-browser"),
		join(homedir(), "dev", "jev-agent-browser", ".venv", "bin", "jev-agent-browser"),
	];
	for (const candidate of candidates) {
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {}
	}
	return "jev-agent-browser";
}
