import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

const BIN = join(homedir(), "dotfiles", "tools", "anti-slop", "bin");
export const LAUNCHER_PATH = join(BIN, "shadcn-lint");
export const MASTRA_LAUNCHER_PATH = join(BIN, "mastra-ui-lint");
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const SKIP_TOKEN = "SHADCN_LINT_SKIP=1";

const PUSH_COMMAND = /\bgh\s+pr\s+(?:create|edit)\b|\bgit\s+(?:-[^\s]+\s+|-C\s+\S+\s+)*push\b/;
const COMMIT_COMMAND = /\bgit\s+(?:-[^\s]+\s+|-C\s+\S+\s+)*commit\b/;
const COMMIT_ALL = /\bgit\s+(?:-[^\s]+\s+|-C\s+\S+\s+)*commit\b[^|;&]*\s(?:-a\b|--all\b|-[a-zA-Z]*a[a-zA-Z]*\b)/;
const SOURCE_FILE = /\.[jt]sx$/;
const EXCLUDED_FILE = /\.(test|spec|stories)\.[jt]sx$/;
const MASTRA_UI_PACKAGE = "@mastra/playground-ui";

export type Launcher = "shadcn" | "mastra";

export function isGatedCommand(command: string): boolean {
	return PUSH_COMMAND.test(command) || COMMIT_COMMAND.test(command);
}

export function hasUserSkip(command: string): boolean {
	return command.includes(SKIP_TOKEN);
}

function usesMastraUi(packageJson: string): boolean {
	const manifest: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } =
		JSON.parse(readFileSync(packageJson, "utf8"));
	return (
		manifest.name === MASTRA_UI_PACKAGE ||
		MASTRA_UI_PACKAGE in (manifest.dependencies ?? {}) ||
		MASTRA_UI_PACKAGE in (manifest.devDependencies ?? {})
	);
}

export function launcherFor(root: string, path: string): Launcher | undefined {
	let current = dirname(path);
	let shadcn = false;
	while (current.startsWith(root)) {
		if (existsSync(join(current, "components.json"))) shadcn = true;
		const packageJson = join(current, "package.json");
		if (existsSync(packageJson)) {
			if (usesMastraUi(packageJson)) return "mastra";
			if (shadcn) return "shadcn";
		}
		if (current === root) break;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return shadcn ? "shadcn" : undefined;
}

export function selectSourceFiles(root: string, diffOutput: string): Map<Launcher, string[]> {
	const selected = new Map<Launcher, string[]>();
	for (const line of diffOutput.split("\n")) {
		const file = line.trim();
		if (!SOURCE_FILE.test(file) || EXCLUDED_FILE.test(file)) continue;
		const path = join(root, file);
		if (!existsSync(path)) continue;
		const launcher = launcherFor(root, path);
		if (!launcher) continue;
		selected.set(launcher, [...(selected.get(launcher) ?? []), path]);
	}
	return selected;
}

export function parseChangedLines(root: string, unifiedDiff: string): Map<string, Set<number>> {
	const changed = new Map<string, Set<number>>();
	let current: Set<number> | undefined;
	for (const line of unifiedDiff.split("\n")) {
		const file = /^\+\+\+ b\/(.+)$/.exec(line);
		if (file) {
			current = new Set();
			changed.set(join(root, file[1]), current);
			continue;
		}
		const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (hunk && current) {
			const start = Number(hunk[1]);
			const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
			for (let offset = 0; offset < count; offset++) current.add(start + offset);
		}
	}
	return changed;
}

export interface Finding {
	file: string;
	line: number;
	code: string;
	message: string;
}

interface OxlintReport {
	diagnostics: Array<{ code?: string; message: string; filename: string; labels?: Array<{ span: { line: number } }> }>;
}

export function parseFindings(stdout: string): Finding[] {
	const report: OxlintReport = JSON.parse(stdout);
	return report.diagnostics.map((diagnostic) => ({
		file: diagnostic.filename,
		line: diagnostic.labels?.[0]?.span.line ?? 0,
		code: diagnostic.code ?? "oxlint",
		message: diagnostic.message,
	}));
}

export function findingsOnChangedLines(findings: Finding[], changed: Map<string, Set<number>>): Finding[] {
	return findings.filter((finding) => changed.get(finding.file)?.has(finding.line));
}

export function buildBlockReason(root: string, findings: Finding[]): string {
	const lines = findings.slice(0, 40).map((finding) => `${relative(root, finding.file)}:${finding.line} ${finding.code} ${finding.message}`);
	if (findings.length > 40) lines.push(`…and ${findings.length - 40} more`);
	return [
		"UI lint found design-system findings on the lines this change adds or edits:",
		lines.join("\n"),
		"Fix each finding. The rules follow the mastra-ui-contract and mastra-ui-copy skills for Mastra packages, and @shadcn/lint for other shadcn projects. If a finding is a valid exception, rerun the exact command prefixed with SHADCN_LINT_SKIP=1.",
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

async function diffRange(exec: Exec, root: string, command: string): Promise<string[] | undefined> {
	if (!PUSH_COMMAND.test(command)) return COMMIT_ALL.test(command) ? ["HEAD"] : ["--cached"];
	const head = await exec("git", ["-C", root, "rev-parse", "--verify", "--quiet", "HEAD"]);
	if (head.code !== 0) return undefined;
	return [await resolveBase(exec, root), "HEAD"];
}

export async function evaluateGate(exec: Exec, cwd: string, command: string): Promise<string | undefined> {
	if (!isGatedCommand(command) || hasUserSkip(command)) return undefined;
	const repo = await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
	if (repo.code !== 0) return undefined;
	const root = repo.stdout.trim();
	const range = await diffRange(exec, root, command);
	if (!range) return undefined;
	const names = await exec("git", ["-C", root, "diff", "--name-only", "--diff-filter=ACMR", ...range]);
	if (names.code !== 0) return undefined;
	const selected = selectSourceFiles(root, names.stdout);
	if (selected.size === 0) return undefined;
	const files = [...selected.values()].flat();
	const diff = await exec("git", ["-C", root, "diff", "-U0", "--diff-filter=ACMR", ...range, "--", ...files]);
	if (diff.code !== 0) return undefined;
	const changed = parseChangedLines(root, diff.stdout);
	const findings: Finding[] = [];
	for (const [launcher, paths] of selected) {
		const launcherPath = launcher === "mastra" ? MASTRA_LAUNCHER_PATH : LAUNCHER_PATH;
		if (!existsSync(launcherPath)) {
			return `UI lint launcher is missing at ${launcherPath}. Restore it with npm install --prefix ~/dotfiles/tools/anti-slop or, with explicit user approval, rerun the command prefixed with ${SKIP_TOKEN}.`;
		}
		const lint = await exec(launcherPath, ["-f", "json", ...paths]);
		findings.push(...findingsOnChangedLines(parseFindings(lint.stdout), changed));
	}
	return findings.length > 0 ? buildBlockReason(root, findings) : undefined;
}
