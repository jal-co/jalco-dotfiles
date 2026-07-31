# Plannotator Todo Bridge

Connects Plannotator plan execution, the local `rpiv-todo` fork, and `pi-goal-x` without depending on a model or provider.

## Workflow

1. For a large implementation task, the agent calls `start_plannotator` as its first action. The same flow is available manually as `/plan-task <task>`.
2. The bridge asks Plannotator to enter planning mode and waits for a confirmed `planning` phase before queuing the task.
3. The agent writes a Markdown plan and calls `plannotator_submit_plan`. Plannotator opens its browser review and implementation remains blocked until approval.
4. After approval, the bridge detects Plannotator's `plannotator-execute` marker, imports the plan checkboxes into `rpiv-todo`, and hides Plannotator's duplicate execution widget. `rpiv-todo` is the single visible checklist.
5. `[DONE:n]` completes the todo linked to plan step `n` and checks only that plan checkbox on disk.
6. `/sisyphus-todos` converts remaining linked todos into an ordered objective and queues the public `/sisyphus-set` command.

## Automatic planning criteria

The `start_plannotator` tool guidance requires immediate planning when an implementation task has any of these traits:

- unclear scope
- multiple reasonable interpretations
- more than about two architectural decisions
- work across unseen files, services, or domains
- undefined completion criteria

The decision is agent-judged. The bridge does not use keyword interception and does not ask for a second confirmation.

## Commands and tool

- `/plan-task <task>`: enter Plannotator and queue the task after phase confirmation.
- `start_plannotator({ task })`: agent-callable equivalent with large-task guidance.
- `/sisyphus-todos`: start Sisyphus from remaining bridge-linked todos in plan order.

## Synchronization ownership

- The approved plan owns plan order, step text, and initial checked state.
- `rpiv-todo` owns the visible execution checklist and branch-persistent task snapshots.
- `[DONE:n]` is the only automatic completion signal. Prose does not complete work.
- Sisyphus owns continuation only. Its generated objective requires the same `[DONE:n]` identities.
- Reconciliation is idempotent by normalized plan path plus step number. Removed plan items are tombstoned; completed tasks are never reopened automatically.
- Completion markers are persisted before synchronization. If the plan file or todo API is temporarily unavailable, the bridge retries the pending completion after reload, compaction, resume, tree navigation, or the next agent turn.
- `/sisyphus-todos` uses only the active plan and rejects mixed-plan objectives so `[DONE:n]` cannot collide across plans.

## Shared event dependencies

- Plannotator: `plannotator:request`, action `plan-mode`, mode `enter`.
- `rpiv-todo`: `rpiv-todo:request`, actions `get` and atomic `mutate`.
- Goal-x: public `/sisyphus-set` command queued as a follow-up.

All unavailable dependencies and request timeouts are surfaced as errors. The bridge does not import private state from Plannotator, `rpiv-todo`, or goal-x.

## Tests

```bash
node ~/.pi/agent/extensions/pi-rfc-keywords/node_modules/typescript/bin/tsc \
  -p ~/.pi/agent/extensions/plannotator-todo-bridge/tsconfig.json
```

The focused runtime tests compile to a temporary directory and run with Node's test runner.
