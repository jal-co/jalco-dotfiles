import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatProviderIcon, formatTokens } from "./lib/footer-format.js";

export default function providerStatus(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWorkingVisible(false);
		ctx.ui.setFooter((_tui, theme, footerData) => {
			return {
				invalidate() {},
				render(width: number): string[] {
					let input = 0;
					let output = 0;
					let cost = 0;
					for (const entry of ctx.sessionManager.getEntries()) {
						if (entry.type !== "message" || entry.message.role !== "assistant") continue;
						input += entry.message.usage.input;
						output += entry.message.usage.output;
						cost += entry.message.usage.cost.total;
					}

					const usage = ctx.getContextUsage();
					const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const contextPercent = usage?.percent === null || usage?.percent === undefined
						? "?"
						: usage.percent.toFixed(1);
					const left = theme.fg(
						"dim",
						[`↑${formatTokens(input)}`, `↓${formatTokens(output)}`, `$${cost.toFixed(3)}`, `${contextPercent}%/${formatTokens(contextWindow)}`].join(" "),
					);
					const provider = ctx.model ? formatProviderIcon(ctx.model.provider, (color, text) => theme.fg(color, text)) : "";
					const thinking = ctx.model?.reasoning ? ` • ${ctx.thinkingLevel ?? "off"}` : "";
					const model = theme.fg("dim", `${ctx.model?.id ?? "no-model"}${thinking}`);
					const right = `${provider} ${model}`.trim();
					const padding = " ".repeat(Math.max(2, width - visibleWidth(left) - visibleWidth(right)));
					const secondLine = truncateToWidth(`${left}${padding}${right}`, width, "");

					const statuses = [...footerData.getExtensionStatuses().entries()]
						.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
						.map(([, value]) => value.replace(/[\r\n\t]/g, " ").trim())
						.filter(Boolean)
						.join(" ");
					const directory = theme.fg("dim", ctx.cwd.replace(homedir(), "~"));
					const statusWidth = Math.max(0, width - visibleWidth(directory) - 2);
					const statusText = truncateToWidth(statuses, statusWidth, "");
					const bottomPadding = " ".repeat(Math.max(0, width - visibleWidth(statusText) - visibleWidth(directory)));
					return [secondLine, `${statusText}${bottomPadding}${directory}`];
				},
			};
		});
	});
}
