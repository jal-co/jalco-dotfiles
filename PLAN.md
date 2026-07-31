# Plannotator Todo and Sisyphus Bridge

## Context

Plannotator currently owns execution state by parsing Markdown checklist items from an approved plan. The installed `rpiv-todo` extension owns a separate branch-persistent task graph, while `pi-goal-x` owns goal/Sisyphus continuation state. The three systems do not share a task API, so plan steps, visible todos, and Sisyphus completion can drift. The bridge should connect them without making the workflow model-dependent, and it should also provide a supported way to enter Plannotator planning mode.

## Approach

Build a global Pi bridge extension that coordinates the three installed extensions through shared events and queued extension commands:

- Register `/plan-task <task>` and an agent-callable `start_plannotator` tool. Both send Plannotator's public `plannotator:request` action `plan-mode` with `mode: "enter"`, then queue the supplied task as the next user message only after Plannotator confirms `phase: "planning"`.
- Add model-facing tool guidance that makes `start_plannotator` the first action when the existing global large-task criteria match: unclear scope, multiple reasonable interpretations, more than about two architectural decisions, unseen cross-system scope, or undefined completion. This is agent-judged rather than keyword-based, and does not add a second confirmation.
- Keep browser review on Plannotator's native path: planning guidance requires `plannotator_submit_plan` when the plan is ready, which opens the browser and blocks implementation pending approval.
- Detect direct Plannotator approval from the persisted `plannotator-execute` session marker, read its `lastSubmittedPath`, and parse the plan's standard Markdown checkboxes using behavior compatible with Plannotator's generated `parseChecklist` helper.
- Add a narrow `rpiv-todo` shared-event API for atomic list/create/update operations. Event mutations use the existing reducer, commit a full snapshot, append a replayable custom entry, and refresh the existing overlay. The bridge never imports todo package internals.
- Mirror each approved checklist item into `rpiv-todo` with stable metadata containing bridge version, normalized plan path, step number, and a deterministic plan-item key. Initial checked items import as completed; repeated approval, reload, or resume reconciles existing linked tasks instead of duplicating them.
- Track `[DONE:n]` markers during Plannotator execution. Reconcile the linked todo to completed and update the corresponding Markdown checkbox atomically. Treat an already completed item as an idempotent success. Do not infer completion from prose.
- Register `/sisyphus-todos`. It queries pending and in-progress bridge-linked todos in plan order, builds a numbered objective with each todo's completion criterion and plan path, then queues `/sisyphus-set <objective>` as a follow-up command. It fails loudly when goal-x is unavailable or no linked work remains.
- Keep Sisyphus and todos aligned through the shared plan-step identity: Plannotator `[DONE:n]` drives todo completion, and the Sisyphus objective explicitly requires the matching todo update before each step is considered done.
- Make `rpiv-todo` the single visible execution checklist. Once a plan is imported, suppress Plannotator's `plannotator-progress` widget while leaving its phase/review state intact; restore normal behavior when no bridge-linked plan is active.
- Preserve state across reload, compaction, and session-tree changes through session entries and branch replay. No model, provider, or agent implementation is hardcoded.

## Files to modify

- `home/pi/.pi/agent/extensions/plannotator-todo-bridge/` (new bridge extension and focused tests)
- `home/pi/.pi/agent/packages/rpiv-todo/index.ts` (register shared-event listener and overlay refresh)
- `home/pi/.pi/agent/packages/rpiv-todo/state/replay.ts` (replay bridge-originated todo snapshots)
- `home/pi/.pi/agent/packages/rpiv-todo/todo-events.ts` (new typed shared-event contract and reducer-backed handler)
- `home/pi/.pi/agent/packages/rpiv-todo/package.json` and `README.md` (test/source inclusion and event API documentation)
- `home/pi/.pi/agent/extensions/package.json` only if the new tests require an existing test runner dependency

## Reuse

- Plannotator's existing public `plan-mode` request in `home/pi/.pi/agent/npm/node_modules/@plannotator/pi-extension/plannotator-events.ts`
- Plannotator's `plannotator-execute` marker and `[DONE:n]` semantics in `home/pi/.pi/agent/npm/node_modules/@plannotator/pi-extension/index.ts`
- Checklist compatibility with `home/pi/.pi/agent/npm/node_modules/@plannotator/pi-extension/generated/checklist.ts`
- Todo's pure `applyTaskMutation`, canonical store, metadata support, and branch replay in `home/pi/.pi/agent/packages/rpiv-todo/state/`
- Pi's shared `pi.events`, `pi.sendUserMessage(..., { deliverAs: "followUp" })`, tool registration, and session lifecycle APIs from the installed extension docs
- Goal-x's existing `/sisyphus-set` direct-start path in `home/pi/.pi/agent/npm/node_modules/pi-goal-x/extensions/goal.ts`; the bridge queues that public command rather than importing goal internals

## Steps

- [ ] Add the typed `rpiv-todo` shared-event contract, reducer-backed mutation handler, replayable snapshot entry, overlay refresh, and replay support.
- [ ] Build the bridge's request helpers, stable metadata/key format, checklist parser, plan-marker discovery, and idempotent reconciliation.
- [ ] Register `/plan-task` and `start_plannotator`, including automatic large-task guidance, confirmed planning-phase handoff, timeout handling, and unavailable-extension errors.
- [ ] Detect newly approved `plannotator-execute` markers, import/reconcile plan checklist items into todos in plan order, and suppress the duplicate Plannotator execution widget so only the native todo overlay is visible.
- [ ] Track `[DONE:n]` markers, complete linked todos, and safely check the matching plan item on disk without changing unrelated Markdown.
- [ ] Register `/sisyphus-todos`, serialize remaining linked tasks into an ordered objective, and queue the public `/sisyphus-set` command without model assumptions.
- [ ] Restore bridge state from session markers and reconcile correctly after reload, compaction, resume, and branch navigation.
- [ ] Add focused unit/integration tests for request timeouts, phase entry, task handoff, approval import, deduplication, checked imports, completion, plan edits, objective generation, missing dependencies, and replay.
- [ ] Document the commands, tool, automatic criteria, event contract, and one-owner synchronization rules, then run tests, type checks, formatting, and diff validation.

## Verification

- Send a large feature request and verify the agent calls `start_plannotator` as its first action without asking separately.
- Run `/plan-task <task>` and call `start_plannotator`; verify each enters planning before delivering the task and fails cleanly if Plannotator does not respond.
- Finish the plan and verify the native `plannotator_submit_plan` flow opens browser review and blocks implementation until approval.
- Approve a plan containing ordered, completed, pending, and indented checkboxes; confirm one linked todo per Plannotator-actionable top-level item, native-compatible numbering, deterministic metadata, no duplicates after repeated reconciliation or reload, and no duplicate Plannotator checklist widget.
- Emit `[DONE:n]`; verify only the matching todo completes and only the matching Markdown checkbox changes.
- Run `/sisyphus-todos`; verify the queued goal preserves plan order, paths, completion criteria, and contains no model-specific instructions.
- Reload, compact, resume, and navigate the session tree; verify todo and bridge state replay from the active branch.
- Verify missing Plannotator, todo, goal-x, missing plan files, malformed requests, and empty linked work all fail loudly without partial mutation.
- Run focused tests, package tests, type checks, formatting, JSON validation, and `git diff --check`.
