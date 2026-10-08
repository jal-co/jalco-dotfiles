---
name: t3-dispatch
description: Run the T3 Code main agent that turns Linear tickets and tasks into Pi threads in their own worktrees in the right repository's T3 project, follows up with them, reports status, and cleans up. On the pi-p3 instance it also tracks each task as a tree of threads and runs a cross-model review of every code-ready commit. Use in a Pi thread inside T3 Code (`T3_MCP_URL` is set) that is not bound to a worktree, when Justin gives a Linear issue or task to start, asks to follow up on a task, asks for status ("what's running", "where are we"), or asks to clean up worktrees or threads.
---

<overview>
The main thread is a dispatcher. Each task gets its own T3 thread bound to its own worktree in the right repository's T3 project, running Pi with Justin's full skills and instructions. One dispatcher serves every registered project. The dispatcher keeps only the task list and never edits code, so task context stays in task threads and Justin switches threads instead of juggling context. T3 is the source of truth for what exists; never keep a separate ledger of threads or tasks, because it drifts. The one file the dispatcher keeps is `~/.p3/verdicts.tsv`, because T3 does not store review verdicts.
</overview>

<constraints>

- MUST run only when `T3_MCP_URL` is set and `t3_worktree_status` reports no worktree binding. A thread bound to a worktree is a task agent: it does its own task and MUST NOT dispatch.
- Dispatching a task Justin gave is explicit permission to launch exactly one top-level Pi thread for it with `t3_thread_launch`. MUST NOT do task work through `delegate_task` or `create_threads`: a child task dies with the dispatcher's context, and `create_threads` cannot bind a worktree. The only `delegate_task` use is the read-only review lanes in "p3 review".
- MUST NOT edit, commit, or push in a task worktree. Send the instruction to its thread instead.
- MUST NOT pull issue bodies, diffs, or task transcripts into this thread beyond what a step needs. The task agent reads its own issue.
- Thread list, read, send, and pending-request tools reach every registered project: pass `projectId` to `t3_thread_list`.
- Read thread IDs from T3 responses; never predict them.

</constraints>

<workflow name="dispatch">

## New task

1. Name the task. Linear issue: its identifier (`MAS-123`). Otherwise a short kebab slug from the outcome.
2. Pick the repository: the one Justin named, else the obvious one for the ticket (`MAS-` issues go to `mastra`). If it is still unclear, ask. Find its `id` and `workspaceRoot` with `t3_project_list`. If it is not registered and `~/dev/<repo>` is a Git checkout, register it with `t3_project_create`.
3. Linear issue: fetch it with the Linear MCP tools (through `codemode` when they are not listed directly) for its title and `gitBranchName`. Read nothing else.
4. Branch: the issue's `gitBranchName`, else `<type>/<slug>`. Base: the repository's default branch (`git -C <workspaceRoot> symbolic-ref --short refs/remotes/origin/HEAD`, without `origin/`).
5. Check for an existing task: the branch in `git -C <workspaceRoot> worktree list`, or `t3_thread_list` with the project's `projectId` and `titleContains: <name>`. A match means the task exists: follow up instead of launching.
6. Launch, inheriting model and modes:
   ```json
   {
     "title": "<name>: <short title>",
     "projectId": "<project id>",
     "workspaceStrategy": { "type": "worktree", "baseRef": "<default>", "branch": "<branch>", "startFromOrigin": true },
     "message": "<brief>"
   }
   ```
   `startFromOrigin: true` fetches first so the base is current. Task threads inherit the dispatcher's provider instance; read it with `t3_thread_configuration` before launching, and when it is `pi-p3`, follow "With p3" below. Do not wait for the thread; return to Justin immediately.
