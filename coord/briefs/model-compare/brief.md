# Add model comparison to Spec

## Request (verbatim)

"in "spec" i'd like to have the ability to compare models. We need to get a model benchmark api. we can use the new kimi model to build it. I wanna be able to compare models and their price etc"

Justin then confirmed the repo is `/Users/justin/dev/mastra-model-cards` and supplied an Artificial Analysis API key, stored as 1Password item `Artificial Analysis` (vault `Agents`, category API_Credential, concealed field `credential`, plus `hostname`). Access with `OP_ACCOUNT=my`. Never print, echo, commit, or paste the credential; load it directly into one process environment.

## Where you work

Existing checkout: `/Users/justin/dev/mastra-model-cards-provider-logos`, branch `feat/model-benchmarks` (already at `origin/main` HEAD `88072df`). Workspace `w38`, pane `w38:p1`. You are the only writer. Do not create another worktree, branch, or checkout. You already run on the Kimi model Justin asked for; do not switch models.

`origin/main` HEAD already contains "feat: add optional model benchmarks to cards and Spec". Extend it; do not redo it.

## Goal

A user can compare models on price and measured quality.

Concretely, deliver both surfaces on one shared data layer:

1. **Spec (the Slack/Mastra agent in `agent/`)**: a comparison capability. Given natural input such as "compare gpt 6.1 sol, kimi k3 and claude opus 5.5", Spec resolves each model through the existing Gateway catalog and answers with a compact comparison of price and benchmark quality, and can render a comparison image using the existing card drawing code. Support Artificial Analysis benchmark data through a server-side tool backed by the API key.
2. **Web tool (`src/app`)**: a compare view in the existing Toolcraft app. Pick 2-4 models from the live catalog and see price, context, modalities and available benchmark scores side by side. Must work with no API key in the browser.

## Non-negotiable constraints

- The Artificial Analysis key stays server-side. It must never reach the Vite client bundle, a static asset, a test fixture, a log, a snapshot, or a commit. If a web surface needs richer data than the keyless catalog provides, add the smallest server-side fetch/cache boundary that actually works with this app's architecture and say plainly what runs where. Do not fake a proxy that only exists in dev.
- Read `docs/model-benchmarks.md` first. It records the current data sources, the no-key OpenRouter path (catalog pricing plus embedded Artificial Analysis indices and Design Arena rankings), and the direct-API terms: server-side only, attribution required, rate limited, and no redistribution claim without confirming rights. Respect it and update it with whatever you learn.
- Missing data is omitted, never zero, and never invented. Identity stays attached to the exact catalog entry: no copying scores between aliases, snapshots, reasoning variants or similarly named models. Report a model with no measured score as unmeasured.
- Prices stay USD per million tokens derived from the catalog's per-token values, labelled so the unit cannot be misread. State which models are BYOK-exempt as the README already does.
- Follow the repo `AGENTS.md` and `docs/toolcraft/*` preflight: read each required document separately in the right phase, do not concatenate, do not continue from truncated output. Use built-in schema controls and the public `@/toolcraft/ui` barrel; do not hand-style standard controls. Later-edit verification is focused, not a full delivery gate.
- Keep the existing single-card editor, export, benchmark toggles and Spec card rendering working. No speculative abstractions, no new dependencies without asking, no comments in code, no dead scaffolding.
- No commit, push, PR, deploy, Linear or Slack mutation. Leave the work uncommitted.

## Data contract you must verify yourself

Call the live API before designing around it. Artificial Analysis v2: `GET https://artificialanalysis.ai/api/v2/data/llms/models` with `x-api-key`. Confirm the real response shape, which evaluation fields exist, the real rate limit you observe or are told in headers, and whether the free tier returns the per-evaluation scores or only headline indices. Do not trust second-hand documentation, including the rate-limit figure already noted in this repo's docs. If the plan you hold lacks a field, degrade honestly to what you do have.

## Suggested approach (decide from the code, not from this list)

- One shared comparison model + formatter used by both the agent tool and the web view, so the two surfaces cannot disagree about a number or a unit.
- Agent tool resolves names via the existing `search-gateway-models`, fetches or reads cached benchmark data server-side, returns structured rows plus a short prose summary, and reuses `render-card`-adjacent drawing code for the image.
- Cache benchmark responses server-side with a stated freshness window; the free tier is small.
- Web compare uses keyless catalog data only.

## Verification

- `npm run typecheck`, `npm test` (docs + integrity + scripts + vitest, includes card and agent tests), and `npm run ai:check`.
- Focused Playwright for the web compare view using the repo's `test:feature`/`test:browser` convention; exercise add/remove models, unit correctness, an unmeasured model, and empty state.
- Agent tool unit tests, including a missing-key path and a model with no benchmark data.
- One real end-to-end check that the key actually works, run server-side, with the secret never printed. Report the observed status and field coverage, not the key.
- Start the app with the repo's own scripts and give Justin the exact localhost URL for review. Do not kill unrelated servers; record what you started so it can be stopped.

## Report

Changed files, what the comparison shows for a concrete example, API findings (fields, limits, attribution requirements), where data is fetched and cached, test and check outcomes, the localhost URL, processes you left running with the stop command, base/head SHAs, commits ahead, dirty/clean state, and anything you could not verify. Write it to `/tmp/model-compare-handoff.md` and keep it short. UI is not done until Justin has looked at it on localhost.
