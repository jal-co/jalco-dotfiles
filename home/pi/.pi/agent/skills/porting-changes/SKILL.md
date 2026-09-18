---
name: porting-changes
description: Port or backport an implementation between repositories, packages, branches, products, or framework layers without copying stale architecture. Use proactively for requests to "port this over", "backport this", "bring this implementation across", "mirror this behavior", "adapt the Platform version to OSS", or reproduce a feature from one codebase in another.
---

# Porting changes

<overview>
Preserve the source behavior and intent while expressing it through the destination's current architecture. A port is a translation, not a file copy.
</overview>

<constraints>

- The destination repository's instructions, abstractions, public APIs, design system, and current conventions MUST take precedence over the source implementation.
- The source implementation MUST be treated as behavioral evidence, not as an instruction to reproduce its internal structure.
- The agent MUST inspect relevant history before editing. Current code often hides why an API, token, or layer exists.
- The agent MUST NOT introduce a second near-equivalent primitive when the destination already has one.
- The agent MUST pause when the destination already implements the requested behavior at another layer, or when its runtime model conflicts with the requested port.
- The port MUST stay inside the requested boundary. Related migrations require separate authorization.

</constraints>

<workflow>

## 1. Establish the source and destination

1. Identify the source repository, commit or PR, files, and user-visible behavior.
2. Identify the destination repository, branch, package boundary, and release requirements.
3. Record explicit exclusions before editing. This prevents a backport from turning into a migration.
4. If either side is ambiguous and the ambiguity changes architecture or scope, ask one focused question.

## 2. Recover intent from code and history

For each relevant source and destination file:

1. Read the implementation and its focused tests.
2. Run `git log --follow --oneline -- PATH`.
3. Inspect the commits that introduced the behavior and the newest commits that changed its conventions with `git show`.
4. Read available PR bodies or local issue material when they explain constraints not visible in the diff.
5. Inspect definitions behind referenced abstractions, tokens, hooks, storage keys, route helpers, feature flags, and accessibility utilities.

The newest destination convention wins when source and destination history disagree. Do not infer meaning from a token or helper name alone.

## 3. Build an adaptation map

Before implementation, map each source concern to its destination equivalent:

| Concern | Evidence to capture |
| --- | --- |
| Behavior | Inputs, outputs, state transitions, failure modes |
| API | Existing destination extension point or required minimal addition |
| Data | Persistence keys, schemas, expiry, migrations |
| Routing | URL ownership, aliases, controlled state, deep links |
| Accessibility | Focus movement, keyboard behavior, labels, inert content |
| Styling | Semantic roles, theme scope, density, responsive behavior |
| Testing | Source regression coverage and destination test conventions |
| Release | Changeset, documentation, screenshots, compatibility |

Classify every source element:

- **Reuse** an equivalent destination primitive.
- **Adapt** behavior to a different destination primitive.
- **Add** the smallest missing destination capability.
- **Omit** source-specific composition that is outside scope.

If two classifications are plausible and would create different public APIs, stop and ask.

## 4. Implement through destination primitives

1. Extend the narrowest existing destination API that can express the behavior.
2. Preserve existing consumers unless the request explicitly authorizes migration.
3. Port focused tests alongside behavior. Tests SHOULD assert observable contracts rather than source structure.
4. Keep source-specific product names, environment access, HTTP concerns, and framework dependencies out of shared layers.
5. Avoid compatibility wrappers, duplicate helpers, and silent fallbacks unless the destination already requires them.

## 5. Verify behavioral parity

Compare the finished destination against the adaptation map, not against file similarity.

Verify, when applicable:

1. Default, active, empty, expired, loading, and error states.
2. Keyboard behavior and focus restoration.
3. Direct URL entry, nested routes, and back navigation.
4. Persistence lifetime and storage isolation.
5. Light, dark, collapsed, mobile, and reduced-motion states.
6. Public exports and unchanged existing consumers.
7. Destination-specific typecheck, tests, lint, formatting, build, and release metadata.

Use browser verification for user-facing behavior. Stop task-owned servers after review unless the user is actively reviewing the running page.

</workflow>

<ui-porting>

When the port changes UI colors or theme variables:

1. Read the destination theme contract and the commits that most recently changed it.
2. Use destination semantic role classes such as `border-border` or `text-muted-foreground` instead of source foundation values, legacy numbered tokens, raw colors, inline custom properties, or theme-specific overrides.
3. Reuse a semantic token only when its role matches the element. Do not use a text, focus, or selected-state role merely because its value looks right.
4. If the requested visual value has no matching semantic role, state that clearly. Prefer adding a narrowly named semantic role over bypassing the contract, but treat a cross-system token addition as a design decision when it affects other consumers.
5. Verify the effective value in every supported theme because semantic scopes may remap the same utility.

When the source predates a destination token migration, the migration commit is authoritative. Do not reintroduce the superseded variable style.

</ui-porting>

<quality-checklist>

- [ ] Source behavior and source-specific composition are separated
- [ ] Relevant source and destination history was inspected
- [ ] Existing destination primitives were checked before adding APIs
- [ ] Public API additions are minimal and destination-native
- [ ] Hidden contracts such as routes, storage, focus, and expiry are covered
- [ ] UI uses destination semantic roles without role misuse
- [ ] Tests prove behavior in the destination
- [ ] Validation follows destination repository requirements
- [ ] Out-of-scope migrations remain untouched

</quality-checklist>
