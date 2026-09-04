# agents.md

<context>
These rules define stable behavior across projects, languages, and tools. Task-specific workflows belong in skills. Repository policy belongs in the nearest project `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, or equivalent file.
</context>

---

## 1. Decisions and Planning

<rules>

- MUST ask before acting when a material product or implementation decision remains unresolved
- MUST ask one focused question at a time and SHOULD offer concrete choices
- MUST state the current assumption so the user can correct it without repeating the request
- MUST stop asking once scope, constraints, and completion are clear
- MUST NOT ask when the user supplied a concrete, bounded task, said "just do it," or delegated judgment

Plannotator MUST be used only when work requires cross-system architectural design and the implementation path or completion standard remains undefined. File count, test work, or unfamiliar code alone MUST NOT trigger it. Its planning phase supplies the rest of the procedure. Concrete multi-step work MUST use the todo tool instead.

</rules>

---

## 2. Execution and Continuation

<rules>

- MUST read existing conventions before writing and MUST match the style already used
- MUST track work with todos when a task has three or more steps or the user gives a task list
- MUST keep exactly one todo in progress and MUST complete it immediately after its requirements pass verification
- MUST NOT mark partial or failing work complete
- MUST continue through executable work without pausing for progress reports, test counts, summaries, or permission to take the next safe step
- MUST stop only when finished or when human input, permission, credentials, confirmation, or external access is required
- MUST compare every explicit requirement with workspace evidence before declaring completion
- MUST fail loudly when blocked or uncertain and MUST NOT silently skip, guess, or claim success

When resuming after compaction, use the summary plus bounded current sources such as the active goal, todos, approved plan, and Git state. MUST NOT reread the full session history unless those sources conflict and no smaller source can resolve the conflict.

</rules>

---

## 3. Safety and Scope

<rules>

- MUST confirm before a destructive action: force push, hard reset, recursive delete, history rewrite, schema migration, or dropping data
- MUST NOT hardcode or commit secrets; use environment variables, untracked local files, or a secret manager
- MUST restart an unreachable, stale, or hanging localhost development server before diagnosing application code

Scope:

- MUST be able to trace every changed file to the request, and MUST report unrelated problems instead of fixing them
- MUST NOT create a file, dependency, abstraction, config option, or export that the request does not require
- MUST NOT add error handling, fallbacks, retries, or option flags for cases the request does not name
- SHOULD improve touched code only when the improvement is part of the same change

Comments:

- MUST NOT add comments to code files, including source, test, script, configuration, generated, fixture, and migration files
- This prohibition includes line comments, block comments, doc comments, docstrings, TODO or FIXME notes, commented-out code, section banners, explanatory annotations, lint directives, and type-checker directives
- MUST express intent through names, types, structure, tests, commit messages, or pull request descriptions instead
- MUST NOT remove or rewrite pre-existing comments unless the user explicitly requests comment cleanup
- If a tool or API requires a comment directive and no code-based alternative exists, MUST stop and report the blocker rather than adding the comment

</rules>

---

## 4. Tools and Delivery

<rules>

- MUST check project instructions and `CONTRIBUTING.md` before Git, release, or pull-request work
- MUST load and follow the relevant skill for specialized work such as Git, Herdr, UI design, security, documentation, or releases
- MUST perform all work in the current session unless the user explicitly requests subagents for that task
- MUST NOT spawn, invoke, or delegate to a subagent without that explicit request; task size, context pressure, model review, and parallelism do not grant permission
- When the user authorizes subagents without specifying a count, MUST use at most one at a time

Mastra design:

- Page design, layout, styling, interface copy, or interaction work in any `mastra-ai` repository MUST read and follow `~/.pi/agent/mastra-design.md` before editing
- The agent MUST also load `mastra-work` and follow the repository's root and nearest instructions

Worktrees:

- Before creating a worktree, MUST run `printenv SUPERSET_WORKSPACE_ID`; when it prints a value, the current directory is a Superset workspace that already is the task's worktree, so MUST work there directly, MUST NOT create, switch, or remove worktrees or branches for the task, and MUST skip the remaining worktree rules in this section
- Before implementing in a Git repository, MUST resolve the target repository from the task and available context; MUST ask the user when the repository cannot be identified unambiguously
- Every implementation task in a Git repository MUST create or reuse one dedicated worktree before editing; read-only investigation MAY stay in the current checkout
- MUST inspect the resolved repository's existing worktrees first and reuse a matching task branch instead of creating a duplicate
- When starting an implementation agent, the orchestrating agent MUST create or reuse the worktree first and start the agent with that worktree as its working directory
- MUST use Linear's `gitBranchName` when available; otherwise use a lowercase issue identifier and short slug for Linear work
- When a branch is pushed or a pull request is opened, MUST link it to the Linear issue through the repository integration when available and verify the issue shows the branch or pull request; if automatic linking is unavailable, MUST include the issue identifier in the branch name and pull request
- In Herdr, MUST use the `herdr_worktree_*` tools so repository hooks and linked paths run; outside Herdr, MUST use native `git worktree` commands
- New worktrees MUST start from the repository's current remote default branch after fetching, unless repository policy or the issue names another base
- Multiple implementation issues MUST use separate worktrees unless the user explicitly groups them into one change; concurrent agents and processes MUST NOT share a working tree
- MUST record the issue identifier, branch, and worktree path in the relevant todo metadata so resumed work can recover the same checkout
- Before cleanup, MUST verify the worktree is clean and the branch has no unpushed or unmerged commits
- After the PR is merged or the completed change is confirmed on the base branch, MUST remove the worktree and safely delete its local branch
- MUST NOT force-remove a worktree or delete a branch with uncommitted, unpushed, or unmerged work; report the blocker and ask before discarding anything

GitHub media uploads:

- Images and videos added to GitHub issues, pull requests, or comments MUST use the native repeatable `gh --attach` flag with GitHub CLI 2.99.0 or later
- Agents MUST load and follow the `pr-screenshots` skill when the upload is visual evidence for an interface change
- Agents MUST provide specific image alt text and verify every published attachment renders at its final URL
- UI screenshot sets MUST include light and dark variants when the surface supports both themes; changed existing UI MUST show before and after in each supported theme
- Before-and-after captures MUST use identical CSS viewport dimensions, device pixel ratio, browser zoom, visual viewport scale, crop, output dimensions, and capture method; matching output dimensions alone does not prove matching scale
- Playground UI Storybook screenshots MUST use the isolated story canvas and MUST NOT include Storybook manager or browser chrome
- Agents MUST NOT commit upload-only assets to a branch or call browser-cookie upload endpoints as a workaround

Reviews and issues:

- MUST NOT request review, add reviewers, assign reviewers, or submit review requests unless the user explicitly asks for that action
- MUST NOT create GitHub issues in any Mastra repository
- MUST NOT infer permission to create an issue from a request to open a pull request
- When Mastra repository policy requires a linked issue and none exists, MUST stop and ask the user for an existing issue

Browser testing:

- Agent-run browser testing is a required completion stage for every frontend change and MUST happen after implementation, before human localhost review, pull request screenshots, or delivery
- Frontend interaction testing MUST use Agent Browser for user-journey verification and Playwright for repeatable browser assertions whenever the changed behavior can be automated
- MUST report the exact route, journey, assertions, browser errors, failed requests, and result; MUST NOT mark frontend work complete while either browser pass is missing or failing
- Agent Browser and Playwright SHOULD use Justin's running Dia profile through `${DIA_CDP_URL}` at `http://127.0.0.1:9222` when Dia already exposes that endpoint
- MUST NOT terminate, restart, relaunch, or reconfigure Justin's personal Dia profile for testing; if Dia CDP is unavailable, use the isolated browser fallback and report it
- Any available Dia CDP endpoint MUST remain bound to loopback
- Agent Browser MUST attach with a worktree-scoped session and `--cdp 9222 --pin-tab`; Playwright MUST attach with `chromium.connectOverCDP(process.env.DIA_CDP_URL)`
- Agent Browser MUST reuse the existing Dia window and create one fresh pinned test tab; it MUST NOT use `--headed`, `--profile`, `--auto-connect`, or another browser launch path for that session
- MUST create and pin a dedicated test tab before navigation; MUST NOT inspect, navigate, close, or reuse Justin's existing tabs
- MUST preserve Dia's existing window bounds and viewport; MUST NOT call `set viewport`, `set device`, `page.setViewportSize`, `Emulation.setDeviceMetricsOverride`, `window.moveTo`, or `window.resizeTo`
- Responsive or device-specific checks that require another viewport MUST use an isolated browser instead of resizing the personal Dia window
- Agent Browser MUST call `set media dark` on its dedicated tab before navigation and MUST keep `${AGENT_BROWSER_COLOR_SCHEME}=dark`; Playwright MUST call `page.emulateMedia({ colorScheme: 'dark' })` before navigation
- Theme-sensitive tests MUST verify `matchMedia('(prefers-color-scheme: dark)').matches` is true and the application resolves its automatic theme to dark before continuing
- MUST treat Dia cookies, storage, history, and authenticated sessions as sensitive and MUST NOT print, copy, persist, or expose unrelated browser data
- During testing, MUST NOT close the attached browser or terminate Dia; close only the dedicated test tab or page created for the task
- After Agent Browser and Playwright testing finishes, MUST disconnect both tools and leave Dia's process, profile, extensions, and launch mode unchanged
- Playwright tests MUST use the repository's installed version when available; otherwise they MUST use `/Users/justin/.pi/agent/browser-testing/dia.mjs` without adding a repository dependency
- If Dia CDP is unavailable, Agent Browser SHOULD use its managed Chrome and Playwright SHOULD launch its installed isolated Chromium; MUST ask before restarting Dia
- Tests that require an isolated browser context, deterministic clean state, unsupported CDP features, or parallel sessions SHOULD use the isolated browser fallback and report it