7. The brief is three lines at most: the issue identifier and title (or Justin's task text verbatim), "Read the issue in Linear for full context" when one exists, and any constraint Justin stated. The task agent's own AGENTS.md and skills cover everything else, including when to stop for review.
8. Reply with one line: `<name> (<repo>) → <branch>, thread <threadId>`.

## With p3

A task runs with p3 only when it is a big change or a real engineering lift: a new feature across several layers, auth, billing, data model or migrations, security-sensitive paths, or a multi-PR effort. Copy tweaks, small UI fixes, label changes, prototypes, investigations, dashboards, and one-file fixes run on plain Pi, even when the dispatcher runs on `pi-p3`, because review lanes and fix rounds cost more than such changes can hide. When a task looks like it needs p3, ask Justin in one line before launching ("This touches auth across API and frontend; run it with p3?") and launch plain Pi unless he says yes. "with p3" or "without p3" from Justin decides without asking. If `pi-p3` is missing from `orchestrator_capabilities`, tell Justin and launch on plain Pi only if he says so. A task without p3 sets `"instanceId": "pi"` explicitly, because an omitted model selection inherits the dispatcher's instance. Launch quick, mechanical plain-Pi tasks (reverts, one-file fixes, label or copy changes, small CSS tweaks, PR-body edits, rebases, CI checks) on `deepseek/deepseek-flash` (thinking `low`), because Justin wants speed there. Launch other plain-Pi tasks on `cliproxyapi/claude-sonnet-5-5` (thinking `high`); use `cliproxyapi/claude-opus-5-5` for design, taste, or prose-heavy work. Justin finds GPT models too slow for interactive task threads, so use them only as one cross-provider review lane.

A p3 task is a tree: the root task thread, plus child threads titled `<name> › <part>` that the root may launch. Launch the root on the code model from `~/.agents/p3-models.md`: the `bug-fix` line for a defect, else the `feature, refactoring` line, as `"modelSelection": { "instanceId": "pi-p3", "model": "<model>", "options": [{ "id": "thinking", "value": "<level>" }] }`. That file is where Justin sets which models do the work, and the dispatcher's own model only routes tasks. Use this brief, replacing step 7's:

```
$p3-mode <issue identifier and title, or Justin's task text verbatim>
Read the issue in Linear for full context.   (only when there is one)
<any constraint Justin stated>
root
Dispatcher thread: <this thread's id, the currentThreadId from t3_thread_list>
Follow ~/.pi/agent/skills/t3-dispatch/p3-task.md
```

That file tells the root how to launch children and when to report code-ready. Reply with `with p3` after the thread id.

## Follow-up

`t3_thread_send` with `mode: "auto"`, which steers an active turn or starts an idle one. Use `mode: "queue"` when Justin wants it after the current work. If the thread is waiting, read `t3_pending_request_list` for it, report the question, and ask Justin; never answer for him. Approvals cannot be answered from here; tell Justin to open the thread.

</workflow>

<workflow name="p3-review">

Runs when a message starting `p3 code-ready` arrives. Review is the dispatcher's job because the thread that wrote the code cannot judge it independently, and a reviewer on a different model family catches what the builder's family misses.

1. Parse `task`, `thread`, `worktree`, `branch`, `base`, `head`, `gates`. Confirm the commit exists with `git -C <worktree> cat-file -e <head>`. Count earlier rounds for this task in `~/.p3/verdicts.tsv`; this is round N.
   Fast path: when the round's production diff is under about 50 changed lines, or the delta since the last reviewed head is mechanical (a docs revert, test trim, rename, or applied finding), read the diff yourself and send `clean` or findings in the same turn. Record the verdict with reviewers `dispatcher`. Three lanes cost an hour of wall time; a change that size takes minutes to read and rarely hides what lanes catch. Use lanes for larger diffs, auth, billing, data writes, or migrations.
2. Pick reviewers from the `interrogate reviewers` line in `~/.agents/p3-models.md`. Drop the entry that matches the task thread's exact model (read it with `t3_thread_read`), because a model reviewing its own output repeats its own blind spots. Keep every other entry, and keep at least one from a different provider than the builder so one lane catches what that provider's models share. Resolve each entry the way p3-mode's Subagents section does.
3. Launch one `delegate_task` per lane, `mode: "async"`, each on a different reviewer. Lanes: correctness against the task's goal and edge cases; scope and simplicity (unrequested changes, avoidable code); the repository's AGENTS.md rules for the touched paths. Brief:
   ```
   Review commit <head> of <branch> for task <task>: <goal in one line>.
   Read only. Use `git -C <worktree> diff <base>..<head>` and `git -C <worktree> show <head>:<path>`.
   Never write files in <worktree> and never run git commands that change its state; the task thread works there.
   Focus: <lane>.
   Gates the author ran: <gates>.
   Report PASS, or findings. Each finding names file:line, the evidence, and why it is wrong. Report nothing you cannot point to in the diff.
   ```
   End the turn. Completions wake this thread.
4. When every lane has returned, the verdict is `clean` only if all lanes passed. Drop a finding that names no file:line or evidence. Append one row to `~/.p3/verdicts.tsv` (create it with the header `date	task	branch	head	round	verdict	reviewers`): you are its only writer, and a verdict belongs to one head, so a new head always needs a new round.
5. Findings: send the task thread `p3 findings`, `round: N`, `head: <head>`, and the findings verbatim, with `t3_thread_send`. Clean: send `p3 clean`, `head: <head>`, and tell Justin in one line: `<name> clean at <short head>, ready for your review → thread <id>`.
6. After three rounds with findings on the same task, stop sending fix rounds and tell Justin the open findings. Repeated rounds mean the builder and reviewers disagree on something only Justin can settle.
7. Settle a design question with Justin once, before the thread builds. MUST NOT send a changed design to a thread without his pick, and MUST NOT add a preview round after he has approved the direction. Each reversal or extra approval loop costs Justin a round trip on work he already decided.

A `p3 blocked` message: relay the question to Justin in one line with the thread id. Never answer it yourself.

</workflow>

<workflow name="status">

1. For each registered project, list its task worktrees with `git -C <workspaceRoot> worktree list --porcelain`, skipping the main checkout, and read thread status with `t3_thread_list` and its `projectId`. Group a p3 tree's child threads (`<name> › <part>`) under their root, and add the latest `~/.p3/verdicts.tsv` row for each branch.
2. For each task branch: `gh pr list --head <branch> --state all --json number,state,url --limit 1`.
3. Reply with one row per task, waiting first, then failed, working, completed, idle:
   `name | status | branch | verdict | PR #n state`.
   Flag waiting and failed rows; those need Justin.

</workflow>

<workflow name="cleanup">

Walk every worktree of each registered project (`git -C <workspaceRoot> worktree list --porcelain`), skipping the main checkout, with thread status from `t3_thread_list` for that project. A p3 child's worktree follows the same rules. First match wins:

1. Its thread is running or waiting → keep, report.
2. `git -C <path> status --porcelain` is non-empty → keep, report "uncommitted changes".
3. PR is open → keep.
4. PR is merged → remove. The commits live on GitHub, so `git branch -D` is safe here.
5. PR closed unmerged, or commits not on any remote (`git -C <path> log HEAD --not --remotes --oneline` non-empty) → keep, report, ask Justin.
6. No commits beyond `origin/<default>` → remove; `git branch -d` suffices.
7. Anything else (pushed, no PR) → keep, report.

Remove with `git worktree remove <path>`, delete the branch as above, then archive its thread with `t3_thread_organize`. T3 does not remove worktrees when threads close, so skipping this leaves checkouts behind. Never pass `--force`. Finish with `git worktree prune` and one summary: removed, kept with reason.

</workflow>
