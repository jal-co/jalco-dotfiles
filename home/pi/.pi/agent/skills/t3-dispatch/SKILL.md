---
name: t3-dispatch
description: Run the T3 Code main agent that turns Linear tickets and tasks into Pi threads in their own worktrees in the right repository's T3 project, follows up with them, reports status, and cleans up. Use in a Pi thread inside T3 Code (`T3_MCP_URL` is set) that is not bound to a worktree, when Justin gives a Linear issue or task to start, asks to follow up on a task, asks for status ("what's running", "where are we"), or asks to clean up worktrees or threads.
---

<overview>
The main thread is a dispatcher. Each task gets its own T3 thread bound to its own worktree in the right repository's T3 project, running Pi with Justin's full skills and instructions. One dispatcher serves every registered project. The dispatcher keeps only the task list and never edits code, so task context stays in task threads and Justin switches threads instead of juggling context. T3 is the source of truth for what exists; never keep a separate ledger, because it drifts.
</overview>

<constraints>

- MUST run only when `T3_MCP_URL` is set and `t3_worktree_status` reports no worktree binding. A thread bound to a worktree is a task agent: it does its own task and MUST NOT dispatch.
- Dispatching a task Justin gave is explicit permission to launch exactly one top-level Pi thread for it with `t3_thread_launch`. MUST NOT use `delegate_task` or `create_threads`: a child task dies with the dispatcher's context, and `create_threads` cannot bind a worktree.
- MUST NOT edit, commit, or push in a task worktree. Send the instruction to its thread instead.
- MUST NOT pull issue bodies, diffs, or task transcripts into this thread beyond what a step needs. The task agent reads its own issue.
- `t3_thread_launch` with `projectId` can target any registered project, but thread list, read, send, and pending-request tools see only the dispatcher's own project. For another project, use Git and `gh` for existence and status, and tell Justin to follow up in the task thread himself.
- Read thread IDs from T3 responses; never predict them.

</constraints>

<workflow name="dispatch">

## New task

1. Name the task. Linear issue: its identifier (`MAS-123`). Otherwise a short kebab slug from the outcome.
2. Pick the repository: the one Justin named, else the obvious one for the ticket (`MAS-` issues go to `mastra`). If it is still unclear, ask. Find its `id` and `workspaceRoot` with `t3_project_list`. If it is not registered and `~/dev/<repo>` is a Git checkout, register it with `t3_project_create`.
3. Linear issue: fetch it with the Linear MCP tools (through `codemode` when they are not listed directly) for its title and `gitBranchName`. Read nothing else.
4. Branch: the issue's `gitBranchName`, else `<type>/<slug>`. Base: the repository's default branch (`git -C <workspaceRoot> symbolic-ref --short refs/remotes/origin/HEAD`, without `origin/`).
5. Check for an existing task: the branch in `git -C <workspaceRoot> worktree list`, or, for the dispatcher's own project, `t3_thread_list` with `titleContains: <name>`. A match means the task exists: follow up instead of launching.
6. Launch, inheriting model and modes:
   ```json
   {
     "title": "<name>: <short title>",
     "projectId": "<project id>",
     "workspaceStrategy": { "type": "worktree", "baseRef": "<default>", "branch": "<branch>", "startFromOrigin": true },
     "message": "<brief>"
   }
   ```
   `startFromOrigin: true` fetches first so the base is current. Do not wait for the thread; return to Justin immediately.
7. The brief is three lines at most: the issue identifier and title (or Justin's task text verbatim), "Read the issue in Linear for full context" when one exists, and any constraint Justin stated. The task agent's own AGENTS.md and skills cover everything else, including when to stop for review.
8. Reply with one line: `<name> (<repo>) → <branch>, thread <threadId>`.

## Follow-up

Another project's thread: tell Justin to open it in that project. Own project: `t3_thread_send` with `mode: "auto"`, which steers an active turn or starts an idle one. Use `mode: "queue"` when Justin wants it after the current work. If the thread is waiting, read `t3_pending_request_list` for it, report the question, and ask Justin; never answer for him. Approvals cannot be answered from here; tell Justin to open the thread.

</workflow>

<workflow name="status">

1. For each registered project, list its task worktrees with `git -C <workspaceRoot> worktree list --porcelain`, skipping the main checkout. For the dispatcher's own project, also read thread status with `t3_thread_list`; other projects show status `unknown`.
2. For each task branch: `gh pr list --head <branch> --state all --json number,state,url --limit 1`.
3. Reply with one row per task, waiting first, then failed, working, completed, idle:
   `name | status | branch | PR #n state`.
   Flag waiting and failed rows; those need Justin.

</workflow>

<workflow name="cleanup">

Walk every worktree of each registered project (`git -C <workspaceRoot> worktree list --porcelain`), skipping the main checkout. Thread status is visible only for the dispatcher's own project; in other projects, apply only rules 2 and 4 and keep and report everything else, because a running thread with no commits yet looks identical to an abandoned one. First match wins:

1. Its thread is running or waiting → keep, report.
2. `git -C <path> status --porcelain` is non-empty → keep, report "uncommitted changes".
3. PR is open → keep.
4. PR is merged → remove. The commits live on GitHub, so `git branch -D` is safe here.
5. PR closed unmerged, or commits not on any remote (`git -C <path> log HEAD --not --remotes --oneline` non-empty) → keep, report, ask Justin.
6. No commits beyond `origin/<default>` → remove; `git branch -d` suffices.
7. Anything else (pushed, no PR) → keep, report.

Remove with `git worktree remove <path>`, delete the branch as above, then archive its thread with `t3_thread_organize` (own project only; for others, tell Justin which threads to archive). T3 does not remove worktrees when threads close, so skipping this leaves checkouts behind. Never pass `--force`. Finish with `git worktree prune` and one summary: removed, kept with reason.

</workflow>
