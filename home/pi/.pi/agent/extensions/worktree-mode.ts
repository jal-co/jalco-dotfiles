import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MODES = ["orca", "native"] as const;
type Mode = (typeof MODES)[number];

const MODE_FILE = join(homedir(), ".pi", "agent", "state", "worktree-manager");

export function readMode(): Mode {
	if (!existsSync(MODE_FILE)) return "orca";
	return readFileSync(MODE_FILE, "utf8").trim() === "native" ? "native" : "orca";
}

const GUIDELINES: Record<Mode, string> = {
	orca: "Worktree manager: orca. Create, reuse, and hand off task worktrees through Orca as ~/.pi/agent/workflows/worktrees.md describes.",
	native:
		"Worktree manager: native. Do not use Orca for worktrees. Create task worktrees with `git worktree add -b <branch> <repo>/<semantic-slug> origin/<default>` and keep working in the current session with absolute paths; do not launch a replacement Pi session. Remove them with `git worktree remove` after merge.",
};

export default function worktreeMode(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.promptGuidelines.push(GUIDELINES[readMode()]);
	});

	pi.registerCommand("worktrees", {
		description: "Choose how task worktrees are created: orca, native, or status",
		getArgumentCompletions: (prefix) =>
			[...MODES, "status"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
		handler: async (arg, ctx) => {
			const choice = arg.trim() || "status";
			if (choice === "status") {
				ctx.ui.notify(`Worktrees: ${readMode()}`, "info");
				return;
			}
			const mode = MODES.find((value) => value === choice);
			if (!mode) {
				ctx.ui.notify("Usage: /worktrees orca|native|status", "error");
				return;
			}
			mkdirSync(dirname(MODE_FILE), { recursive: true });
			writeFileSync(MODE_FILE, `${mode}\n`);
			ctx.ui.notify(`Worktrees: ${mode} in every session from the next turn`, "info");
		},
	});
}