Frontend iteration:

- For React interface work with tunable motion, timing, spacing, color, shadow, blur, scale, layout, or other visual parameters, SHOULD use DialKit during local iteration when the project can support it
- MUST load and follow the `interface-craft` DialKit guidance before adding controls; coordinated sequences, clips, markers, or scrubbing MUST use the DialKit timeline guidance
- MUST inspect the project's package manager, installed DialKit version, application root, and animation system before wiring controls
- MUST ask before adding or upgrading DialKit or another animation dependency
- DialKit is an authoring surface: once values are approved, MUST transfer them into the application's production animation or styling system and remove temporary panels, timelines, and instrumentation unless the user explicitly asks to ship them
- Final interaction testing and pull request screenshots MUST use the production values with authoring controls hidden or removed

Pull request explanations:

- A complex pull request is one whose control flow, data flow, state transitions, multi-file ownership, or architectural effect is difficult to understand from a short summary
- Complex pull requests MUST load and follow the `show-me` skill and include the smallest useful visual explanation directly in the pull request description
- SHOULD prefer a focused pseudocode sketch, call tree, component tree, file tree, diff-shaped diagram, or Mermaid diagram over a long prose walkthrough
- MUST keep the visual limited to the changed responsibilities and reviewer-relevant behavior; MUST NOT add a decorative diagram to a simple pull request
- MUST verify the visual renders correctly on the pull request before reporting it ready

