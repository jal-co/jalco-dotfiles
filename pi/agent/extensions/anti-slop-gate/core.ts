import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LAUNCHER_PATH = join(homedir(), "dotfiles", "tools", "anti-slop", "bin", "anti-slop");
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const SKIP_TOKEN = "ANTI_SLOP_SKIP=1";

const GATED_COMMAND = /\bgh\s+pr\s+(?:create|edit)\b|\bgit\s+(?:-[^\s]+\s+|-C\s+\S+\s+)*push\b/;
const SOURCE_FILE = /\.(?:[mc]?[jt]s|[jt]sx)$/;

export function isGatedCommand(command: string): boolean {
	return GATED_COMMAND.test(command);
}

export function hasUserSkip(command: string): boolean {
	return command.includes(SKIP_TOKEN);
}

export function selectSourceFiles(root: string, diffOutput: string): string[] {
	return diffOutput
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && SOURCE_FILE.test(line))
		.map((line) => join(root, line))
		.filter((path) => existsSync(path));
}

export function buildBlockReason(output: string): string {
	const lines = output.trim().split("\n");
	const tail = lines.slice(-30).join("\n");
	return [
		"anti-slop found issues in the changed JavaScript/TypeScript files:",
		tail,
		"Fix the findings in changed code before publishing. If the user explicitly approves keeping a finding, rerun the exact command prefixed with ANTI_SLOP_SKIP=1 and report the finding in the PR.",
	].join("\n\n");
}

export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
}

export type Exec = (command: string, args: string[]) => Promise<ExecResult>;

async function resolveBase(exec: Exec, root: string): Promise<string> {
	for (const ref of ["@{upstream}", "origin/HEAD"]) {
		const result = await exec("git", ["-C", root, "rev-parse", "--verify", "--quiet", ref]);
		if (result.code === 0 && result.stdout.trim()) {
			const base = await exec("git", ["-C", root, "merge-base", "HEAD", result.stdout.trim()]);
			if (base.code === 0 && base.stdout.trim()) return base.stdout.trim();
		}
	}
	return EMPTY_TREE;
}

export async function evaluateGate(exec: Exec, cwd: string, command: string): Promise<string | undefined> {
	if (!isGatedCommand(command) || hasUserSkip(command)) return undefined;
	const repo = await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
	if (repo.code !== 0) return undefined;
	const root = repo.stdout.trim();
	const head = await exec("git", ["-C", root, "rev-parse", "--verify", "--quiet", "HEAD"]);
	if (head.code !== 0) return undefined;
	const base = await resolveBase(exec, root);
	const diff = await exec("git", ["-C", root, "diff", "--name-only", "--diff-filter=ACMR", `${base}`, "HEAD"]);
	if (diff.code !== 0) return undefined;
	const files = selectSourceFiles(root, diff.stdout);
	if (files.length === 0) return undefined;
	if (!existsSync(LAUNCHER_PATH)) {
		return `anti-slop launcher is missing at ${LAUNCHER_PATH}. Restore it (npm install --prefix ~/dotfiles/tools/anti-slop) or, with explicit user approval, rerun the command prefixed with ANTI_SLOP_SKIP=1.`;
	}
	const lint = await exec(LAUNCHER_PATH, files);
	if (lint.code === 0) return undefined;
	return buildBlockReason(`${lint.stdout}\n${lint.stderr}`);
}
