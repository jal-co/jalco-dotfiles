# agents.md

<context>
Personal defaults across projects. Repository instructions take precedence, nearest file first. Task-specific procedures live in skills and the conditional references below.
</context>

## 1. Decisions and planning

<rules>

- Ask one focused question when a material decision is unresolved. State the assumption and offer concrete choices. Proceed when the user supplies a bounded task or delegates judgment.
- Execute approved, bounded work with a checklist. Approval of recommendations authorizes their implementation without another approval gate for the same decisions.
- MUST NOT delegate or launch agents without explicit permission for this task. Work in the current session. When permission omits a count, use at most one agent at a time. Creating a workspace does not authorize delegation. Exception: a main agent (`herdr-dispatch` in Herdr, `t3-dispatch` in T3 Code) launches exactly one Pi agent per task Justin hands it. A p3 tree under `t3-dispatch` extends this: the dispatcher MAY launch read-only review agents, and the task's root thread MAY launch child threads and helpers as `t3-dispatch/p3-task.md` allows, because Justin approved that tree shape for every p3 task.
- The p3 workflow MUST start only when Justin says "with p3" or "using p3", or answers yes to "Use p3?". Before a big change, ask "Use p3?" in one line and wait: a feature across several layers, auth, billing, data model or migrations, security-sensitive paths, or a multi-PR effort. Smaller work runs without p3, because its review lanes and fix rounds cost more than a small change can hide. To start p3, read `~/dev/p3-stack/skills/p3-mode/SKILL.md` and follow it. A thread whose task brief opens with "Using p3" is already in p3 and MUST NOT ask.
- Task worktrees are created by the main agent, one per task, each with its own Pi session. A session already inside a task worktree MUST work there and MUST NOT create another worktree of the same repository, even when its branch has no commits yet. When the task also needs changes in another repository, the session MAY create one companion worktree there on the task's branch name, as `workflows/worktrees.md` describes; a cross-repository change has no other way to land, and the shared branch name lets cleanup match it to the task. Without a main agent, create worktrees with `git worktree add` and keep working in the current session with absolute paths.
- The dotfiles repository is an explicit exception to worktree isolation. MUST apply requested changes directly to its `main` checkout and MUST NOT create a task worktree.
- A repository with no configured Git remote is also exempt: MUST work directly in its default-branch checkout when no other agent is working there. Nothing is published or reviewed from a local-only repository, so a worktree adds a checkout without protecting anything.
- Before creating a worktree, MUST reuse an unclaimed worktree of the target repository: no linked issue or PR, no commits beyond the default branch, a clean working tree, and no agent running in it. Creating another leaves an empty worktree behind for Justin to clean up.

</rules>

## 2. Safety and scope

<rules>

- MUST confirm before force pushes, hard resets, recursive deletes, history rewrites, running schema migrations, or dropping data. An implementation request does not authorize destructive operations.
- MUST NOT expose or commit secrets. Use environment variables, untracked local files, or a secret manager.
- Keep every change within the request. Preserve unrelated work and report unrelated problems. Avoid speculative abstractions, dependencies, configuration, retries, and fallbacks; handle failures inherent to the requested behavior.
- Check native runtime solutions before adding dependencies. Ask before adding or upgrading animation dependencies. Flag legacy choices without migrating them unless requested.
- Before diagnosing application code, restart a stale or unreachable development server only when it belongs to this task. Ask before restarting a shared or unrelated service.
- Browser automation MUST use `$HOME/.pi/agent/browser-testing/task-browser` (or the Mastra wrapper) for isolated headless Agent Browser. MUST NOT attach to personal browsers, use desktop input, or fall back to headed testing. For Mastra Platform localhost login, MUST use the dedicated WorkOS TEST account through `auth-test-login` as `workflows/frontend.md` describes, never Justin's personal cookies. For sites without a test account, use `auth-import-helium <domain>`; it copies only those domains' cookies into the headless session and never touches Helium itself.
- MUST preserve personal browser tabs, profile, authentication, window state, and desktop focus. For an opinion or sign-off, MAY open the exact review URL in the background with `task-browser review <url>`; MUST NOT activate the app or automate that review tab. If background opening is unavailable, provide the link.
- MUST NOT request reviewers or create issues without explicit permission. Publication requires user authorization; creating a PR does not authorize merging it.
- MUST NOT create, update, reply to, resolve, or delete Linear comments without explicit permission for that specific action. A request to coordinate, implement an issue, or work in Linear does not grant comment permission.

### Comments

- MUST NOT add comments to code files, including source, tests, scripts, configuration, generated files, fixtures, and migrations. This includes docstrings, documentation comments, lint/type directives, TODOs, banners, and commented-out code.
- Express intent through names, types, structure, tests, and change descriptions. Preserve existing comments unless the user requests their cleanup.
- If a required directive has no code-based alternative, stop and explain the blocker.

</rules>

## 3. Execution and completion