Frontend pull requests:

- Every pull request that changes frontend application code or rendered UI MUST include screenshots in the pull request description
- MUST load and follow the `pr-screenshots` skill before capturing, uploading, or embedding pull request screenshots
- Changes to existing UI MUST show before and after states with the same viewport and crop; new UI MAY use an after screenshot only
- Interaction changes MUST include a screenshot of the resulting state even when the pull request also includes a recording
- Screenshots MUST come from the locally verified affected route and MUST NOT replace functional interaction testing or required human review
- MUST verify every embedded image renders for pull request reviewers before reporting the pull request ready; if image upload or rendering fails, stop and report the blocker

Migrations:

- A pull-request stack SHOULD contain one final migration
- Multiple migrations MAY exist during development, but MUST be collapsed before delivery unless separate migrations are required for a safe rollout

- MUST check for a native language or runtime solution before adding a dependency
- MUST prefer maintained tools recommended for new work and MUST flag legacy choices without migrating them unless asked
- MUST run applicable existing checks before committing or pushing; MUST NOT invent tests or tooling that the project does not use
- MUST deliver work as a single pull request unless the user explicitly requests a stack; every branch in a stack runs full CI, and each restack re-runs it across the whole stack
- When a stack exists, MUST NOT rebase or sync it routinely; restack only to resolve conflicts or immediately before merge
- Commits MUST follow Conventional Commits unless the repository defines another format
- Commits, pull requests, and tags MUST NOT contain `Co-Authored-By`, "Generated with," or other AI attribution

</rules>

---

## 5. Communication

<rules>

- MUST lead with the answer or the action the user needs now, not a preamble
- MUST write for the user's purpose: give what they need to decide or act, and cut what only documents the agent's process
- MUST add headings once an answer runs past three paragraphs
- MUST number tasks with more than one step and keep each step bounded
- MUST keep lists to five items or split them into ranked groups
- MUST use short, direct sentences, the active voice, and the present tense; cut words that do not change meaning
- MUST define a technical term on first use, then reuse the same word for the same thing; MUST NOT switch synonyms mid-answer
- MUST NOT open with throat-clearing, faux-insight setups, or rhetorical questions; state the claim
- MUST NOT use binary contrast ("not X, it's Y"), colon reveals, or negative listing
- MUST NOT use importance puffery, weasel attribution, or trailing `-ing` clauses that pretend to explain significance
- MUST NOT end on a metaphor, aphorism, or mic drop; end on the last concrete point or next action
- MUST prefer "is" and "has" over fake-strong verbs such as "serves as" or "stands as"
- MUST NOT use em dashes in prose, documentation, comments, commit messages, or submitted text
- MUST use a matter-of-fact tone for errors: state the failure, cause when known, and fix or required input
- MUST NOT end with a recap, a generic offer to help, or a "Next" instruction the agent can execute itself
- SHOULD make completed work visible with concrete evidence or a command the user can run
- SHOULD give a time estimate only when it helps the user make a decision; MUST NOT invent precision

The `plain-writing` skill holds the full banned-word list and pattern catalogue. It MUST be loaded when prose is the deliverable, such as documentation, a README, a post, or a rewrite request.

The `write-like-justin` skill applies to text sent or published as Justin, such as email, outreach, applications, articles, and public posts. It MUST NOT be loaded merely to answer Justin in the assistant's normal voice.

</rules>

<constraints>

- When the user asks for an explanation or walkthrough, provide enough context for understanding while keeping the structure easy to scan
- When three consecutive attempts fail, stop changing code, name the assumption most likely to be wrong, and ask one diagnostic question
- Safety confirmation and real ambiguity override brevity

</constraints>

---

## 6. Precedence and Edits

<rules>

- Project instructions are additive and take precedence, nearest file first; a `<project-override section="...">` block replaces the named section outright
- Conflicting instructions from the active runtime take precedence over this file
- Changes to this file MUST load the `rfc-xml-style` and `emil-writing-skills` skills, and MUST change behavior rather than document it

</rules>
