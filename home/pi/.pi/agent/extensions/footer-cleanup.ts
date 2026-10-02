import { CustomEditor, type ExtensionAPI, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { getSetting, setSetting } from "@juanibiapina/pi-extension-settings";
import { colorToOkhsl, mixColors, okhslColor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getFrameLabels, getProviderColor } from "./lib/footer-format.js";

const HIDDEN_STATUS_KEYS = new Set([
	"pi-agentation",
	"codex-micro",
	"mcp",
	"mcp-auth",
	"provider-model",
	"skills-perms",
	"time-tracker",
]);

const wrappedContexts = new WeakSet<object>();
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class FramedEditor extends CustomEditor {
	getLabels = () => ({ topRight: "", bottomLeft: "", bottomRight: "" });
	frameColor = this.borderColor;
	private labels = { topRight: "", bottomLeft: "", bottomRight: "" };
	private bottomBorder = "";

	setPaddingX(padding: number): void {
		super.setPaddingX(Math.max(3, padding));
	}

	protected renderTopBorder(width: number, hiddenLineCount: number): string {
		if (width < 5) return super.renderTopBorder(width, hiddenLineCount);
		const label = truncateToWidth(this.labels.topRight, Math.max(0, width - 20), "");
		const right = label ? ` ${label} ${this.borderColor("─")}` : "";
		return this.borderColor("╭") + super.renderTopBorder(width - 2 - visibleWidth(right), hiddenLineCount) + right + this.borderColor("╮");
	}

	protected renderBottomBorder(width: number, hiddenLineCount: number): string {
		if (width < 5) return super.renderBottomBorder(width, hiddenLineCount);
		const directory = truncateToWidth(this.labels.bottomRight, Math.max(0, Math.min(Math.floor(width / 3), width - 5)), "…");
		const right = directory ? ` ${directory} ${this.borderColor("─")}` : "";
		const label = truncateToWidth(this.labels.bottomLeft, Math.max(0, width - visibleWidth(right) - (hiddenLineCount > 0 ? 20 : 7)), "…");
		const left = label ? `${this.borderColor("─")} ${label} ` : "";
		this.bottomBorder = this.borderColor("╰") + left + super.renderBottomBorder(width - 2 - visibleWidth(left) - visibleWidth(right), hiddenLineCount) + right + this.borderColor("╯");
		return this.bottomBorder;
	}

	render(width: number): string[] {
		this.borderColor = this.frameColor;
		this.labels = this.getLabels();
		const lines = super.render(width);
		if (width < 5) return lines;
		const bottom = lines.indexOf(this.bottomBorder);
		const side = this.borderColor("│");
		for (let row = 1; row < bottom; row++) lines[row] = side + lines[row].slice(1, -1) + side;
		return lines;
	}
}

type StatusColor = "accent" | "dim" | "error" | "muted" | "success" | "warning";
type Colorize = (color: StatusColor, text: string) => string;
export type BusyIndicatorMode = "default" | "dot" | "none" | "pulse" | "spinner";

export function loadBusyIndicatorMode(agentDir?: string): BusyIndicatorMode {
	const value = getSetting("footer-cleanup", "busyIndicator", "default", { scope: "global", agentDir });
	return value === "dot" || value === "none" || value === "pulse" || value === "spinner" ? value : "default";
}

export function saveBusyIndicatorMode(mode: BusyIndicatorMode, agentDir?: string): void {
	setSetting("footer-cleanup", "busyIndicator", mode, { scope: "global", agentDir });
}

const SHIMMER_HUES = { ocean: 235, matrix: 145, ember: 35, sakura: 350, grape: 300 } as const;
export const SHIMMER_COLORS = ["mono", "provider", "rainbow", "sunset", ...Object.keys(SHIMMER_HUES) as (keyof typeof SHIMMER_HUES)[]] as const;
export type ShimmerColor = (typeof SHIMMER_COLORS)[number];

export function loadShimmerColor(agentDir?: string): ShimmerColor {
	const value = getSetting("footer-cleanup", "shimmerColor", "mono", { scope: "global", agentDir });
	return SHIMMER_COLORS.find((color) => color === value) ?? "mono";
}

export function saveShimmerColor(color: ShimmerColor, agentDir?: string): void {
	setSetting("footer-cleanup", "shimmerColor", color, { scope: "global", agentDir });
}

export function getBusyIndicator(mode: BusyIndicatorMode, colorize: Colorize) {
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

export function formatWorkingMessage(
	elapsedMs: number,
	theme: ExtensionUIContext["theme"],
	animate: boolean,
	shimmer: ShimmerColor = "mono",
	provider?: string,
): string {
	const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
	const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	const label = "Working...";
	const time = animate ? Math.max(0, elapsedMs) : 0;
	const position = animate ? ((time % 2400) / 2400) * (label.length + 6) - 3 : -10;
	const { muted, text } = theme.colors;
	const hues: Partial<Record<ShimmerColor, number>> = SHIMMER_HUES;
	const tint = shimmer === "provider" ? colorToOkhsl(getProviderColor(provider, theme.colors)) : { h: hues[shimmer] ?? 0, s: 0.8 };
	const ramp = (hue: number, saturation: number, intensity: number) => okhslColor(hue, saturation, 0.45 + 0.45 * intensity);
	const working = animate || shimmer !== "mono"
		? [...label].map((character, index) => {
			const intensity = Math.max(0, 1 - Math.abs(index - position) / 2);
			const fg = shimmer === "mono"
				? mixColors(muted, text, intensity)
				: shimmer === "rainbow"
					? ramp((index * 36 + time * 0.15) % 360, 0.8, 0.4 + 0.6 * intensity)
					: shimmer === "sunset"
						? ramp((340 + index * 8) % 360, 0.85, intensity)
						: ramp(tint.h, tint.s, intensity);
			return theme.style(character, { fg });
		}).join("")
		: theme.fg("muted", label);
	return `${working} ${theme.fg("dim", elapsed)}`;
}

export function completeOptions(options: readonly string[], current: string, prefix: string) {
	const matches = options.filter((option) => option.startsWith(prefix.trim().toLowerCase()));
	return matches.length ? matches.map((value) => ({ value, label: value, description: value === current ? "current" : undefined })) : null;
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
	let mode = loadBusyIndicatorMode();
	let shimmer = loadShimmerColor();
	let provider: string | undefined;
	let workingTimer: ReturnType<typeof setInterval> | undefined;

	function stopWorkingTimer(): void {
		if (workingTimer) clearInterval(workingTimer);
		workingTimer = undefined;
		latestUI?.setWorkingMessage();
	}

	function startWorkingTimer(): void {
		if (!latestUI || workingTimer) return;
		const ui = latestUI;
		const startedAt = Date.now();
		let previousMessage: string | undefined;
		const update = () => {
			const message = formatWorkingMessage(Date.now() - startedAt, ui.theme, mode === "spinner" || mode === "pulse", shimmer, provider);
			if (message === previousMessage) return;
			previousMessage = message;
			ui.setWorkingMessage(message);
		};
		update();
		workingTimer = setInterval(update, 80);
		workingTimer.unref();
	}

	function clearStatuses(): void {
		if (!latestUI) return;
		for (const key of HIDDEN_STATUS_KEYS) latestUI.setStatus(key, undefined);
	}

	function deferClear(): void {
		setTimeout(clearStatuses, 0);
	}

	function applyWorkingIndicator(ui: ExtensionUIContext): void {
		ui.setWorkingIndicator(getBusyIndicator(mode, (color, text) => ui.theme.fg(color, text)));
	}

	pi.registerCommand("footer-indicator", {
		description: "Set the working indicator: dot, pulse, none, spinner, or reset.",
		getArgumentCompletions: (prefix) => completeOptions(["dot", "pulse", "spinner", "none", "reset"], mode, prefix),
		handler: async (args, ctx) => {
			const nextMode = args.trim().toLowerCase();
			if (!nextMode) {
				ctx.ui.notify(`Working indicator: ${mode}`, "info");
				return;
			}
			let next: BusyIndicatorMode;
			if (nextMode === "reset") next = "default";
			else if (nextMode === "dot" || nextMode === "none" || nextMode === "pulse" || nextMode === "spinner") {
				next = nextMode;
			} else {
				ctx.ui.notify("Usage: /footer-indicator [dot|pulse|none|spinner|reset]", "error");
				return;
			}
			try {
				saveBusyIndicatorMode(next);
			} catch (error) {
				ctx.ui.notify(`Could not save working indicator: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}
			mode = next;
			applyWorkingIndicator(ctx.ui);
			ctx.ui.notify(`Working indicator saved: ${mode}`, "info");
		},
	});

	pi.registerCommand("footer-shimmer", {
		description: `Set the Working... shimmer color: ${SHIMMER_COLORS.join(", ")}. No argument cycles.`,
		getArgumentCompletions: (prefix) => completeOptions(SHIMMER_COLORS, shimmer, prefix),
		handler: async (args, ctx) => {
			const requested = args.trim().toLowerCase();
			const next = requested
				? SHIMMER_COLORS.find((color) => color === requested)
				: SHIMMER_COLORS[(SHIMMER_COLORS.indexOf(shimmer) + 1) % SHIMMER_COLORS.length];
			if (!next) {
				ctx.ui.notify(`Usage: /footer-shimmer [${SHIMMER_COLORS.join("|")}]`, "error");
				return;
			}
			try {
				saveShimmerColor(next);
			} catch (error) {
				ctx.ui.notify(`Could not save shimmer color: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}
			shimmer = next;
			ctx.ui.notify(`Shimmer color saved: ${shimmer}`, "info");
		},
	});

	pi.on("model_select", (event) => {
		provider = event.model.provider;
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		provider = ctx.model?.provider;
		shimmer = loadShimmerColor();
		stopWorkingTimer();
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = new FramedEditor(tui, theme, keybindings, { paddingX: 3, embedWorkingStatus: true });
			editor.frameColor = (text) => ctx.ui.theme.fg("border", text);
			editor.getLabels = () => getFrameLabels(ctx, (color, text) => ctx.ui.theme.fg(color, text));
			return editor;
		});
		mode = loadBusyIndicatorMode();
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
		applyWorkingIndicator(ctx.ui);
		setTimeout(clearStatuses, 250);
	});

	pi.on("agent_start", () => {
		startWorkingTimer();
		deferClear();
	});
	pi.on("tool_execution_end", deferClear);
	pi.on("agent_settled", () => {
		stopWorkingTimer();
		deferClear();
	});
	pi.on("session_shutdown", async () => {
		stopWorkingTimer();
		clearStatuses();
		latestUI = undefined;
	});
}
