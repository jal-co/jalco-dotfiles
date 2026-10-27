# Worktree ownership

<workflow>

## Where work happens

The pinned coordinator (`pinned`, rules in `~/rex-coord/AGENTS.md`) creates one worktree and persistent Pi session per task in Rex. It dispatches with `subagent` and a `worktree` argument, which puts the checkout under `~/.rex/worktrees` and retains its dedicated Rex session so Justin can work in it. The fallback `pinned-herdr` follows `~/coord/AGENTS.md` and retains checkouts under `~/.herdr/worktrees`. A task session works only in its own worktree and MUST NOT create, switch, or remove worktrees of its own repository; a second task goes back to the coordinator, because one session per task is what keeps context separate. Exception: when the same task needs changes in another repository (for example a playground-ui change in `mastra` for a `platform` task), the session MAY create one companion worktree there with `git fetch origin && git worktree add -b <task-branch> <task-root>/<repo>/<task-branch> origin/<default>`, reusing an existing one for the same branch first, and work in it with absolute paths. Use `~/.rex/worktrees` as the task root in Rex or `~/.herdr/worktrees` in Herdr. Companion checkouts created directly with Git are not registered with the managed cleanup tools; report their paths to the coordinator.

Elsewhere, read-only investigation MAY stay in the current checkout. Bounded implementation in a repository's default-branch checkout MUST move to a worktree: `git fetch origin && git worktree add -b <branch> <repo>-<slug> origin/<default>`, then keep working in the current session with absolute paths.

Exceptions: the dotfiles repository, and a repository where `git remote` prints nothing and no other agent works in the checkout. Work directly in the default-branch checkout; nothing is published from either, so a worktree only adds a checkout.

## Reuse before creating

Reuse an open worktree for the same task. Otherwise reuse an unclaimed one: no linked issue or PR, HEAD equal to the default branch, `git status --porcelain` empty, and no agent running in it. Create a worktree only when neither exists. Separate issues get separate worktrees unless Justin groups them. Concurrent agents MUST NOT share a working tree.

A branch whose HEAD is contained in the default branch is not closed on that fact alone; new task branches start there. A worktree is closed only when its PR is merged. Never reuse a closed worktree for new work.

## Issue identity

When the task has a Linear issue, use its `gitBranchName`, or a lowercase identifier and short slug if unavailable. Record the issue, branch, and checkout in todo metadata when todos exist. Outside Mastra, a task without an issue does not require creating one. Every Mastra pull request requires a Linear ticket: before implementation, search Linear for an existing issue covering the work and reuse it; ask Justin only when the search finds none.

After a push or PR creation for issue-linked work, verify the issue shows the branch or PR through the repository integration. If integration linking is unavailable, include the identifier in both branch and PR. See `git` for Mastra's internal-contributor exception and other publication policy.

## Cleanup

Cleanup belongs to the pinned coordinator. It reads `worktree_list` first and runs `worktree_remove` only when Justin asks, or once the branch is merged and he has confirmed. A task session MUST NOT remove its own worktree.

Approval to clean up a task authorizes the coordinator to finish that cleanup end-to-end: identify and stop its task-owned agents, servers, watchers and background commands; verify exit; close its task terminal session; and remove its checkout through the supported manager. Implementation approval or task completion alone does not authorize cleanup. Keep branches and commits unless their deletion is separately authorized.

1. Verify the exact task, checkout, merge state and Git state. Inspect process blockers and the task's terminal/session bindings before stopping anything. A PID or checkout cwd alone does not establish task ownership; verify process identity, start time, ancestry and task records. Recheck identity before signalling to avoid PID reuse.
2. Use the owning host's supported follow-up and stop controls for managed agents. If this coordinator no longer owns the agent, use supported recovery or reconnect first. A lost coordinator link is not a reason to send Justin to another session. If safe recovery is unavailable, identify the task's actual processes and use supported terminal lifecycle controls or graceful termination only where ownership is proven and no live host still supervises them. Never bypass another live coordinator's lease or an active managed child's lifecycle.
3. Stop only confirmed task-owned processes. Prefer graceful shutdown and confirm exit; a stop request is not exit evidence. Preserve the pinned inbox and all shared, user-owned or unrelated processes. Do not start a replacement agent merely to perform cleanup.
4. Reinspect holders after shutdown. Close the approved task's terminal session only after its task-owned foreground processes have exited, then retry `worktree_remove`. Keep its safety checks intact. Do not force-remove, recursively delete, clear leases manually or substitute raw Git removal to bypass a refusal. Dirty work requires explicit preservation authorization; ignored files are not preserved by `preserve:true`, so inspect whether they contain needed task artifacts before removal.
5. Continue through recoverable blockers without another approval request for the same cleanup. Ask Justin only when ownership remains uncertain, access or permissions prevent verification, another live owner must release the task, or preservation/destructive action needs a new decision. Name the exact unresolved blocker and what is needed, not a generic instruction to ask another agent to exit. Unreadable process details remain unknown, not unrelated.
6. Verify checkout removal and report what was stopped, what was removed, and anything deliberately retained. Never report cleanup complete while process or removal verification is unresolved.

Elsewhere, after merge: stop every task-owned server, watcher, and background command; MUST NOT stop user-owned, shared, or unrelated processes, and ask when ownership is unclear. Then verify the checkout is clean with no unpushed or unmerged commits, run `git worktree remove <path>`, and delete the branch. Never force-remove a checkout or discard uncommitted, unpushed, or unmerged work; report the blocker and ask.

</workflow>
