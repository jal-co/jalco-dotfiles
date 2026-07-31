import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function continuationPrompt(summary: string): string {
	return `Compaction completed. Continue the existing task without waiting for another user prompt.

Compaction summary:
${summary}

Recover only from bounded, current sources:
1. Call get_goal when a goal is active.
2. List current todos and continue the single in-progress item, or the first unblocked pending item.
3. If the summary names an approved Plannotator plan, read only that plan file.
4. Use a concise git status and focused diffs to confirm worktree state.
5. Treat the worktree as authoritative for files and this summary as authoritative for prior intent.

MUST NOT read or search the full session JSONL. Do not recap if executable work remains. Immediately perform the next unfinished step. Ask only when a material decision or human action is required.`;
}

export default function continueAfterCompaction(pi: ExtensionAPI): void {
	const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

	pi.on("session_compact", (event) => {
		if (event.willRetry) return;
		const summary = event.compactionEntry.summary?.trim() || "No compaction summary was saved.";
		const timer = setTimeout(() => {
			pendingTimers.delete(timer);
			pi.sendUserMessage(continuationPrompt(summary), { deliverAs: "followUp" });
		}, 0);
		pendingTimers.add(timer);
	});

	pi.on("session_shutdown", () => {
		for (const timer of pendingTimers) clearTimeout(timer);
		pendingTimers.clear();
	});
}
