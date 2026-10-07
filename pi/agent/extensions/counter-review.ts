import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ModelRef = { provider: string; id: string };

const isClaude = (model: ModelRef) => model.provider === "anthropic" || /claude/i.test(model.id);
const isGpt = (model: ModelRef) => /^gpt/i.test(model.id);

export function pickReviewer<T extends ModelRef>(author: ModelRef, candidates: readonly T[]): T | undefined {
	const counterFamily = isClaude(author) ? isGpt : isClaude;
	return candidates.find(counterFamily);
}

export function reviewerPrompt(ref: string): string {
	const pr = ref || "for the current branch";
	return `Review the pull request ${pr} in this repository as a second opinion from a different model family than its author.

1. Read it with \`gh pr view ${ref} --json title,body,files\` and \`gh pr diff ${ref}\`.
2. Load the ponytail-review skill and apply it to the whole diff.
3. If the diff touches UI files (tsx, jsx, css, html, vue, svelte), also load the review-ui skill and apply its workflow and rules to those files.

This is read-only. Do not edit files, commit, push, post to GitHub, or ask questions. Skip review-ui's fix-prompt question and posting steps.

Output only numbered findings, one per line, as \`<n>. path:line: problem. proposed fix.\` If nothing holds up, output \`No findings.\``;
}

export function authorPrompt(pr: string, reviewer: string, review: string): string {
	return `${reviewer} reviewed PR ${pr} as a counter model to you, using ponytail-review and review-ui. Validate each finding against the code before acting. Fix the ones that hold up. For each one you reject, give the number and a one-line reason. Then run the repo's relevant checks.

<review>
${review.trim()}
</review>`;
}

export default function counterReview(pi: ExtensionAPI): void {
	pi.registerCommand("review-pr", {
		description: "Review a PR with the opposite model family, then have this model validate and fix the findings",
		handler: async (args, ctx) => {
			const author = ctx.model;
			if (!author) {
				ctx.ui.notify("review-pr: no active model to counter", "error");
				return;
			}
			const candidates = ctx.scopedModels.length > 0 ? ctx.scopedModels.map((scoped) => scoped.model) : ctx.modelRegistry.getAvailable();
			const reviewer = pickReviewer(author, candidates);
			if (!reviewer) {
				ctx.ui.notify(`review-pr: no available counter model for ${author.provider}/${author.id}`, "error");
				return;
			}

			const ref = args.trim();
			const label = ref || "for this branch";
			const reviewerName = `${reviewer.provider}/${reviewer.id}`;
			ctx.ui.setStatus("counter-review", ctx.ui.theme.fg("dim", `reviewing PR ${label} with ${reviewerName}`));
			ctx.ui.notify(`review-pr: ${reviewerName} is reviewing PR ${label}`, "info");

			void pi
				.exec(
					"pi",
					["--print", "--no-session", "--model", reviewerName, "--tools", "read,bash,grep,find,ls", reviewerPrompt(ref)],
					{ cwd: ctx.cwd, timeout: 20 * 60 * 1000 },
				)
				.then((result) => {
					if (result.code !== 0 || !result.stdout.trim()) {
						ctx.ui.notify(`review-pr: ${reviewerName} failed: ${(result.stderr || result.stdout).trim().slice(-500)}`, "error");
						return;
					}
					pi.sendUserMessage(authorPrompt(label, reviewerName, result.stdout), { deliverAs: "followUp" });
				})
				.catch((error: Error) => ctx.ui.notify(`review-pr: ${reviewerName} failed: ${error.message}`, "error"))
				.finally(() => ctx.ui.setStatus("counter-review", undefined));
		},
	});
}
