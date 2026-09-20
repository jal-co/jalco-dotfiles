# Frontend workflow

Read before frontend implementation, browser verification, capture, or localhost handoff. Load `agent-browser` and run `agent-browser skills get core --full` before the first browser command. Follow `preparing-pull-requests` before changing UI intended for a pull request so before evidence exists.

## Dedicated browser session

<rules>

All browser automation MUST run in isolated headless Chromium, including screenshots, recordings, exploratory journeys, and repeatable tests. MUST NOT attach to personal browsers, import authentication through Dia, use OS mouse/keyboard control, or silently retry in headed mode. This prevents testing from interrupting Justin's work.

Agent Browser is the default driver. Jev is optional, off after startup or reload, and enabled only when Justin requests it with `/jev-browser on`. It MUST NOT gate direct Agent Browser commands. `/jev-browser off` disables it again. Headless isolation applies in both modes.

</rules>

```bash
BROWSER="$HOME/.pi/agent/browser-testing/task-browser"
"$BROWSER" start <url>
```

The helper uses the `pi-headless` namespace, derives one worktree-scoped session, enables automatic state restore, sets a 1440 by 1000 CSS-pixel viewport and dark color scheme, and stores artifacts outside the repository. It discards inherited browser launch settings, bypasses user/project browser configuration, and rejects headed mode, CDP attachment, personal profiles, custom browser binaries, and launch arguments. Every later browser command MUST use this helper, including read-only inspection and cleanup. MUST NOT bypass a rejected option with a raw CLI, alternate tool, or desktop automation. Set `AGENT_BROWSER_SESSION` to a distinct task name for simultaneous journeys in the same worktree; never use `default`.

For Mastra authentication, use `BROWSER="$HOME/.pi/agent/browser-testing/mastra-browser"`. This helper uses the same isolated launcher and seeds a new session from `~/.agent-browser/auth/mastra-platform.json` when present. If a protected route redirects to login:

1. Run `"$BROWSER" auth-load`, reopen the protected route, and verify authentication.
2. If the seed is missing or expired, stop and request a scoped state file or human login to the isolated session. MUST NOT obtain it by attaching to Dia or request credentials in chat. A review page opened in the personal browser does not authenticate the automation session.
3. After the protected route succeeds, run `"$BROWSER" auth-save`. Auth state MUST remain outside Git with mode `0600` and MUST NOT be printed, inspected, or attached.

When using optional Jev, first prepare the session with the helper and pass `"$BROWSER" session` as `jev_browser.session`. Verify its results through the same helper. Unsupported actions MAY use direct isolated Agent Browser commands; they MUST NOT trigger desktop control.

Playwright assertions MUST use the repository's installed version when available, with headless execution and no `--ui`, `--headed`, `--debug`, `PWDEBUG`, or automatic report opening. Otherwise use `createMastraPage` from `$HOME/.pi/agent/browser-testing/mastra.mjs` for Mastra without adding a repository dependency. That helper always launches isolated headless Chromium with the local auth seed, viewport, and dark color scheme. Assertions belong in repeatable project tests; agents SHOULD NOT manually repeat an already-covered journey on every iteration.

## Mastra shared components

<rules>

- Mastra frontend work MUST default to `playground-ui` components and compose their existing APIs rather than rebuild them locally.
- Agents MUST NOT change existing component token definitions, values, or assignments without Justin's explicit authorization for that token change. A general request to improve, restyle, extend, or fix UI is not authorization. Call-site classes, inline styles, and CSS variable overrides MUST NOT bypass this boundary.
- If existing composition, slots, and semantic variants cannot support the requested UI, extend the appropriate shared component while preserving its token contract and behavior for other consumers.
- Create a new shared component when the same UI is needed in multiple actual locations and extending an existing component would give it unrelated responsibilities. Keep single-use composition local; do not invent hypothetical reuse.
- If the UI requires changing existing component tokens, stop and ask for that specific change. The goal is improvement of a composable design system across consumers, not independent styling fixes on each page.

</rules>

## Coverage

Agent-run browser testing is required for every frontend change and MUST happen after implementation, before human review, pull request evidence, or delivery.

For each changed route or component, verify:

- The primary user journey at 1440 by 1000.
- The changed interaction from initial state through resulting state.
- Keyboard operation and visible focus for changed controls.
- A 390 by 844 mobile viewport when the surface is responsive.
- Light and dark themes when the surface supports both.
- Loading, empty, error, disabled, or overflow states when the change can affect them.

