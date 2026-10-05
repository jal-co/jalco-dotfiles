# p3 task protocol

<overview>
You are a task thread in a p3 tree. The dispatcher (the main thread named in your brief) launched you, reviews your work, and tracks the tree. You own the task's code; the dispatcher owns review. Follow this file alongside `$p3-mode` and your usual AGENTS.md rules.
</overview>

<constraints>

- MUST use a single-task p3 playbook. MUST NOT run orchestrate, autopilot-full, or autopilot-stack: the dispatcher already coordinates the tree, and a second coordinator duplicates intake and review.
- `delegate_task` helpers are approved for your own task.
- MUST NOT push or open a PR before the dispatcher reports a clean verdict for your current head. Review needs a fixed commit, and Mastra UI work also needs Justin's localhost review before any push.

</constraints>

<workflow name="children">

A root task thread (your brief says `root`) MAY launch child threads with `t3_thread_launch` only when the task splits into separate PRs or needs a second isolated worktree. A thread whose brief says `child` MUST NOT launch threads, which caps the tree at three levels: dispatcher, root, child.

For each child:

- Title: `<task name> › <part>`. The dispatcher finds a tree's threads by the task name prefix, so a child with another title drops out of status and review.
- `workspaceStrategy`: `{ "type": "worktree", "baseRef": "<your branch for a stacked part, else the default branch>", "branch": "<your branch>--<part>", "startFromOrigin": false }`. Commit what the child builds on before launching, because uncommitted changes are not copied.
- `modelSelection`: your own instance and model.
- Brief: `$p3-mode`, then the part's goal and the files it may touch, then `child`, `Dispatcher thread: <dispatcher thread id>`, and `Follow ~/.pi/agent/skills/t3-dispatch/p3-task.md`.

Every thread whose branch becomes its own PR reports code-ready to the dispatcher itself. A child whose work you will merge into your branch reports to you instead, and you report the combined head.

</workflow>

<workflow name="code-ready">

1. Commit the finished unit locally. Run the gates your repository's rules name for the touched paths (lint, typecheck, tests) on that commit.
2. Send the dispatcher one message with `t3_thread_send`, `mode: "queue"`:
   ```
   p3 code-ready
   task: <task name>
   thread: <your thread id>
   worktree: <absolute worktree path>
   branch: <branch>
   base: <base commit sha>
   head: <head commit sha>
   gates: <each command and its result, one per line>
   ```
   `base` is `git merge-base HEAD origin/<default>` for a root, or the parent branch's commit for a stacked child.
3. End the turn. Do not keep editing the branch while review runs, because a new head voids the round.

</workflow>

<workflow name="review-results">

- `p3 findings` round N: fix each finding in new commits, rerun the gates, and report code-ready again with the new head. Reply to a finding you disagree with in your code-ready message with its evidence instead of changing code.
- `p3 clean` at a head: that head is approved. Continue with the hand-off your rules require, such as Justin's localhost review, then push and open the PR. Justin merges.
- A blocking question that only Justin can answer: send `p3 blocked`, `task:`, `thread:`, and the question, then end the turn.

</workflow>
