import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

const HIDDEN_STATUS_KEYS = new Set([
	"pi-agentation",
	"codex-micro",
	"mcp",
	"mcp-auth",
	"multi-pass",
	"provider-model",
	"skills-perms",
	"time-tracker",
]);

const wrappedContexts = new WeakSet<object>();

type StatusColor = "accent" | "dim" | "error" | "muted" | "success" | "warning";
type Colorize = (color: StatusColor, text: string) => string;

export function formatPonytailStatus(value: string, colorize: Colorize): string {
	const mode = ["lite", "full", "ultra"].find((candidate) => value.toLowerCase().includes(candidate));
	if (!mode) return value;
	const active = value.includes("●");
	const indicator = colorize(active ? "accent" : "dim", active ? "" : "");
	const horse = colorize("warning", "󱖿");
	if (mode === "lite") return `${indicator} ${horse} ${colorize("success", "")} ${colorize("muted", mode)}`;
	if (mode === "full") return `${indicator} ${horse} ${colorize("accent", "")} ${colorize("muted", mode)}`;
	return `${indicator} ${horse} ${colorize("error", "")} ${colorize("muted", mode)}`;
}

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
			const ui = ctx.ui;
			const setStatus = ui.setStatus.bind(ui);
			ui.setStatus = (key, value) => {
				if (HIDDEN_STATUS_KEYS.has(key)) {
					setStatus(key, undefined);
					return;
				}
				if (key === "ponytail" && value) {
					setStatus(key, formatPonytailStatus(value, (color, text) => ui.theme.fg(color, text)));
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
