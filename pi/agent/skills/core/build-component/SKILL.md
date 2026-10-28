---
name: build-component
description: Process for building a new UI component or changing an existing one, from scoping and API design through states, stress testing, polish, and the PR. Use when asked to build, add, create, or refactor a component, a primitive, or a reusable piece of UI, in any repository.
---

<overview>
This skill sequences the skills that already own each slice of component work. It adds no rules of its own, so when a step names a skill, that skill decides.
</overview>

<constraints>

- In a `mastra-ai` repository, `mastra-work` governs. Read `~/.pi/agent/skills/work/mastra-work/SKILL.md` first. For a component under `playground-ui/src/ds/`, follow `~/.pi/agent/skills/work/mastra-design/workflows/build-component.md` instead of the steps below.
- MUST search the repository for an existing component, token, or primitive before writing a new one. Extend it when it fits.
- MUST NOT add comments to code, per the global instructions.

</constraints>

<workflow>

1. Scope. State the component in one sentence: what it accepts, what it renders, and where it lives. List candidates and ask when the request spans several components.
2. API. Load `emil-component-design` for composition, controlled and uncontrolled state, and props. Match the nearest existing component's folder shape, naming, and exports.
3. Build. Load `react-best-practices`, and `shadcn` when the project has a `components.json`. Use the project's tokens, primitives, and conventions.
4. Accessibility and forms. Load `emil-touch-and-accessibility`. Load `emil-forms-and-inputs` for any input, button, or submit behavior.
5. States. Read `~/.agents/skills/state-machine/SKILL.md` and render every state the code can reach on a throwaway page.
6. Stress. Read `~/.agents/skills/break/SKILL.md` and render the component under worst-case content. Report what visibly broke and fix it.
7. Polish. Load `emil-ui-polish`, plus `emil-surfaces`, `emil-animations`, `emil-typography`, `emil-color`, or `emil-design-foundations` when the component touches them. Read `~/.agents/skills/variant/SKILL.md` only when Justin wants to explore alternatives.
8. Clean up. Delete the throwaway pages and fixtures, and confirm the diff holds none of them.
9. Ship. Load `git`. For UI intended for a PR, capture the before state before editing.

</workflow>

<verification>

Run the repository's existing typecheck, lint, and tests for the component. Verify the changed behavior in a browser through the frontend workflow at `~/.pi/agent/workflows/frontend.md`, and never claim an unrun check passed.

</verification>
