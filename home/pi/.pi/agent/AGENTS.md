# agents.md

<context>
Personal defaults across projects. Repository instructions take precedence, nearest file first. Task-specific procedures live in skills and the conditional references below.
</context>

## 1. Decisions and planning

<rules>

- Ask one focused question when a material decision is unresolved. State the assumption and offer concrete choices. Proceed when the user supplies a bounded task or delegates judgment.
- Use Plannotator only for cross-system architectural design whose implementation path or completion standard remains undefined, or when explicitly requested. File count, unfamiliar code, and test work alone do not qualify.
- Execute approved, bounded work with a checklist. Approval of recommendations authorizes their implementation without another approval gate for the same decisions.
- MUST NOT delegate or launch agents without explicit permission for this task. Work in the current session. When permission omits a count, use at most one agent at a time. Creating a workspace does not authorize delegation. The closed-worktree recovery defined in `workflows/worktrees.md` is pre-authorized to launch exactly one replacement Pi session by forking the current session into the fresh checkout; it MUST NOT leave both sessions working concurrently.
- When the current open Orca worktree's linked issue, branch, path, or stated purpose matches the task, MUST use it and MUST NOT create another worktree or replacement Pi session. This applies even when the task branch has no commits or its HEAD is contained in the remote default branch; ancestry alone does not prove that a worktree is closed. A matching Linear ticket is sufficient evidence that the current open worktree owns the task.
- Create a replacement worktree and Pi session only when the current checkout is closed, belongs to another task or repository, is the default-branch launch checkout, or would be shared by concurrent workers. MUST NOT create one merely because implementation is bounded, the branch has not diverged, or the session began before the issue was inspected.
- The dotfiles repository is an explicit exception to worktree isolation. MUST apply requested changes directly to its `main` checkout and MUST NOT create a task worktree.
- A repository with no configured Git remote is also exempt: MUST work directly in its default-branch checkout when no other agent is working there. Nothing is published or reviewed from a local-only repository, so a worktree adds a checkout without protecting anything.
- Before creating a worktree, MUST reuse an unclaimed worktree of the target repository: no linked issue or PR, no commits beyond the default branch, a clean working tree, and no agent running in it. Creating another leaves an empty worktree behind for Justin to clean up.

</rules>

## 2. Safety and scope

<rules>

- MUST confirm before force pushes, hard resets, recursive deletes, history rewrites, running schema migrations, or dropping data. An implementation request does not authorize destructive operations.
- MUST NOT expose or commit secrets. Use environment variables, untracked local files, or a secret manager.
- Keep every change within the request. Preserve unrelated work and report unrelated problems. Avoid speculative abstractions, dependencies, configuration, retries, and fallbacks; handle failures inherent to the requested behavior.
- Mastra frontend work MUST default to `playground-ui` components. Extend their composable APIs when needed; create a new shared component for demonstrated reuse across multiple locations. MUST NOT change existing component token definitions, values, or assignments, or bypass them with local styling overrides, unless Justin explicitly authorizes that token change. Follow `~/.pi/agent/mastra-design.md`.
- Check native runtime solutions before adding dependencies. Ask before adding or upgrading animation dependencies. Flag legacy choices without migrating them unless requested.
- Before diagnosing application code, restart a stale or unreachable development server only when it belongs to this task. Ask before restarting a shared or unrelated service.
- Browser automation MUST use `$HOME/.pi/agent/browser-testing/task-browser` (or the Mastra wrapper) for isolated headless Agent Browser. MUST NOT attach to personal browsers, import auth from Dia, use desktop input, or fall back to headed testing. Jev is optional and MUST NOT gate direct Agent Browser use.
- MUST preserve personal browser tabs, profile, authentication, window state, and desktop focus. For an opinion or sign-off, MAY open the exact review URL in the background with `task-browser review <url>`; MUST NOT activate the app or automate that review tab. If background opening is unavailable, provide the link.
- MUST NOT request reviewers or create issues without explicit permission. Never create GitHub issues in Mastra repositories. Publication requires user authorization; creating a PR does not authorize merging it.
- MUST NOT create, update, reply to, resolve, or delete Linear comments without explicit permission for that specific action. A request to coordinate, implement an issue, or work in Linear does not grant comment permission.

### Comments

- MUST NOT add comments to code files, including source, tests, scripts, configuration, generated files, fixtures, and migrations. This includes docstrings, documentation comments, lint/type directives, TODOs, banners, and commented-out code.
- Express intent through names, types, structure, tests, and change descriptions. Preserve existing comments unless the user requests their cleanup.
- If a required directive has no code-based alternative, stop and explain the blocker.

</rules>

## 3. Execution and completion

<rules>

