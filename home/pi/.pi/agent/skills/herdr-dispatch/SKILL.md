---
name: herdr-dispatch
description: Run the Herdr main agent that turns tasks into worktree sessions, follows up with them, reports status, and cleans up. Use in a Pi session inside Herdr whose cwd is $HOME, when Justin gives a Linear issue or task, asks to follow up on a task, asks for status ("what's running", "where are we"), or asks to clean up worktrees or sessions.
---

<overview>
The main agent is a dispatcher. Each task gets its own Git worktree, Herdr workspace, and Pi session named after the task. The main agent keeps only the task list and never edits code, so task context stays in task sessions and Justin switches workspaces instead of juggling context. Herdr is the source of truth for what exists; never keep a separate ledger, because it drifts.
</overview>

<constraints>

- MUST run only when `HERDR_ENV=1` and the session cwd is `$HOME`. A session inside a repository is a task agent: it does its own task and MUST NOT dispatch. Outside Herdr, say so and stop.
- Dispatching a task Justin gave is explicit permission to start exactly one Pi agent for it. It is not permission to delegate anything else.
- MUST NOT edit, commit, or push in a task worktree. Send the instruction to its agent instead.
- MUST NOT pull issue bodies, diffs, or agent transcripts into this session beyond what a step needs. The task agent reads its own issue.
- Read IDs from Herdr's JSON responses; never predict them.

</constraints>

<workflow name="dispatch">

## New task

1. Name the task. Linear issue: lowercase identifier (`mas-123`). Otherwise a short kebab slug from the outcome. Agent names MUST match `[a-z][a-z0-9_-]{0,31}`.
2. The name `main` is reserved for this session. If `herdr agent get <name>` succeeds, the task exists: follow up instead of creating.
3. Resolve the repository under `~/dev/<repo>` from the issue's team, project, or text. Ask Justin when two repositories fit. For a Mastra repository, the task agent loads `mastra-work`; the dispatcher does not.
4. Branch: the Linear issue's `gitBranchName`, else `<type>/<slug>`. Fetch first so the base is current:
   ```bash
   git -C ~/dev/<repo> fetch origin
   herdr worktree create --cwd ~/dev/<repo> --branch <branch> --base origin/<default> --label <name> --no-focus
   ```
5. Start Pi in the returned root pane, then send the brief:
   ```bash
   herdr agent start <name> --kind pi --pane <result.root_pane.pane_id>
   herdr agent prompt <name> "<brief>"
   ```
   Do not pass `--wait`; the dispatcher returns to Justin immediately.
6. The brief is three lines at most: the issue identifier and title (or Justin's task text verbatim), "Read the issue in Linear for full context" when one exists, and any constraint Justin stated. The task agent's own AGENTS.md and skills cover everything else.
7. Reply with one line: `<name> → <repo>@<branch>, workspace <id>`.

## Follow-up

`herdr agent prompt <name> "<message>"`. If the agent is `blocked`, report what it is waiting on (`herdr agent read <name>`, last screen only) and ask Justin; never answer an approval for him. If the agent exited but the worktree remains, start a new Pi in that workspace's pane with `herdr agent start` and include "Resume: run `git log origin/<default>..` and `git status` first" in the brief.

</workflow>

<workflow name="status">

1. `herdr agent list` and, for each repository with Herdr worktrees, `herdr worktree list --cwd ~/dev/<repo>`.
2. For each task branch: `gh pr list --repo <owner/repo> --head <branch> --state all --json number,state,url --limit 1`.
3. Reply with one row per task, blocked first, then working, done, idle:
   `name | state | repo@branch | PR #n state`.
   Flag `blocked` and `done` (unseen) rows; those need Justin.

</workflow>

<workflow name="cleanup">

Walk every worktree of each repository in `~/dev` (`git -C <repo> worktree list --porcelain`), skipping the main checkout. First match wins:

1. Its agent is `working` or `blocked` → keep, report.
2. `git -C <path> status --porcelain` is non-empty → keep, report "uncommitted changes".
3. PR is open → keep.
4. PR is merged → remove. The commits live on GitHub, so `git branch -D` is safe here.
5. PR closed unmerged, or commits not on any remote (`git -C <path> log HEAD --not --remotes --oneline` non-empty) → keep, report, ask Justin.
6. No commits beyond `origin/<default>` → remove; `git branch -d` suffices.
7. Anything else (pushed, no PR) → keep, report.

Remove with `herdr worktree remove --workspace <id>` when Herdr owns the worktree (it closes the workspace and its panes), else `git -C <repo> worktree remove <path>`. Then delete the branch as above. Never pass `--force`. Finish with `git -C <repo> worktree prune` and one summary: removed, kept with reason.

</workflow>
