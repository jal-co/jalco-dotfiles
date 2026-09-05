# Worktree ownership

<workflow>

## Resolve before creating

1. Identify the target repository from the task and current checkout. Ask if it is ambiguous. Read-only investigation may stay in the current checkout.
2. Run `printenv SUPERSET_WORKSPACE_ID` before any creation. If set and the current workspace belongs to the target repository, work there directly. Do not create, switch, or remove its worktree or branch for this task. This exception skips creation only; isolation, issue linkage, and protection of unmerged work still apply.
3. If the target differs from the current workspace, do not edit the wrong repository. Resolve a matching Superset workspace for that repository and execute there in the current session. Workspace creation does not authorize launching an agent.
4. Outside an existing matching Superset workspace, inspect the target repository's worktrees. Reuse the matching task branch; otherwise create one dedicated worktree before editing. Separate issues need separate worktrees unless Justin groups them into one change. Concurrent agents and processes MUST NOT share a working tree.

## Choose the workspace manager

Use the first applicable path:

- If `superset` is installed and `superset auth whoami` succeeds, use Superset. Inspect `superset workspaces list --local --json` and reuse a matching branch. Resolve the project with `superset projects list --json`; use `superset projects setup` to adopt an unregistered repository. Create with `superset ws create --local --project <id> --branch <branch> --name <slug> --skip-branch-prefix`. Omit `--agent`, `--prompt`, and `--command` for workspace creation. Verify the returned branch and checkout path before editing.
- Otherwise, inside Herdr use `herdr_worktree_*` tools so hooks and linked paths run. Outside Herdr use native Git worktree commands.
- Work in another repository requires a Superset workspace. If Superset is unavailable, report the blocker rather than using a different creation path.

For new branches, fetch and start from the current remote default branch unless repository policy or the task specifies another base. Use `--base-branch` with Superset when an explicit base is needed. Existing task branches are reused without resetting them.

When delegation is explicitly authorized, load `superset-orchestrate` for Superset dispatch. Create or reuse the worktree first, then start the authorized agent with that checkout as its working directory. Permission to isolate work is not permission to delegate it.

## Issue identity

When the task has a Linear issue, use its `gitBranchName`, or a lowercase identifier and short slug if unavailable. Record the issue, branch, and checkout in todo metadata when todos exist. A task without an issue does not require creating one.

After a push or PR creation for issue-linked work, verify the issue shows the branch or PR through the repository integration. If integration linking is unavailable, include the identifier in both branch and PR. See `git` for Mastra's internal-contributor exception and other publication policy.

## Cleanup

After merge or confirmation that the change is on the base branch, remove the task worktree and safely delete its local branch. Verify the checkout is clean and has no unpushed or unmerged commits first. Use `superset ws delete` for Superset workspaces, Herdr tools for Herdr worktrees, and native Git otherwise.

Do not remove or switch the currently occupied Superset workspace. Leave its cleanup to a session outside it. Never force-remove a checkout or discard uncommitted, unpushed, or unmerged work; report the blocker and ask before discarding anything.

</workflow>
