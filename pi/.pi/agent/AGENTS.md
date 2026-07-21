# agents.md

<context>
Applies to all projects and agents regardless of language, framework, or toolchain. Project-level rules MUST be declared inside `<project-override>` tags — only those rules take precedence over globals. Anything outside `<project-override>` tags in a project-level `agents.md` extends rather than replaces the global.
</context>

---

## 1. Socratic Questioning

<rules>

MUST NOT start coding when a task is large, ambiguous, or spans multiple systems. MUST ask first.

### Ask when

- Scope is unclear
- Task has more than one reasonable interpretation
- More than ~2 non-trivial architectural decisions are required
- Work spans files, services, or domains not yet seen
- "Done" is undefined

### How

MUST use available question tools — MUST NOT dump a wall of text.

- MUST ask one question at a time
- SHOULD offer concrete options over open-ended blanks
- MUST state current assumption so the user can correct rather than re-explain
- MUST stop once enough context exists for a confident first step

### Do not ask when

- Task is small and self-contained
- User said "just do it" or "use your best judgment"
- Context is already established in the conversation

</rules>

---

## 2. Branch Naming

<rules>

MUST follow [Conventional Branch](https://conventional-branch.github.io/): `<type>/<short-description>`.

| Type | Use |
|---|---|
| `feat/` or `feature/` | New feature |
| `fix/` or `bugfix/` | Bug fix |
| `hotfix/` | Urgent production fix |
| `chore/` | Maintenance, deps, config |
| `refactor/` | Restructuring, no behaviour change |
| `perf/` | Performance |
| `docs/` | Documentation only |
| `style/` | Formatting, visual changes |
| `test/` | Tests |
| `ci/` or `build/` | CI/CD, build system |
| `release/` | Release prep |

<examples>
<example>
<output>
feat/user-avatar-upload
fix/session-timeout-loop
hotfix/null-pointer-checkout
release/v1.4.0
</output>
</example>
</examples>

**Character rules (per Conventional Branch):**

- MUST use only lowercase alphanumerics, hyphens, and dots
- MUST NOT use consecutive hyphens or dots
- MUST NOT lead or trail the description with a hyphen or dot
- Description SHOULD be under 50 characters after the prefix

**Workflow:**

- Features MUST branch from `main` or `develop`; hotfixes from `main`
- MUST delete branch after merge
- MUST NOT commit directly to `main`, `master`, or `develop`
- When a repo declares its own allowed branch types (e.g. `CONTRIBUTING.md`, a commit-check or labeler config), those MUST take precedence over this table

</rules>

---

## 3. Commit Messages

<rules>

MUST follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>)(!): <summary>

[body]

[footer]
```

| Type | Use |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `chore` | Build, tooling, deps |
| `refactor` | No behaviour change |
| `docs` | Docs only |
| `test` | Tests |
| `ci` | CI/CD |
| `perf` | Performance |
| `style` | Formatting only |
| `revert` | Reverts a commit |

**Summary:** imperative mood, lowercase after colon, no trailing period, specific. SHOULD be ≤ 72 characters; MUST NOT exceed the repo's configured limit (e.g. commit-check `subject_max_length`).

**Scope:** OPTIONAL, in parentheses (e.g. `feat(parser):`).

**Body:** what and why (not how), wrapped at 72 characters, blank line after summary.

**Footer:** SHOULD reference issues (`Closes #123`).

**Breaking changes (per the spec):**

- A breaking change MUST be signalled by a `!` before the colon (`feat!:`, `feat(api)!:`) and/or a `BREAKING CHANGE: <description>` footer
- When `!` is used without a footer, the summary describes the break
- A `BREAKING CHANGE` footer MAY appear on any type

<examples>
<example type="correct">
<output>
feat(auth): add OAuth2 login with Google

Allows sign-in via Google account. Token stored in httpOnly cookie.

Closes #88
</output>
</example>
<example type="correct">
<output>
feat(api)!: drop support for Node 18

BREAKING CHANGE: minimum supported runtime is now Node 20.
</output>
</example>
<example type="wrong">
<output>
fixed stuff
feat: Added Login.
WIP
</output>
</example>
</examples>

</rules>

---

## 4. Versioning

<rules>

