import {
	type ExtensionAPI,
	isToolCallEventType,
} from "@earendil-works/pi-coding-agent";

const GIT_COMMAND = /(?:^|[;&|]\s*|\s)git(?:\s|$)/;
const NO_VERIFY = /(?:^|\s)--no-verify(?:\s|$)/;
const NON_INTERACTIVE_ENV =
	"GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true GIT_MERGE_AUTOEDIT=no";

export function interceptGitCommand(command: string):
	| { block: true; reason: string }
	| { command: string }
	| undefined {
	if (!GIT_COMMAND.test(command)) return undefined;
	if (NO_VERIFY.test(command)) {
		return {
			block: true,
			reason: "Git --no-verify is blocked. Fix the hook failure instead of bypassing it.",
		};
	}

	return { command: `${NON_INTERACTIVE_ENV} ${command}` };
}

export default function gitInterceptor(pi: ExtensionAPI): void {
	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return undefined;
		const result = interceptGitCommand(event.input.command);
		if (!result) return undefined;
		if ("block" in result) return result;
		event.input.command = result.command;
		return undefined;
	});
}
