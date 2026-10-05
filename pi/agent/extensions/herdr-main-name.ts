import { execFile } from "node:child_process";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RETRY_DELAYS_MS = [1000, 3000, 10000];

export default function herdrMainName(pi: ExtensionAPI): void {
	const pane = process.env.HERDR_PANE_ID;
	if (process.env.HERDR_ENV !== "1" || !pane) return;

	pi.on("session_start", (_event, ctx) => {
		if (ctx.cwd !== homedir()) return;
		pi.setSessionName("main");
		if (ctx.hasUI) ctx.ui.setTitle("main");
		const attempt = (index: number) => {
			execFile("herdr", ["agent", "rename", pane, "main"], (error) => {
				const delay = RETRY_DELAYS_MS[index];
				if (error && delay !== undefined) setTimeout(() => attempt(index + 1), delay).unref();
			});
		};
		attempt(0);
	});
}