<rules>

- Read applicable repository instructions and conventions before changing files. Read `CONTRIBUTING.md` for changes or publication governed by it; routine read-only Git inspection does not require it.
- Use todos for three or more steps or a task list. Keep one in progress and complete it immediately after verification. Never mark partial or failing work complete.
- Continue through authorized implementation, relevant checks, and fixes for regressions caused by the change. Do not stop for a progress report or repeat permission already granted.
- Track every background terminal and long-running process started for the task. Stop each task-owned process as soon as it is no longer needed and before completion, handoff, or worktree cleanup. MUST NOT stop user-owned, shared, or unrelated processes. If ownership is unclear, ask before stopping it.
- Close every T3 Code preview tab and Agent Browser session opened for the task once it is no longer needed, and before completion or handoff. An open preview pane stays in Justin's workspace after the task ends.
- Stop when the next action requires unavailable information, access, or authorization, or a required human review. Repeated failure calls for revisiting the assumption; a fixed attempt count alone does not require stopping.
- Match every explicit requirement to evidence before declaring completion. Run applicable existing checks before committing or pushing. Do not add unrelated test tooling or claim unrun checks passed.
- Before any pull request, load `ponytail-review` and review the complete diff for avoidable complexity. Apply valid findings. For JavaScript or TypeScript changes, then run `anti-slop` (`~/dotfiles/tools/anti-slop/bin/anti-slop`) on the changed files. Fix findings in changed code or report why one stands; do not add either tool's config or dependencies to the target repository.
- After compaction, recover from the summary, current tasks, approved plan, and workspace state. Consult session history only when those sources conflict and smaller sources cannot resolve it.
- Session history is shared across repository checkouts and Herdr workspaces. When a task references prior work, a previous decision, a recurring error, an issue, or a related branch, search all Pi sessions with `session_search`, then inspect likely matches with `session_query`. Do not search history for unrelated new tasks.

</rules>

## 4. Task-specific guidance

<instructions>

Load only the guidance relevant to the task. Prefer the matching `emil-*` skill for design, motion, typography, color, components, accessibility, performance, review, writing cleanup, and skill authoring. MUST preserve installed Emil files unchanged; local policy belongs here or in separate references.

| Task | Required guidance |
| --- | --- |
| Implement in a Git repository; create, reuse, or clean up a worktree | Read `~/.pi/agent/workflows/worktrees.md` before editing. Keep concurrent work isolated. |
| Herdr main agent: dispatch tasks, follow up, status, cleanup | `herdr-dispatch`. |
| T3 Code main agent: dispatch tasks, follow up, status, cleanup | `t3-dispatch`. |
| Git changes, commits, branches, or publication | `git`. |
| Prepare, open, update, or finalize a PR | `preparing-pull-requests`. For UI intended for a PR, load before implementation to capture the before state. |
| Attach media to issues, comments, or PRs | `pr-screenshots`, including final URL verification and native GitHub uploads. |
| Frontend implementation, verification, or localhost handoff | Read `~/.pi/agent/workflows/frontend.md` before editing. Agent Browser verifies journeys; Playwright assertions apply when behavior can be automated. |
| Any work in a `mastra-ai` repository, or on Mastra Linear tickets | MUST load `mastra-work` before acting and follow it. It owns the Mastra UI, design, ticket, and review rules. |
| DialKit or storyboard tooling | `interface-craft`. Transfer approved values into production and remove temporary controls before final verification. |
| Prose as the deliverable | `emil-unslop-writing`. For text sent as Justin, use `write-like-justin`, which loads both `plain-writing` and `emil-unslop-writing`. Do not load Justin's voice for ordinary replies to him. |
| Pi skill packaging or discovery | `pi-skills`. For instruction authoring use `emil-writing-skills` and `rfc-xml-style`. |

Other specialized tasks use their matching skill when needed, including security, releases, and Herdr operations. A skill's command examples do not grant permission to execute them.

</instructions>

## 5. Communication

<guidelines>

Lead with the answer or required action. Use short, direct sentences and enough context to explain decisions. Name concrete evidence and blockers. Use headings and numbered steps when they help scanning.

When review notes arrive from a pull request or diff view, begin the requested work without an acknowledgment-only response such as “Fixing,” “On it,” or “Got it.” Respond only when there is a substantive result, blocker, or required question.

MUST NOT use em dashes or AI attribution in prose, commits, PRs, or tags. Avoid preambles, generic offers, and recap endings. Do not end by asking permission for a safe next step you can execute. Safety and real ambiguity take precedence over brevity.

</guidelines>

## 6. Precedence and edits

<rules>

- Higher-priority runtime instructions take precedence. A project's `project-override` block replaces its named section; other repository instructions are additive, nearest first.
- Changes to this file require `rfc-xml-style` and `emil-writing-skills`. Change behavior, preserve permission boundaries, and keep task procedures out of the global file.

</rules>
