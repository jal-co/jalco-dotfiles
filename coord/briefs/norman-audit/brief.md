# Mine past Norman reviews for rules

## Goal

Find where `norman-reviewer[bot]` was wrong or unhelpful on past pull requests, then turn the recurring ones into rules in this repo (the review skill, or a dedicated Norman section), with quoted evidence. Justin's words: "scan back through pr's and see where it got things wrong and have it build a skill or system prompt."

## What Norman is

Norman is the UI review persona whose behavior lives in `skills/review-ui/SKILL.md`, which was just hardened with three rules: prove comparative claims, treat recorded decisions as settled, and keep a written decline closed. Your job is to find the evidence behind rules like those, and any rules still missing. `skills/mastra-work/SKILL.md` explains how UI findings (Norman) and codebase findings (jalco-reviewer) are split, and `skills/gh-review/SKILL.md` in the dotfiles repo owns the posting mechanics.

## Scope

Read-only across other repositories. Repositories to scan: `mastra-ai/platform` and `mastra-ai/mastra`. Window: the last 120 days, newest first, capped at 250 pull requests per repository so the scan finishes.

For each pull request that Norman reviewed, collect:

- each inline comment Norman wrote: `path`, `line`, `body`, `created_at`, and its comment id, so a URL can be built
- the replies in that thread, and who wrote them, so a decline can be attributed to the author
- whether the line Norman flagged still exists at head, changed later, or was never touched
- whether the thread was resolved, and what the eventual merge looked like
- any language in the PR body, a linked Linear issue, or Justin's own comments that shows the flagged behavior was already decided

Never post a comment, review, reaction, or label anywhere. Never modify another repository. No Linear writes.

## Classification

Every finding gets exactly one class, and only when you can quote the evidence for it:

- **`false`**: the claim is contradicted by the code, the installed package, or the diff itself. A compared pair that turns out to be two different fields is this class.
- **`settled`**: the flagged thing was already a decision recorded in the PR, its issue, or an earlier comment from someone with authority.
- **`style`**: a preference with no contract or rendered failure behind it.
- **`real-fixed`**: a genuine finding the author acted on.
- **`real-open`**: a genuine finding nobody addressed, including one that shipped.
- **`unknown`**: not enough evidence. Count it, do not build a rule from it.

A rule needs at least two independent examples, or one example that is unambiguous and costly. One-offs stay in the report as observations.

## Deliverables

1. `scripts/norman-audit.mjs`: re-runnable, takes the repository and window as flags, caches HTTP responses under `.toolcraft`-style scratch or `/tmp`, and writes machine-readable results. Anybody must be able to re-run it and get the same counts. It must not require a token beyond the `gh` CLI the machine already has.
2. `docs/norman/review-audit.md`: the counts per repository and class, the top recurring mistakes ranked by frequency, and a short table of representative links, one line each, quoting Norman's claim and the evidence that refutes or settles it.
3. Proposed edits, applied, to `skills/review-ui/SKILL.md` or a new `skills/norman-review/SKILL.md` if the material is big enough to deserve its own file. Each added rule cites the examples that earned it, in the report, not inside the skill. Keep the skill terse: no rule that the current file already covers, no rule without evidence, no rule that restates a contract from another skill. Delete or rewrite any existing line the evidence proves wrong.

## Constraints

- Match the existing skills' voice: terse, imperative, paired with its why, no bullet-list padding, no headings that only exist for symmetry.
- No em dashes anywhere you write. No AI attribution.
- Do not add comments to code, and do not add dependencies.
- Leave everything uncommitted. Justin reviews and commits.

## Verification

- Re-run the script and confirm the report's counts match.
- Every quoted comment URL must resolve: check each with `gh api` and report any that don't.
- State plainly how many pull requests you actually covered, out of how many existed in the window, so the sample size is honest.

## Report

Write `/tmp/norman-audit-handoff.md`: counts per class, the recurring mistakes with example links, the rules you added or removed and why, what the sample size was, what you could not determine, and any rule you wanted to add but could not evidence. Keep it under a page.
