---
name: git
description: Git and GitHub rules for commits, branches, rebases, conflict resolution, history, and pull requests. Use for any commit, branch, push, rebase, or PR work. Also use before building UI that is intended for a pull request, so the before state is captured in time.
---

<overview>
Justin's Git and GitHub policy. Routine Git and `gh` commands need no guidance. This skill owns what is specific to Justin's setup, and it is the single entry for pull requests.
</overview>

## Local workflow policy

Before implementation or worktree operations, read `~/.pi/agent/workflows/worktrees.md`. It owns checkout selection, workspace-manager precedence, agent permission, issue identity, and cleanup. Its rules take precedence over this skill.

- Use Conventional Commits unless the repository defines another format. Commits, PRs, and tags MUST NOT include AI attribution.
- Before a branch's first push, make its name earn the PR: lowercase `type/short-slug` (or the issue's `gitBranchName`) that names the change, not a placeholder like `patch-1`, `fix`, `wip`, or a tool-generated slug. Rename with `git branch -m` while the branch is still local only. MUST NOT rename a branch that is already on the remote or has an open PR; those keep their name, so choose it well at creation.
- Deliver one PR unless Justin explicitly requests a stack. Each stack branch runs full CI; restacking reruns it across the stack. Do not routinely rebase or sync a stack; restack only for conflicts or immediately before merge.
- A stack should have one final migration. Collapse development migrations before delivery unless separate migrations are required for safe rollout. Confirm before running migrations.
- Link an existing task issue when publishing and verify the linkage. Do not invent an issue requirement for tasks without one. Outside the Mastra internal exception below, ask for an existing issue when repository policy requires one. Never create GitHub issues in Mastra repositories.
- Run applicable existing checks before commits or pushes. Publication, merges, and reviewer requests require their respective user authorization.

## Commit messages

- Use `<type>(<scope>): <description>` with the types `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`.
- Write the subject in the imperative mood, under 72 characters, with no trailing period.
- Use the body for why the change was needed. Put issue references and breaking changes in footers.

## Safety

- MUST NOT force push to shared branches, hard reset them, or delete remote branches others use.
- MUST ask before `git push --force-with-lease`, rebasing shared branches, `git reset --hard`, and `git clean -fd`.
- Run `git status`, `git log --oneline -5`, and `git diff` before any destructive operation. Prefer `--force-with-lease` to `--force`. `git reflog` recovers lost commits.

## Mastra internal pull requests

When Justin works in `mastra-ai/mastra`, treat the pull request as an internal core-contributor change. The agent MUST NOT require, create, or link a GitHub issue unless Justin asks for one or the task already has one. The linked-issue requirement in `CONTRIBUTING.md` applies to external contributions and MUST NOT block these pull requests.

Every Mastra pull request MUST have a Linear ticket attached (compliance policy, SOC2/HIPAA). Use the task's existing Linear issue, or search Linear for an existing issue covering the work before starting; link it through the repository integration and verify the issue shows the pull request, or include the identifier in the branch name and pull request when automatic linking is unavailable. When no covering issue exists, stop before opening the pull request and ask Justin for one; do not create Linear issues without his explicit permission.

## Pull request workflow

MUST read and follow `~/.pi/agent/skills/core/preparing-pull-requests/SKILL.md` when preparing, opening, updating, or finalizing a PR. It owns the body format, Justin's voice, no-slop pass, screenshots, diff explanations, and publication checks. For UI work intended for a PR, read it before implementation so the before state is captured in time.
