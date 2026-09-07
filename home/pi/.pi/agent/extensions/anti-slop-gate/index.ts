import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { evaluateGate } from "./core.js";

export default function antiSlopGate(pi: ExtensionAPI): void {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;
		const command = (event.input as { command?: unknown }).command;
		if (typeof command !== "string") return;
		const exec = async (file: string, args: string[]) => {
			const result = await pi.exec(file, args, { timeout: 120000 });
			return { stdout: result.stdout, stderr: result.stderr, code: result.code ?? 0 };
		};
		try {
			const reason = await evaluateGate(exec, ctx.cwd, command);
			if (reason) return { block: true, reason };
		} catch (error) {
			ctx.ui.notify(`anti-slop gate failed open: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
	});
}
