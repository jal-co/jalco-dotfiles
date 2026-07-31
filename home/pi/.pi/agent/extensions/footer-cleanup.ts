import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

const HIDDEN_STATUS_KEYS = new Set([
	"pi-agentation",
	"codex-micro",
	"mcp",
	"mcp-auth",
	"skills-perms",
	"time-tracker",
]);

const wrappedContexts = new WeakSet<object>();

export default function footerCleanup(pi: ExtensionAPI): void {
	let latestUI: ExtensionUIContext | undefined;

	function clearStatuses(): void {
		if (!latestUI) return;
		for (const key of HIDDEN_STATUS_KEYS) latestUI.setStatus(key, undefined);
	}

	function deferClear(): void {
		setTimeout(clearStatuses, 0);
	}

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		latestUI = ctx.ui;
		if (!wrappedContexts.has(ctx.ui)) {
			const ui = ctx.ui as ExtensionUIContext & {
				setStatus: (key: string, value: string | undefined) => void;
			};
			const setStatus = ui.setStatus.bind(ui);
			ui.setStatus = (key, value) => {
				if (HIDDEN_STATUS_KEYS.has(key)) {
					setStatus(key, undefined);
					return;
				}
				setStatus(key, value);
			};
			wrappedContexts.add(ctx.ui);
		}
		clearStatuses();
		setTimeout(clearStatuses, 250);
	});

	pi.on("agent_start", deferClear);
	pi.on("tool_execution_end", deferClear);
	pi.on("agent_settled", deferClear);
	pi.events.on("pi-mcp-adapter/status/v1", deferClear);
	pi.on("session_shutdown", async () => {
		clearStatuses();
		latestUI = undefined;
	});
}
