# Worktree ownership

<workflow>

## Reject closed worktrees

Before any repository mutation, inspect the current Orca worktree with `orca worktree current --json` and refresh the remote default branch when network access is available. Treat the current worktree as closed when any of these conditions is true:

- Orca reports `workspaceStatus: completed` or `isArchived: true`.
- Its linked pull request is merged.
- It is a non-default branch whose HEAD is already contained in the remote default branch.

A closed worktree MUST NOT be edited, reopened, or reused for new work. If a task starts there, create a fresh Orca worktree from the remote default branch, fork the current Pi session into that checkout, focus the replacement terminal, and stop work in the original session. Leave the closed worktree and original session unchanged. A failed or unavailable remote check MUST NOT be interpreted as proof that a worktree is open.

The repository's default-branch checkout is a launch point, not a task worktree. Read-only investigation MAY stay there, but bounded implementation MUST receive its own worktree and Pi session through the same handoff.

For the handoff, capture `PI_SESSION_ID`, create the worktree without an agent, stop task-owned background terminals that must not continue against the old checkout, then run `orca terminal create --worktree path:<created-path> --command "pi --fork <session-id> 'Continue the current task in this new worktree.'" --focus --json`. Verify that Orca returned a terminal handle before ending the original turn. This forks the conversation into cwd-bound Pi state for the new checkout; a running Pi process MUST NOT be treated as movable between working directories.

Every created worktree MUST receive an explicit semantic kebab-case `--name`; never accept an unrelated generated codename. Prefer the issue identifier plus a short task slug when an issue exists, otherwise derive a short task slug from the requested outcome. Orca's branch-prefix setting owns any username prefix.

Every new Orca worktree MUST use the worktree that spawned it as its immediate parent with `--parent-worktree active`. This keeps the lineage rooted at the repository's initial checkout while preserving which worktree initiated each child. If the caller is not in an Orca-managed worktree, use the repository's initial checkout as the explicit parent. Confirm the created path, branch, and `parentWorktreeId` before mutation.

## Resolve before creating

1. Identify the target repository from the task and current checkout. Ask if it is ambiguous. Read-only investigation may stay in the current checkout.
2. Run `printenv ORCA_WORKTREE_ID` before any creation. If set and the current worktree belongs to the target repository, work there directly only when the closed-worktree checks above pass and it is the open worktree for this task. Do not switch, remove, or repurpose its branch. This exception skips creation only; isolation, issue linkage, and protection of unmerged work still apply.
3. If the target differs from the current worktree, do not edit the wrong repository. Resolve a matching Orca worktree for that repository and execute there in the current session. Worktree creation does not authorize launching an agent except for the replacement-session handoff defined above.
4. Inspect the target repository's worktrees. Reuse only an open worktree for the same task; otherwise create one dedicated worktree before editing. Separate issues need separate worktrees unless Justin groups them into one change. Concurrent agents and processes MUST NOT share a working tree.

## Choose the workspace manager

Use the first applicable path:

- If `orca` is installed and `orca status` succeeds, use Orca. Inspect `orca worktree list --json` and reuse only a matching open task worktree. Resolve the project and host setup with `orca project list --json` and `orca project setups --json`. Create with `orca worktree create --project <id> --host <host-id> --name <semantic-slug> --base-branch <remote-default> --parent-worktree active --json`. Omit `--agent`, `--prompt`, and `--activate` so creation does not launch another agent or steal focus. Verify the returned branch, checkout path, and parent worktree before editing.
- Otherwise, inside Herdr use `herdr_worktree_*` tools so hooks and linked paths run. Outside Herdr use native Git worktree commands.
- Work in another repository requires an Orca worktree. If Orca is unavailable, report the blocker rather than using a different creation path.

For new branches, fetch and start from the current remote default branch unless repository policy or the task specifies another base. Use `--base-branch` with Orca when an explicit base is needed. Existing open task branches are reused without resetting them.

When delegation is explicitly authorized, load the matching orchestration skill for dispatch. Create or reuse the worktree first, then start the authorized agent with that checkout as its working directory. Permission to isolate work is not permission to delegate it.

## Issue identity

When the task has a Linear issue, use its `gitBranchName`, or a lowercase identifier and short slug if unavailable. Record the issue, branch, and checkout in todo metadata when todos exist. Outside Mastra, a task without an issue does not require creating one. Every Mastra pull request requires a Linear ticket: before implementation, search Linear for an existing issue covering the work and reuse it; ask Justin only when the search finds none.

After a push or PR creation for issue-linked work, verify the issue shows the branch or PR through the repository integration. If integration linking is unavailable, include the identifier in both branch and PR. See `git` for Mastra's internal-contributor exception and other publication policy.

## Cleanup

After merge or confirmation that the change is on the base branch, inventory terminals and long-running processes associated with the task worktree. Stop every task-owned server, watcher, and background command that is no longer needed before removing the worktree. MUST NOT stop user-owned, shared, or unrelated terminals; ask when ownership is unclear.

Then remove the task worktree and safely delete its local branch. Verify the checkout is clean and has no unpushed or unmerged commits first. Use `orca worktree rm` for Orca worktrees, Herdr tools for Herdr worktrees, and native Git otherwise.

Do not remove or switch the currently occupied Orca worktree. Leave its cleanup to a session outside it. Never force-remove a checkout or discard uncommitted, unpushed, or unmerged work; report the blocker and ask before discarding anything.

</workflow>