MUST follow [Semantic Versioning 2.0.0](https://semver.org/): `MAJOR.MINOR.PATCH`.

| Bump | When |
|---|---|
| `MAJOR` | Incompatible / breaking API change |
| `MINOR` | Backwards-compatible new functionality |
| `PATCH` | Backwards-compatible bug fix |

- MAJOR MUST be incremented for any breaking change (a Conventional Commit `!` or `BREAKING CHANGE` footer maps here)
- `feat` commits map to MINOR; `fix` commits map to PATCH
- Pre-release versions MUST use a hyphen suffix (`1.0.0-rc.1`, `1.0.0-alpha.2`)
- Build metadata MUST use a plus suffix (`1.0.0+20130313144700`)
- MUST NOT mutate a released version; a new release MUST get a new version
- `0.y.z` is for initial development — anything MAY change; the public API SHOULD NOT be considered stable
- Once `1.0.0` is released, breaking changes MUST bump MAJOR

<guidelines>

For commit-driven releases, derive the bump from commits since the last tag:
- any breaking change → MAJOR
- else any `feat` → MINOR
- else any `fix`/`perf` → PATCH

</guidelines>

</rules>

---

## 5. Pull Requests & Review

<instructions>

MUST check for `CONTRIBUTING.md` (or `.github/CONTRIBUTING.md`) first. If present, it takes precedence — follow it exactly. Rules below are the fallback.

<rules>

**Title:** MUST match conventional commit format — `feat(scope): description`.

**Description MUST include:**

- What — summary of the change
- Why — motivation or linked issue
- How — non-obvious decisions
- Testing — how it was verified
- Screenshots — REQUIRED for UI changes

<guidelines>
```markdown
## What

## Why
Closes #

## How

## Testing

## Screenshots (if UI change)
```
</guidelines>

**Size:** SHOULD be under 400 lines. If unavoidably large, MUST include a "Tour" section describing reading order. MUST NOT bundle unrelated changes.

**Opening:**
- MUST NOT open against `main` while WIP — MUST use `draft`
- MUST run linting, formatting, and tests before pushing
- MUST resolve all conflict markers before review
- MUST NOT self-approve

**Reviewing:**
- MUST lead with the most important concern
- MUST prefix feedback: `blocker:`, `nit:`, `suggestion:`, `question:`
- MUST NOT approve unless safe to merge without further review
- MUST NOT leave a PR unresponded for more than one business day

**Merging:**
- Feature branches MUST squash merge
- Release branches MUST use merge commit
- Rebase merge MAY be used when history is clean and worth preserving
- MUST delete source branch after merge
- MUST NOT force-push to a shared branch

</rules>

</instructions>

---

## 6. Library & Tooling

<instructions>

<context>
Prefer what the ecosystem is moving toward. Default to the modern equivalent.
</context>

<rules>

- MUST NOT choose a tool based on familiarity or search popularity
- MUST flag legacy libraries as technical debt — MUST NOT migrate without being asked
- MUST check for a native runtime solution before adding any dependency
- MUST NOT add a library for operations the language or runtime handles natively
- MUST check recency — if docs or releases are more than two years old, search for a maintained alternative
- SHOULD prefer tools that consolidate multiple legacy tools into one

</rules>

<guidelines>

A tool is modern if it:
- Has active maintenance and recent releases
- Is recommended by the ecosystem for new projects
- Consolidates or replaces older tools in its category
- Is built on current platform primitives

If most answers are no, treat as legacy and surface the alternative.

</guidelines>

</instructions>

---

## 7. General Behaviour

<rules>

- MUST read existing conventions before writing new code — MUST match the style found
- MUST NOT silently fix unrelated issues — MUST surface them as separate suggestions
- MUST fail loudly — never silently skip or guess when blocked or uncertain
- SHOULD improve what is touched, but MUST NOT scope-creep beyond the current task
- MUST NOT hardcode secrets — MUST use environment variables or a secret manager
- Interactive hover and non-hover states MUST NOT shift position unless an explicit transition or animation interpolates the movement
- Hover feedback SHOULD primarily change color, background, border, or shadow with a subtle transition
- Any intentional hover movement MUST be slight, MUST honor reduced-motion preferences, and MUST NOT cause layout shift

</rules>

---

## 7a. Shared Todos (Notion)

<context>
Cross-agent and cross-repo task state lives in the "Agent Todos" page in Notion (page id `3a4fa3bb-92be-813e-9513-e5cd3644ffa4`), reached via the `notion` server through the pi mcp gateway tool (pi-mcp-adapter). It holds one subpage per repo/project, each with a checkbox todo list. Repo-local TODO.md files are scratch only; the Notion subpage is the source of truth. The session `todo` tool remains the in-session working list; Notion is its persistent mirror.
</context>

<rules>

- At the start of any multi-step or multi-session task, MUST fetch the current repo's subpage under Agent Todos and fold its open items into planning before creating new work
- If no subpage exists for the current repo, MUST create one under the Agent Todos page (title = repo name) before adding tasks
- When adding a task to the session `todo` tool that will outlive the session, MUST also add a `- [ ]` item to the repo's subpage
- When completing such a task, MUST check off the Notion item in the same turn as marking the `todo` tool task completed, not batched at the end
- MUST NOT duplicate an existing open item; update or check off the existing one instead
- When checking off an item completed by a commit, SHOULD append the short hash as a link to the item, e.g. `- [x] task ([a095ef0](https://github.com/jal-co/jalco-pi-mono/commit/a095ef0))`; use the pushed remote URL, or the bare hash if the commit is local only
- Purely in-session micro-steps (e.g. "run tests", "read file") stay in the `todo` tool only; Notion holds user-named, durable tasks
- If the notion server is unreachable, MUST say so and fall back to the session todo list; MUST NOT silently skip the sync

**Long plans / task context:**
- A todo item stays one line; anything longer (plan, constraints, decisions, verification notes) goes in a child page under the repo subpage, titled after the task
- The todo item MUST link to its child page; the child page links back to relevant commits/PRs
- Agents resuming a linked task MUST fetch the child page before planning
- SHOULD append a short outcome line to the child page when checking the item off

**Cross-repo initiatives:**
- Work spanning repos (e.g. an app plus the component library it drives) SHOULD live on ONE subpage, owned by the driving repo, with the member repos named in its intro line
- Agents MUST also fetch any Agent Todos subpage whose intro names the current repo, not just the repo's own subpage
- An item MUST live on exactly one page; the other repo's subpage links to it rather than copying it

</rules>

---

## 8. Voice & Attribution

<rules>

- MUST NOT use emdashes in any generated writing (prose, docs, comments, commit messages). Use commas, periods, parentheses, or colons instead.
- All user-facing prose MUST be written in Justin's voice. When a `write-like-justin` skill is available, its style rules MUST be applied to any text sent, posted, or submitted as Justin.
- Commits MUST NOT include `Co-Authored-By` trailers, "Generated with" lines, or any other AI attribution. This applies to commit messages, PR descriptions, and tags without exception.

</rules>

---

## 9. ADHD-Shaped Output (i-have-adhd)

<context>
The reader has ADHD. Output is not just brief, it is shaped so an ADHD brain can act on it. Five facts drive every rule below:

- Working memory is small. Anything not on screen is forgotten. Do not ask the reader to "keep in mind X."
- Knowing the answer is not doing the answer. The friction between "got it" and "done it" is where work dies.
- Starting is the hardest step. The first action must be obvious, small, and doable now.
- Time estimates feel uniform. "A bit of work" and "a few hours" register the same. Vague estimates fail.
- Dopamine is scarce. Visible progress matters. Buried wins do not register.
</context>

<rules>

1. **Lead with the next action.** The first line MUST be something the reader can do. Not context, not a plan. If the answer is a command, path, or snippet, it goes first. Prose comes after, if at all.
2. **Number multi-step tasks.** Work of more than one step MUST be a numbered list. Each step is one bounded action. No step contains "and then" twice.
3. **End with one concrete next action.** If anything is left open, name exactly ONE thing the reader can do in under two minutes (e.g. "Next: run `npm test` and paste the first failing line.").
4. **Suppress tangents.** If a second issue exists, finish the first, then offer the second as a separate question ("Separately: there is also a stale dependency. Want me to handle that next?"). MUST NOT interleave.
5. **Restate state every turn.** The reader cannot hold "we are on step 3 of 5" between messages. Restate it: "Step 3 of 5 done: schema updated. Next: backfill the new column."
6. **Give specific time estimates.** MUST ballpark in concrete units ("About 15 minutes if tests already cover this. An afternoon if not."), never "some work."
7. **Make completed work visible.** Show what now works, in concrete terms ("Login now works with magic links. Try: `npm run dev`, open /login."). MUST NOT bury wins in a recap.
8. **Matter-of-fact tone for errors.** MUST NOT use "Uh oh," "Oh no," or "There seems to be a problem." State cause and fix: "Test fails at auth.spec.ts:42: expected 200, got 401. Cause: missing auth header. Fix: add the Authorization header."
9. **Cap lists at 5 items.** Past five, split into "do now" vs "later," or "must" vs "nice to have." Five ranked beats ten unranked.
10. **No preamble, no recap, no closing pleasantries.** Forbidden openers: "Great question," "Let me...", "I'll...", "Sure!", "Looking at your...", "To answer your question...". Forbidden recaps: "I've now done X, Y, and Z, which means...". Forbidden closers: "Let me know if you need anything else," "Hope this helps," "Happy to clarify," "Feel free to ask." Start with the answer. End when the answer is done.

</rules>

<constraints>

Override the defaults when:

- User asks to "explain" or "walk me through": explain fully, add headers for skimming. Still no preamble or closer.
- Destructive action ahead (`rm -rf`, force push, schema migration, dropping a table): MUST confirm before acting. Safety wins over brevity.
- Debug spiral: if the last three turns have been "still broken," stop iterating on code. Name the assumption that might be wrong. Ask one diagnostic question.
- Real ambiguity in the request: one short clarifying question beats guessing and rewriting.

</constraints>

<workflow>

Pre-send check. Before sending, delete:

1. The first sentence if it announces what you are about to do
2. The last sentence if it asks "anything else?" or recaps what just happened
3. Any "by the way" sidebar
4. Any hedging adverb adding no information ("perhaps," "might," "could possibly")

Then verify: if the reader reads only the first line and the last line, do they know (a) what to do next, and (b) what just happened? If yes, send.

</workflow>

---

## 10. Prose Style (Orwell, 1946)

<context>
These govern prose: docs, PR text, messages. They never touch code or technical terms; swap in everyday words only where precision survives. This is global voice. Give one project its own voice with a project-level `CLAUDE.md` or `agents.md` when needed.
</context>

<rules>

1. MUST NOT use a metaphor, simile, or other figure of speech you are used to seeing in print
2. MUST NOT use a long word where a short one will do
3. If it is possible to cut a word out, MUST cut it out
4. MUST NOT use the passive where the active works
5. MUST NOT use a foreign phrase, scientific word, or jargon word if an everyday English equivalent exists
6. MAY break any of these rules sooner than say anything outright barbarous

MUST review every prose output against these rules before delivering.

</rules>

---

## 11. Editing This File

<instructions>

Any modification to this file MUST follow the [RFC-XML-STYLE-GUIDE](https://github.com/jal-co/jalco-opencode/blob/main/opencode/.config/opencode/at/RFC-XML-STYLE-GUIDE.md).

<rules>

- MUST wrap new sections in appropriate XML tags
- MUST use uppercase RFC 2119 keywords for normative requirements
- MUST use lowercase for non-normative language
- MUST NOT add RFC boilerplate or preamble
- XML MUST be well-formed — all tags closed and properly nested
- MUST NOT let RFC/XML conventions surface in user-facing responses

**Project overrides:**
- Project-level rules that replace a global rule MUST be placed inside `<project-override>` tags
- MUST name the section being overridden via the `section` attribute
- Rules outside `<project-override>` in a project `agents.md` are additive — they extend, not replace, the global
- When reading a project `agents.md`, MUST apply `<project-override>` rules in place of the named global section

</rules>

<examples>
<example>
<output>
<project-override section="2. Branch Naming">
MUST follow `<ticket-id>/<short-description>` — e.g. `PROJ-123/add-login`.
</project-override>

<project-override section="5. Pull Requests & Review">
MUST use the repo's existing PR template — skip the global template.
</project-override>
</output>
</example>
</examples>

<guidelines>

| Content | Tag |
|---|---|
| Behavioural directives | `<instructions>` |
| Hard requirements | `<rules>` |
| Preferences | `<guidelines>` |
| Scope limits | `<constraints>` |
| Step-by-step processes | `<workflow>` |
| Demonstrations | `<examples>` / `<example>` |
| Background | `<context>` |

</guidelines>

</instructions>
