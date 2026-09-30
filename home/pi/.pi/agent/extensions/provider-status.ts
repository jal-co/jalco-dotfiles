import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export default function providerStatus(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setFooter((_tui, theme, footerData) => {
			return {
				invalidate() {},
				render(width: number): string[] {
					const statuses = [...footerData.getExtensionStatuses().entries()]
						.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
						.map(([, value]) => value.replace(/[\r\n\t]/g, " ").trim())
						.filter(Boolean)
						.join(" ");
					const directory = truncateToWidth(theme.fg("dim", ctx.cwd.replace(homedir(), "~")), width, "…");
					const statusWidth = Math.max(0, width - visibleWidth(directory) - 2);
					const statusText = truncateToWidth(statuses, statusWidth, "");
					const bottomPadding = " ".repeat(Math.max(0, width - visibleWidth(statusText) - visibleWidth(directory)));
					return [`${statusText}${bottomPadding}${directory}`];
				},
			};
		});
	});
}
