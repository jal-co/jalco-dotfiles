import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { evaluateGate } from "./core.js";

export default function shadcnLintGate(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(
			"shadcn-lint-gate",
			`${ctx.ui.theme.fg("success", "")} ${ctx.ui.theme.fg("dim", "shadcn")}`,
		);
	});
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;
		const command = event.input.command;
		const exec = async (file: string, args: string[]) => {
			const result = await pi.exec(file, args, { timeout: 120000 });
			return { stdout: result.stdout, stderr: result.stderr, code: result.code ?? 0 };
		};
		try {
			const reason = await evaluateGate(exec, ctx.cwd, command);
			if (reason) return { block: true, reason };
		} catch (error) {
			ctx.ui.notify(`shadcn lint advisory failed open: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
	});
}
