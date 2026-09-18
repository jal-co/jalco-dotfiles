type StatusColor = "accent" | "dim" | "muted" | "warning";
type Colorize = (color: StatusColor, text: string) => string;

export function formatTokens(count: number): string {
	if (count < 1_000) return `${count}`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatProviderIcon(provider: string, colorize: Colorize): string {
	if (provider.startsWith("openai")) return colorize("accent", "");
	if (provider === "anthropic") return colorize("warning", "");
	return colorize("muted", "");
}
