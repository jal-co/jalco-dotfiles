/**
 * Impeccable command router
 *
 * Makes the `impeccable` skill easier to invoke from Pi slash commands.
 *
 * Examples:
 *   /impeccable craft pricing page
 *   /impeccable critique @src/app/page.tsx
 *   /imp polish dashboard empty state
 *   /imp-craft onboarding flow
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

type ImpeccableCommand = {
	name: string;
	category: "Build" | "Evaluate" | "Refine" | "Enhance" | "Fix" | "Iterate" | "Manage";
	description: string;
};

const COMMANDS: ImpeccableCommand[] = [
	{ name: "craft", category: "Build", description: "Shape, then build a feature end-to-end" },
	{ name: "shape", category: "Build", description: "Plan UX/UI before writing code" },
	{ name: "teach", category: "Build", description: "Set up PRODUCT.md and DESIGN.md context" },
	{ name: "document", category: "Build", description: "Generate DESIGN.md from existing project code" },
	{ name: "extract", category: "Build", description: "Pull reusable tokens and components into a design system" },
	{ name: "critique", category: "Evaluate", description: "UX design review with heuristic scoring" },
	{ name: "audit", category: "Evaluate", description: "Technical quality checks: a11y, perf, responsive" },
	{ name: "polish", category: "Refine", description: "Final quality pass before shipping" },
	{ name: "bolder", category: "Refine", description: "Amplify safe or bland designs" },
	{ name: "quieter", category: "Refine", description: "Tone down aggressive or overstimulating designs" },
	{ name: "distill", category: "Refine", description: "Strip to essence, remove complexity" },
	{ name: "harden", category: "Refine", description: "Production-ready: errors, i18n, edge cases" },
	{ name: "onboard", category: "Refine", description: "Design first-run flows, empty states, activation" },
	{ name: "animate", category: "Enhance", description: "Add purposeful animations and motion" },
	{ name: "colorize", category: "Enhance", description: "Add strategic color to monochromatic UIs" },
	{ name: "typeset", category: "Enhance", description: "Improve typography hierarchy and fonts" },
	{ name: "layout", category: "Enhance", description: "Fix spacing, rhythm, and visual hierarchy" },
	{ name: "delight", category: "Enhance", description: "Add personality and memorable touches" },
	{ name: "overdrive", category: "Enhance", description: "Push past conventional limits" },
	{ name: "clarify", category: "Fix", description: "Improve UX copy, labels, and error messages" },
	{ name: "adapt", category: "Fix", description: "Adapt for different devices and screen sizes" },
	{ name: "optimize", category: "Fix", description: "Diagnose and fix UI performance" },
	{ name: "live", category: "Iterate", description: "Visual variant mode in the browser" },
	{ name: "pin", category: "Manage", description: "Create a standalone impeccable shortcut" },
	{ name: "unpin", category: "Manage", description: "Remove a standalone impeccable shortcut" },
];

const COMMAND_NAMES = new Set(COMMANDS.map((command) => command.name));
const ALIASES = new Map<string, string>([
	["review", "critique"],
	["a11y", "audit"],
	["accessibility", "audit"],
	["perf", "optimize"],
	["responsive", "adapt"],
	["copy", "clarify"],
	["typography", "typeset"],
	["motion", "animate"],
]);

function normalizeArgs(args: string): string {
	let text = args.trim();

	// Let pasted command forms work inside `/impeccable ...`.
	text = text.replace(/^\/?(?:skill:)?impeccable\b\s*/i, "");
	text = text.replace(/^\$impeccable\b\s*/i, "");
	text = text.replace(/^--\s*/, "");

	const [first = "", ...rest] = text.split(/\s+/);
	const lowered = first.toLowerCase();
	const canonical = ALIASES.get(lowered) ?? lowered;

	if (!canonical) return "";
	if (!COMMAND_NAMES.has(canonical)) return text;

	return [canonical, ...rest].join(" ").trim();
}

function skillPrompt(args: string): string {
	const normalized = normalizeArgs(args);
	if (!normalized) return "/skill:impeccable";

	const [first = ""] = normalized.split(/\s+/, 1);
	if (first === "live") {
		return `/skill:impeccable ${normalized}

Pi extension note for live mode: start the live helper, then keep the live-poll.mjs loop connected with the default long timeout. Do not use a short timeout. After every generate, accept, discard, prefetch, timeout, or reply, immediately run live-poll.mjs again until exit.`;
	}

	return `/skill:impeccable ${normalized}`;
}

function completions(prefix: string): AutocompleteItem[] | null {
	const [first = ""] = prefix.trimStart().split(/\s+/, 1);
	if (prefix.trimStart().includes(" ")) return null;

	const items = COMMANDS
		.filter((command) => command.name.startsWith(first.toLowerCase()))
		.map((command) => ({
			value: command.name,
			label: command.name,
			description: `${command.category}: ${command.description}`,
		}));

	return items.length > 0 ? items : null;
}

export default function impeccableCommands(pi: ExtensionAPI) {
	const run = async (args: string) => {
		pi.sendUserMessage(skillPrompt(args));
	};

	pi.registerCommand("impeccable", {
		description: "Route arguments to the impeccable skill, e.g. /impeccable craft <target>",
		getArgumentCompletions: completions,
		handler: async (args) => run(args),
	});

	pi.registerCommand("imp", {
		description: "Short alias for /impeccable",
		getArgumentCompletions: completions,
		handler: async (args) => run(args),
	});

	for (const command of COMMANDS.filter((command) => command.category !== "Manage")) {
		pi.registerCommand(`imp-${command.name}`, {
			description: `Impeccable ${command.name}: ${command.description}`,
			handler: async (args) => run(`${command.name} ${args}`),
		});
	}
}
