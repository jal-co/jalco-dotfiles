import { homedir } from "node:os";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type StatusColor = "accent" | "dim" | "muted" | "text" | "warning";
type Colorize = (color: StatusColor, text: string) => string;

export function formatTokens(count: number): string {
	if (count < 1_000) return `${count}`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatProviderIcon(provider: string, colorize: Colorize): string {
	if (provider.startsWith("openai") || provider.startsWith("chatgpt")) return colorize("accent", "");
	if (provider === "anthropic") return colorize("warning", "");
	return colorize("muted", "");
}

export function getFrameLabels(ctx: ExtensionContext, colorize: Colorize) {
	let cost = 0;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		cost += entry.message.usage.cost.total;
	}
	const usage = ctx.getContextUsage();
	const tokens = usage?.tokens == null ? "?" : formatTokens(usage.tokens);
	const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
	const capacity = contextWindow == null ? "?" : formatTokens(contextWindow);
	const provider = ctx.model ? formatProviderIcon(ctx.model.provider, colorize) : "";
	const thinking = ctx.model?.reasoning ? colorize("dim", ` · ${ctx.thinkingLevel ?? "off"}`) : "";
	return {
		topRight: `${provider} ${colorize("text", ctx.model?.id ?? "no-model")}${thinking}`.trim(),
		bottomLeft: colorize("dim", `${tokens}/${capacity}  $${cost.toFixed(3)}`),
		bottomRight: colorize("dim", ctx.cwd.replace(homedir(), "~")),
	};
}
