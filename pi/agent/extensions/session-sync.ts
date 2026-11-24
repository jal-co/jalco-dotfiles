import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const sessionsDir = () => join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent"), "sessions");
const listFile = () => process.env.SESSION_SYNC_LIST ?? join(homedir(), ".local/state/session-sync/saved");
const hostsFile = () => process.env.REX_HOSTS_CONFIG ?? join(homedir(), "dotfiles/rex/config/hosts.json");

type Hosts = { hosts: Record<string, { ssh: string; hostname: string }> };

export function otherHost(config: Hosts, self = hostname()): { name: string; ssh: string } | undefined {
	const short = self.toLowerCase().split(".")[0];
	const isSelf = ([name, host]: [string, { hostname: string }]) => name === short || host.hostname === short;
	const entries = Object.entries(config.hosts);
	const found = entries.some(isSelf) ? entries.find((entry) => !isSelf(entry)) : undefined;
	return found && /^[a-z0-9][\w.@-]*$/i.test(found[1].ssh) ? { name: found[0], ssh: found[1].ssh } : undefined;
}

export function savedSessions(root = sessionsDir(), file = listFile()): string[] {
	if (!existsSync(file)) return [];
	const inside = (path: string) => /^[^/]+\/[^/]+\.jsonl$/.test(path) && !path.startsWith(".") && existsSync(join(root, path));
	return [...new Set(readFileSync(file, "utf8").split("\n").filter(inside))];
}

export function rememberSession(sessionFile: string, root = sessionsDir(), file = listFile()): string {
	const path = relative(root, sessionFile);
	if (!savedSessions(root, file).includes(path)) {
		mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
		appendFileSync(file, `${path}\n`, { mode: 0o600 });
	}
	return path;
}

export const rsyncArgs = (paths: string[], ssh: string) => ["-a", "-R", "-e", "ssh -o BatchMode=yes -o ConnectTimeout=5", "--", ...paths, `${ssh}:.pi/agent/sessions/`];

function sync(): Promise<{ sent: boolean; to?: string; error?: string }> {
	const paths = savedSessions();
	if (paths.length === 0) return Promise.resolve({ sent: false, error: "nothing saved" });
	const other = existsSync(hostsFile()) ? otherHost(JSON.parse(readFileSync(hostsFile(), "utf8"))) : undefined;
	if (!other) return Promise.resolve({ sent: false, error: "no other machine in rex/config/hosts.json" });
	return new Promise((resolve) => {
		execFile("rsync", rsyncArgs(paths, other.ssh), { cwd: sessionsDir(), timeout: 120_000 }, (error, _out, stderr) => {
			resolve(error ? { sent: false, to: other.name, error: stderr.trim().split("\n").at(-1) || error.message } : { sent: true, to: other.name });
		});
	});
}

export default function sessionSync(pi: ExtensionAPI): void {
	let running = false;
	const background = async (sessionFile: string | undefined) => {
		if (running || !sessionFile || !savedSessions().includes(relative(sessionsDir(), sessionFile))) return;
		running = true;
		await sync();
		running = false;
	};

	pi.registerCommand("save", {
		description: "Keep this session copied to your other machine over ssh, so session search finds it there",
		handler: async (_args, ctx) => {
			const sessionFile = ctx.sessionManager.getSessionFile();
			if (!sessionFile) return ctx.ui.notify("save: this session is not written to disk", "error");
			rememberSession(sessionFile);
			const result = await sync();
			if (result.sent) return ctx.ui.notify(`Saved to ${result.to}. It stays in sync after each turn.`, "info");
			ctx.ui.notify(`Marked as saved, but not sent yet: ${result.error}. It is sent after the next turn of any saved session.`, "warning");
		},
	});

	pi.on("agent_settled", (_event, ctx) => background(ctx.sessionManager.getSessionFile()));
	pi.on("session_shutdown", (_event, ctx) => background(ctx.sessionManager.getSessionFile()));
}
