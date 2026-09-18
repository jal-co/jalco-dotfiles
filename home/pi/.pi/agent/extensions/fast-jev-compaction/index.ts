import { convertToLlm, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { configPath, loadConfig } from "./config.js";
import { compactForPi } from "./core.js";
import { reductionRatio } from "./upstream/compact.js";
import type { CompactResult } from "./upstream/types.js";

function fileLists(fileOps: { read: Set<string>; written: Set<string>; edited: Set<string> }) {
	const modified = new Set([...fileOps.written, ...fileOps.edited]);
	return {
		readFiles: [...fileOps.read].filter(path => !modified.has(path)).sort(),
		modifiedFiles: [...modified].sort(),
	};
}

function outcome(result: CompactResult): string {
	const percent = Math.round(reductionRatio(result) * 100);
	return `${percent}% reduction, ${result.stats.kept} kept, ${result.stats.resultsDropped} results truncated, ${result.stats.callsDropped} calls dropped`;
}

export default function fastJevCompaction(pi: ExtensionAPI): void {
	let sessionEnabled: boolean | undefined;

	pi.on("session_start", (_event, ctx) => {
		const loaded = loadConfig();
		if (loaded.error && ctx.hasUI) ctx.ui.notify(`fast-jev-compaction: ${loaded.error}`, "warning");
		if (ctx.hasUI) ctx.ui.setStatus("fast-jev-compaction", loaded.config.enabled ? "Jev compact" : undefined);
	});

	pi.on("session_before_compact", async (event, ctx) => {
		const loaded = loadConfig();
		if (!(sessionEnabled ?? loaded.config.enabled)) return;
		const apiKey = process.env.TYPESAFE_API_KEY;
		if (!apiKey) {
			if (ctx.hasUI) ctx.ui.notify("fast-jev-compaction: TYPESAFE_API_KEY is missing; using Pi compaction", "warning");
			return;
		}
		try {
			const messages = convertToLlm([
				...event.preparation.messagesToSummarize,
				...event.preparation.turnPrefixMessages,
			]);
			const output = await compactForPi(
				messages,
				event.preparation.previousSummary,
				event.customInstructions,
				loaded.config,
				apiKey,
				event.signal,
			);
			const ratio = reductionRatio(output.result);
			if (!output.summary.trim() || ratio < loaded.config.minReductionRatio) {
				if (loaded.config.notify && ctx.hasUI) {
					ctx.ui.notify(
						`fast-jev-compaction: ${outcome(output.result)}; using Pi compaction`,
						"info",
					);
				}
				return;
			}
			const files = fileLists(event.preparation.fileOps);
			if (loaded.config.notify && ctx.hasUI) {
				ctx.ui.notify(`fast-jev-compaction: ${outcome(output.result)}`, "info");
			}
			return {
				compaction: {
					summary: output.summary,
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
					details: {
						strategy: "fast-jev-compaction",
						stats: output.result.stats,
						decisions: output.result.decisions,
						readFiles: files.readFiles,
						modifiedFiles: files.modifiedFiles,
					},
				},
			};
		} catch (error) {
			if (event.signal.aborted) return { cancel: true };
			if (ctx.hasUI) {
				ctx.ui.notify(
					`fast-jev-compaction: ${error instanceof Error ? error.message : String(error)}; using Pi compaction`,
					"warning",
				);
			}
			return;
		}
	});

	pi.registerCommand("jev-compaction", {
		description: "Show or switch Jev compaction",
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();
			if (value === "on" || value === "off") {
				sessionEnabled = value === "on";
				if (ctx.hasUI) {
					ctx.ui.setStatus("fast-jev-compaction", sessionEnabled ? "Jev compact" : undefined);
					ctx.ui.notify(`Jev compaction is ${sessionEnabled ? "on" : "off"} until reload.`, "info");
				}
				return;
			}
			const loaded = loadConfig();
			const enabled = sessionEnabled ?? loaded.config.enabled;
			const suffix = loaded.error ? ` Config warning: ${loaded.error}` : "";
			const message =
				value && value !== "status"
					? "Usage: /jev-compaction [on|off|status]"
					: `Jev compaction is ${enabled ? "on" : "off"}${sessionEnabled === undefined ? " from config" : " until reload"}. Config: ${configPath}.${suffix}`;
			if (ctx.hasUI) ctx.ui.notify(message, value && value !== "status" ? "warning" : "info");
		},
	});
}
