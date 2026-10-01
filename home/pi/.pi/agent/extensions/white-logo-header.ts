import { type ExtensionAPI, keyHint, keyText, rawKeyHint, VERSION } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader((_tui, theme) => ({
			render: () => {
				const hints = [
					keyHint("app.interrupt", "interrupt"),
					rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
					rawKeyHint("/", "commands"),
					rawKeyHint("!", "bash"),
				].join(theme.fg("muted", " · "));
				return [` █▀█  ${theme.fg("dim", `v${VERSION}`)}`, ` █▀ █ ${hints}`];
			},
			invalidate() {},
		}));
	});
}
