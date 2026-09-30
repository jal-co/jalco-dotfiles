import { CustomEditor, type ExtensionAPI, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { getSetting, setSetting } from "@juanibiapina/pi-extension-settings";
import { truncateToWidth, visibleWidth, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { getFrameLabels } from "./lib/footer-format.js";

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
	getLabels = () => ({ topRight: "", bottomLeft: "" });
	private labels = { topRight: "", bottomLeft: "" };
	private bottomBorder = "";
	private bottomRow = 0;

	setPaddingX(padding: number): void {
		super.setPaddingX(Math.max(2, padding));
	}

	protected renderTopBorder(width: number, hiddenLineCount: number): string {
		if (width < 5) return super.renderTopBorder(width, hiddenLineCount);
		const label = truncateToWidth(this.labels.topRight, Math.max(0, width - 20), "");
		const right = label ? ` ${label} ${this.borderColor("─")}` : "";
		return this.borderColor("╭") + super.renderTopBorder(width - 2 - visibleWidth(right), hiddenLineCount) + right + this.borderColor("╮");
	}

	protected renderBottomBorder(width: number, hiddenLineCount: number): string {
		if (width < 5) return super.renderBottomBorder(width, hiddenLineCount);
		const label = truncateToWidth(this.labels.bottomLeft, Math.max(0, width - (hiddenLineCount > 0 ? 20 : 7)), "");
		const left = label ? `${this.borderColor("─")} ${label} ` : "";
		this.bottomBorder = this.borderColor("╰") + left + super.renderBottomBorder(width - 2 - visibleWidth(left), hiddenLineCount) + this.borderColor("╯");
		return this.bottomBorder;
	}

	render(width: number): string[] {
		this.labels = this.getLabels();
		const lines = super.render(width);
		if (width < 5) return lines;
		this.bottomRow = lines.indexOf(this.bottomBorder);
		const side = this.borderColor("│");
		for (let row = 1; row < this.bottomRow; row++) lines[row] = side + lines[row].slice(1, -1) + side;
		lines.splice(this.bottomRow, 0, side + " ".repeat(width - 2) + side);
		return lines;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		return super.handleMouse(event.width >= 5 && event.y > this.bottomRow ? { ...event, y: event.y - 1 } : event);
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
		const update = () => {
			const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
			ui.setWorkingMessage(seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`);
		};
		update();
		workingTimer = setInterval(update, 1000);
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

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		stopWorkingTimer();
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = new FramedEditor(tui, theme, keybindings, { paddingX: 2, embedWorkingStatus: true });
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
