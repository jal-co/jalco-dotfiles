import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WORKING_MESSAGES = [
	"Following the thread",
	"Checking the sharp edges",
	"Making the smallest useful change",
	"Untangling the state",
	"Looking for the boring fix",
	"Keeping the diff honest",
	"Testing the assumption",
	"Closing the loop",
] as const;

export default function whimsical(pi: ExtensionAPI): void {
	pi.on("turn_start", async (_event, ctx) => {
		const index = Math.floor(Math.random() * WORKING_MESSAGES.length);
		ctx.ui.setWorkingMessage(WORKING_MESSAGES[index]);
	});

	pi.on("turn_end", async (_event, ctx) => {
		ctx.ui.setWorkingMessage();
	});
}
