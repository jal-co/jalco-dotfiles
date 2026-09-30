import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function hideFooter(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter(() => ({
			invalidate() {},
			render: () => [],
		}));
	});
}
