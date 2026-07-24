/**
 * YOLO Mode Extension
 *
 * /yolo        Toggle yolo mode (skips git-push and destructive-action gates)
 * /yolo on     Enable
 * /yolo off    Disable
 *
 * State resets to off on every new pi process.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isYolo, setYolo } from "./yolo-state";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("yolo", {
		description: "Toggle yolo mode: skip git-push and destructive-action confirmations",
		handler: async (args, ctx) => {
			const arg = (args ?? "").trim().toLowerCase();
			const next = arg === "on" ? true : arg === "off" ? false : !isYolo();
			setYolo(next);
			ctx.ui.notify(
				next
					? "YOLO mode ON: pushes and destructive actions run without confirmation"
					: "YOLO mode OFF: confirmations restored",
				next ? "warning" : "info",
			);
		},
	});
}
