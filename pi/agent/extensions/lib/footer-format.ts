import { homedir } from "node:os";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { rgbColor, type Color } from "@earendil-works/pi-tui";

type StatusColor = "accent" | "dim" | "muted" | "text" | "warning";
type Colorize = (color: StatusColor, text: string) => string;

export function formatTokens(count: number): string {
	if (count < 1_000) return `${count}`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

export function getProviderColor(rawProvider: string | undefined, colors: { accent: Color; text: Color }, modelId?: string): Color {
	const provider = rawProvider ? resolveVendor(rawProvider, modelId) : rawProvider;
	if (provider?.startsWith("openai") || provider?.startsWith("chatgpt")) return colors.accent;
	if (provider === "anthropic") return rgbColor(217, 119, 87);
	return colors.text;
}

function resolveVendor(provider: string, modelId?: string): string {
	if (provider !== "cliproxyapi" || !modelId) return provider;
	if (modelId.startsWith("claude")) return "anthropic";
	if (modelId.startsWith("gpt")) return "openai";
	return provider;
}

export function formatProviderIcon(rawProvider: string, colorize: Colorize, modelId?: string): string {
	const provider = resolveVendor(rawProvider, modelId);
	if (provider.startsWith("openai") || provider.startsWith("chatgpt")) return colorize("accent", "");
	if (provider === "anthropic") return "\x1b[38;2;217;119;87m\x1b[39m";
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
	const provider = ctx.model ? formatProviderIcon(ctx.model.provider, colorize, ctx.model.id) : "";
	const thinking = ctx.model?.reasoning ? colorize("dim", ` · ${ctx.thinkingLevel ?? "off"}`) : "";
	return {
		topRight: `${provider} ${colorize("text", ctx.model?.id ?? "no-model")}${thinking}`.trim(),
		bottomLeft: colorize("dim", `${tokens}/${capacity}  $${cost.toFixed(3)}`),
		bottomRight: colorize("dim", ctx.cwd.replace(homedir(), "~")),
	};
}
