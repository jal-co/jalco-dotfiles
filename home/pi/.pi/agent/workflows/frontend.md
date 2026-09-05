# Frontend workflow

Read before frontend implementation or browser verification. Use `agent-browser` for journeys and the project's existing browser assertions. Follow `preparing-pull-requests` before changing UI intended for a PR so before evidence exists.

## Verification

- Agent-run browser testing is a required completion stage for every frontend change and MUST happen after implementation, before human localhost review, after-state pull request screenshots, or delivery
- Frontend interaction testing MUST use Agent Browser for user-journey verification and Playwright for repeatable browser assertions whenever the changed behavior can be automated
- MUST report the exact route, journey, assertions, browser errors, failed requests, and result; MUST NOT mark frontend work complete while the Agent Browser pass or applicable Playwright assertions are missing or failing. If Playwright automation does not apply, report why

Playwright tests MUST use the repository's installed version when available; otherwise use `/Users/justin/.pi/agent/browser-testing/dia.mjs` without adding a repository dependency.

## Personal Dia session

The attachment instructions in this section apply only when using Dia. Use the isolated alternative below when Dia is unavailable or the test requires another viewport or a clean context.

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

## Isolated alternative

- If Dia CDP is unavailable, Agent Browser SHOULD use its managed Chrome and Playwright SHOULD launch its installed isolated Chromium; MUST ask before restarting Dia
- Tests that require an isolated browser context, deterministic clean state, unsupported CDP features, or parallel sessions SHOULD use the isolated browser fallback and report it

## Local authoring

- For React interface work with tunable motion, timing, spacing, color, shadow, blur, scale, layout, or other visual parameters, SHOULD use DialKit during local iteration when the project can support it
- MUST load and follow the `interface-craft` DialKit guidance before adding controls; coordinated sequences, clips, markers, or scrubbing MUST use the DialKit timeline guidance
- MUST inspect the project's package manager, installed DialKit version, application root, and animation system before wiring controls
- MUST ask before adding or upgrading DialKit or another animation dependency
- DialKit is an authoring surface: once values are approved, MUST transfer them into the application's production animation or styling system and remove temporary panels, timelines, and instrumentation unless the user explicitly asks to ship them
- Final interaction testing and pull request screenshots MUST use the production values with authoring controls hidden or removed

## Human review

- When asking the user to review a running localhost route and `SUPERSET_WORKSPACE_ID` is set, MUST open that exact URL with `~/.pi/agent/superset/open-url <url>` before writing the handoff so it is already showing in the workspace browser pane; outside Superset, MUST include the URL in the handoff and MUST NOT launch the user's browser

- In Mastra repositories, follow `mastra-work`: obtain Justin's localhost approval before pushing, opening a PR, deploying, or marking UI work complete.