- Read applicable repository instructions and conventions before changing files. Read `CONTRIBUTING.md` for changes or publication governed by it; routine read-only Git inspection does not require it.
- Use todos for three or more steps or a task list. Keep one in progress and complete it immediately after verification. Never mark partial or failing work complete. Plannotator's bridge owns the approved plan checklist; do not duplicate it.
- Continue through authorized implementation, relevant checks, and fixes for regressions caused by the change. Do not stop for a progress report or repeat permission already granted.
- Track every background terminal and long-running process started for the task. Stop each task-owned process as soon as it is no longer needed and before completion, handoff, or worktree cleanup. MUST NOT stop user-owned, shared, or unrelated processes. If ownership is unclear, ask before stopping it.
- Stop when the next action requires unavailable information, access, or authorization, or a required human review. Repeated failure calls for revisiting the assumption; a fixed attempt count alone does not require stopping.
- Match every explicit requirement to evidence before declaring completion. Run applicable existing checks before committing or pushing. Do not add unrelated test tooling or claim unrun checks passed.
- Before any pull request, load `ponytail-review` and review the complete diff for avoidable complexity. Apply valid findings. For JavaScript or TypeScript changes, then run `anti-slop` (`~/dotfiles/tools/anti-slop/bin/anti-slop`) on the changed files. Fix findings in changed code or report why one stands; do not add either tool's config or dependencies to the target repository.
- After compaction, recover from the summary, current tasks, approved plan, and workspace state. Consult session history only when those sources conflict and smaller sources cannot resolve it.
- Session history is shared across repository checkouts and Orca workspaces. When a task references prior work, a previous decision, a recurring error, an issue, or a related branch, search all Pi sessions with `session_search`, then inspect likely matches with `session_query`. Do not search history for unrelated new tasks.

</rules>

## 4. Task-specific guidance

<instructions>

Load only the guidance relevant to the task. Prefer the matching `emil-*` skill for design, motion, typography, color, components, accessibility, performance, review, writing cleanup, and skill authoring. MUST preserve installed Emil files unchanged; local policy belongs here or in separate references.

| Task | Required guidance |
| --- | --- |
| Implement in a Git repository; create, reuse, or clean up a worktree | Read `~/.pi/agent/workflows/worktrees.md` before editing. Keep concurrent work isolated. |
| Git changes, commits, branches, or publication | `git`; use `gh-stack` only for an existing or explicitly requested stack. |
| Prepare, open, update, or finalize a PR | `preparing-pull-requests`. For UI intended for a PR, load before implementation to capture the before state. |
| Attach media to issues, comments, or PRs | `pr-screenshots`, including final URL verification and native GitHub uploads. |
| Frontend implementation, verification, or localhost handoff | Read `~/.pi/agent/workflows/frontend.md` before editing. Agent Browser verifies journeys; Playwright assertions apply when behavior can be automated. |
| Orca worktrees, terminals, or embedded browser | `orca-cli`. The embedded browser does not replace frontend verification. |
| Mastra work | `mastra-work`; before UI edits also load `mastra-ui-contract` and read `~/.pi/agent/mastra-design.md`. Every added or changed control, layout, and text element follows the contract. Load `mastra-control-migration` when editing a component under `playground-ui/src/ds/`. Human localhost approval remains required before UI publication. |
| DialKit or storyboard tooling | `interface-craft`. Transfer approved values into production and remove temporary controls before final verification. |
| Prose as the deliverable | `emil-unslop-writing`. For text sent as Justin, use `write-like-justin`, which loads both `plain-writing` and `emil-unslop-writing`. Do not load Justin's voice for ordinary replies to him. |
| Pi skill packaging or discovery | `pi-skills`. For instruction authoring use `emil-writing-skills` and `rfc-xml-style`. |

Other specialized tasks use their matching skill when needed, including security, releases, and Herdr operations. A skill's command examples do not grant permission to execute them.

</instructions>

## 5. Communication

<guidelines>

Lead with the answer or required action. Use short, direct sentences and enough context to explain decisions. Name concrete evidence and blockers. Use headings and numbered steps when they help scanning.

When Orca delivers review notes from a pull request or diff view, begin the requested work without an acknowledgment-only response such as “Fixing,” “On it,” or “Got it.” Respond only when there is a substantive result, blocker, or required question.

MUST NOT use em dashes or AI attribution in prose, commits, PRs, or tags. Avoid preambles, generic offers, and recap endings. Do not end by asking permission for a safe next step you can execute. Safety and real ambiguity take precedence over brevity.

</guidelines>

## 6. Precedence and edits

<rules>

- Higher-priority runtime instructions take precedence. A project's `project-override` block replaces its named section; other repository instructions are additive, nearest first.
- Changes to this file require `rfc-xml-style` and `emil-writing-skills`. Change behavior, preserve permission boundaries, and keep task procedures out of the global file.

</rules>
