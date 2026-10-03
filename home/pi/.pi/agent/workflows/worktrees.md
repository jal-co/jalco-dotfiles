# Worktree ownership

<workflow>

## Where work happens

Inside Herdr or T3 Code, the main agent (`herdr-dispatch` or `t3-dispatch`) creates one worktree and Pi session per task. A task session works only in its own worktree and MUST NOT create, switch, or remove worktrees; a second task goes back to the main agent, because one session per task is what keeps context separate.

Elsewhere, read-only investigation MAY stay in the current checkout. Bounded implementation in a repository's default-branch checkout MUST move to a worktree: `git fetch origin && git worktree add -b <branch> <repo>-<slug> origin/<default>`, then keep working in the current session with absolute paths.

Exceptions: the dotfiles repository, and a repository where `git remote` prints nothing and no other agent works in the checkout. Work directly in the default-branch checkout; nothing is published from either, so a worktree only adds a checkout.

## Reuse before creating

Reuse an open worktree for the same task. Otherwise reuse an unclaimed one: no linked issue or PR, HEAD equal to the default branch, `git status --porcelain` empty, and no agent running in it. Create a worktree only when neither exists. Separate issues get separate worktrees unless Justin groups them. Concurrent agents MUST NOT share a working tree.

A branch whose HEAD is contained in the default branch is not closed on that fact alone; new task branches start there. A worktree is closed only when its PR is merged. Never reuse a closed worktree for new work.

## Issue identity

When the task has a Linear issue, use its `gitBranchName`, or a lowercase identifier and short slug if unavailable. Record the issue, branch, and checkout in todo metadata when todos exist. Outside Mastra, a task without an issue does not require creating one. Every Mastra pull request requires a Linear ticket: before implementation, search Linear for an existing issue covering the work and reuse it; ask Justin only when the search finds none.

After a push or PR creation for issue-linked work, verify the issue shows the branch or PR through the repository integration. If integration linking is unavailable, include the identifier in both branch and PR. See `git` for Mastra's internal-contributor exception and other publication policy.

## Cleanup

Inside Herdr or T3 Code, cleanup belongs to the main agent's cleanup workflow. A task session MUST NOT remove its own worktree.

Elsewhere, after merge: stop every task-owned server, watcher, and background command; MUST NOT stop user-owned, shared, or unrelated processes, and ask when ownership is unclear. Then verify the checkout is clean with no unpushed or unmerged commits, run `git worktree remove <path>`, and delete the branch. Never force-remove a checkout or discard uncommitted, unpushed, or unmerged work; report the blocker and ask.

</workflow>
