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
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type StatusColor = "accent" | "dim" | "error" | "muted" | "success" | "warning";
type Colorize = (color: StatusColor, text: string) => string;
export type BusyIndicatorMode = "default" | "dot" | "none" | "pulse" | "spinner";

export function getBusyIndicator(mode: BusyIndicatorMode, colorize: Colorize): { frames: string[]; intervalMs: number } {
	if (mode === "none") return { frames: [], intervalMs: 0 };
	if (mode === "dot") return { frames: [colorize("accent", "●")], intervalMs: 0 };
	if (mode === "pulse") {
		return {
			frames: [
				colorize("dim", "·"),
				colorize("muted", "•"),
				colorize("accent", "●"),
				colorize("muted", "•"),
			],
			intervalMs: 120,
		};
	}
	if (mode === "spinner") {
		return { frames: SPINNER_FRAMES.map((frame) => colorize("accent", frame)), intervalMs: 80 };
	}
	return { frames: [colorize("accent", "")], intervalMs: 0 };
}

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
	let mode: BusyIndicatorMode = "default";
	let busy = false;
	let frameIndex = 0;
	let timer: ReturnType<typeof setInterval> | undefined;

	function clearStatuses(): void {
		if (!latestUI) return;
		for (const key of HIDDEN_STATUS_KEYS) latestUI.setStatus(key, undefined);
	}

	function deferClear(): void {
		setTimeout(clearStatuses, 0);
	}

	function stopTimer(): void {
		if (timer) clearInterval(timer);
		timer = undefined;
	}

	function renderBusy(): void {
		const ui = latestUI;
		if (!ui || !busy) return;
		const indicator = getBusyIndicator(mode, (color, text) => ui.theme.fg(color, text));
		ui.setStatus("busy", indicator.frames[frameIndex % indicator.frames.length]);
		frameIndex++;
	}

	function setBusy(active: boolean): void {
		stopTimer();
		busy = active;
		frameIndex = 0;
		const ui = latestUI;
		if (!ui) return;
		const indicator = getBusyIndicator(mode, (color, text) => ui.theme.fg(color, text));
		if (!active || indicator.frames.length === 0) {
			ui.setStatus("busy", undefined);
			return;
		}
		renderBusy();
		if (indicator.frames.length > 1) {
			timer = setInterval(renderBusy, indicator.intervalMs);
			timer.unref();
		}
	}

	pi.registerCommand("footer-indicator", {
		description: "Set the footer busy indicator: dot, pulse, none, spinner, or reset.",
		handler: async (args, ctx) => {
			const nextMode = args.trim().toLowerCase();
			if (!nextMode) {
				ctx.ui.notify(`Footer indicator: ${mode}`, "info");
				return;
			}
			if (!["dot", "none", "pulse", "spinner", "reset"].includes(nextMode)) {
				ctx.ui.notify("Usage: /footer-indicator [dot|pulse|none|spinner|reset]", "error");
				return;
			}
			mode = nextMode === "reset" ? "default" : (nextMode as BusyIndicatorMode);
			setBusy(busy);
			ctx.ui.notify(`Footer indicator: ${mode}`, "info");
		},
	});

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
		setBusy(false);
		setTimeout(clearStatuses, 250);
	});

	pi.on("agent_start", () => {
		deferClear();
		setBusy(true);
	});
	pi.on("tool_execution_end", deferClear);
	pi.on("agent_settled", () => {
		deferClear();
		setBusy(false);
	});
	pi.events.on("pi-mcp-adapter/status/v1", deferClear);
	pi.on("session_shutdown", async () => {
		clearStatuses();
		setBusy(false);
		latestUI = undefined;
	});
}