Use Agent Browser for user-journey verification and the project's Playwright tests for repeatable assertions whenever behavior can be automated. If Playwright does not apply, report why.

For every changed interaction:

1. Run `"$BROWSER" snapshot -i` before acting.
2. Perform the interaction using current refs.
3. Wait for the expected URL, text, element, or network state.
4. Run `"$BROWSER" diff snapshot` and report the meaningful change.
5. Inspect `"$BROWSER" errors` and relevant failed requests.

Run `"$BROWSER" a11y --selector <changed-surface>` on every changed route. Fix violations in changed UI or name each one that remains and why. For rendering or interaction performance work, capture `vitals` before and after. Wrap React interactions in `react renders start` and `react renders stop` when the claim concerns rerenders.

## Capture quality

Before screenshots or recording, run:

```bash
"$BROWSER" ready
```

This waits for network activity, fonts, and images, then reports the actual viewport and device pixel ratio. Wait separately for any application-specific settled state.

Human-facing screenshots MUST:

- Use lossless PNG.
- Use stable realistic data and the exact review route.
- Exclude browser chrome, debug panels, selection overlays, and annotation labels.
- Include one viewport screenshot for context and one selector-scoped screenshot of the changed surface when that crop helps review.
- Preserve identical viewport, theme, data, scroll position, and crop across before-and-after pairs.
- Be inspected at full resolution before upload. Recapture blurry, clipped, sparse, or excessively tall images instead of resizing them afterward.

Annotated screenshots are debugging artifacts for agents and MUST NOT be used as review evidence. Prefer a focused viewport over a full-page capture. Use `--full` only when page-level composition is the subject of the change.

## Motion evidence

A change to animation, transitions, drag and drop, multi-step interaction, loading motion, or timing-sensitive feedback MUST include a short video plus the resulting-state screenshot.

```bash
ARTIFACTS="$("$BROWSER" artifacts)"
"$BROWSER" record start "$ARTIFACTS/interaction.webm" --cursor --contact-sheet
"$BROWSER" wait 400
# perform one focused interaction
"$BROWSER" wait 700
"$BROWSER" record stop
"$BROWSER" video-mp4 "$ARTIFACTS/interaction.webm" "$ARTIFACTS/interaction.mp4"
```

Start recording from a settled initial state. Show one focused interaction, add only enough pause to make cause and result legible, and stop after the final state settles. Inspect the generated contact sheet for brief intermediate states that before-and-after screenshots miss. The MP4 MUST use H.264 with `yuv420p` for review compatibility. Also verify the interaction with reduced motion enabled and report the result. Video supplements assertions, contact sheets, and screenshots; it does not replace them.

## Local authoring

For React interface work with tunable motion, timing, spacing, color, shadow, blur, scale, layout, or other visual parameters, SHOULD use DialKit during local iteration when the project can support it.

- MUST load and follow the `interface-craft` DialKit guidance before adding controls.
- MUST inspect the project's package manager, installed DialKit version, application root, and animation system before wiring controls.
- MUST ask before adding or upgrading DialKit or another animation dependency.
- Coordinated sequences, clips, markers, or scrubbing MUST use the DialKit timeline guidance.
- Once values are approved, MUST transfer them into the production implementation and remove temporary panels, timelines, and instrumentation unless Justin explicitly asks to ship them.

Final interaction testing, screenshots, and video MUST use production values with authoring controls hidden or removed.

## Human review and cleanup

Before asking Justin to review, prepare the exact localhost route in the headless session and include that URL in the handoff. When an opinion or sign-off is needed, agents MAY open that URL in the background with `"$HOME/.pi/agent/browser-testing/task-browser" review <url>`, which uses macOS `open -g`. MUST NOT activate the browser, switch apps, resize windows, or automate the review tab. If background opening is unavailable, share the URL instead. Opening a review page is not approval. Report the tested viewport matrix, journey, assertions, browser errors, failed requests, accessibility result, screenshots, and video when required.

In Mastra repositories, follow `mastra-work`: obtain Justin's localhost approval before pushing, opening a pull request, deploying, or marking UI work complete.

After review evidence is uploaded or no longer needed, close the worktree session with `"$BROWSER" close`. Remove task-owned temporary artifacts. Do not close other Agent Browser sessions or user-owned browser processes.
