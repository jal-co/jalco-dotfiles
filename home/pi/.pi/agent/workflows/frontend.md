# Frontend workflow

Read before frontend implementation or browser verification. Use `agent-browser` for journeys and the project's existing browser assertions. Follow `preparing-pull-requests` before changing UI intended for a PR so before evidence exists.

## Verification

- Agent-run browser testing is a required completion stage for every frontend change and MUST happen after implementation, before human localhost review, after-state pull request screenshots, or delivery
- Frontend interaction testing MUST use Agent Browser for user-journey verification and Playwright for repeatable browser assertions whenever the changed behavior can be automated
- MUST report the exact route, journey, assertions, browser errors, failed requests, and result; MUST NOT mark frontend work complete while the Agent Browser pass or applicable Playwright assertions are missing or failing. If Playwright automation does not apply, report why
- For each changed interaction, take `agent-browser snapshot -i` before acting, perform the action, and run `agent-browser diff snapshot`; report the diff as the interaction evidence instead of asserting success without it
- Run `agent-browser a11y --selector <changed surface>` on each changed route and report violations in changed UI; fix them or name each one that stands and why
- For a change that targets rendering or interaction performance, capture `agent-browser vitals` before and after; for React re-render claims, wrap the interaction in `agent-browser react renders start` / `stop` and report the profile
- Prefer `agent-browser batch` for capture sequences so theme switching, navigation, and screenshots run as one ordered unit

Playwright tests MUST use the repository's installed version. If it is unavailable, report that the Playwright pass was not run instead of adding a dependency or attaching to a personal browser.

## Headless browser session

<rules>

- Agent Browser MUST use its managed headless Chromium with a worktree-scoped session so automation cannot cover the user's work or change a personal browser profile.
- Agent Browser MUST NOT use `--headed`, `--cdp`, `--auto-connect`, or `--profile`.
- Playwright MUST launch an isolated headless browser and MUST NOT attach to a running personal browser.
- Authentication that requires visible user interaction MUST stop as a blocker. The agent MUST provide the URL and required action without opening or focusing a browser window.
- Theme-sensitive tests MUST set and verify the requested color scheme before continuing.
- Each task MUST close only its own browser session after verification.

</rules>

## Local authoring

- For React interface work with tunable motion, timing, spacing, color, shadow, blur, scale, layout, or other visual parameters, SHOULD use DialKit during local iteration when the project can support it
- MUST load and follow the `interface-craft` DialKit guidance before adding controls; coordinated sequences, clips, markers, or scrubbing MUST use the DialKit timeline guidance
- MUST inspect the project's package manager, installed DialKit version, application root, and animation system before wiring controls
- MUST ask before adding or upgrading DialKit or another animation dependency
- DialKit is an authoring surface: once values are approved, MUST transfer them into the application's production animation or styling system and remove temporary panels, timelines, and instrumentation unless the user explicitly asks to ship them
- Final interaction testing and pull request screenshots MUST use the production values with authoring controls hidden or removed

## Human review

- When asking the user to review a running localhost route, MUST include the exact URL in the handoff and MUST NOT open or focus a browser unless the user explicitly requests it

- In Mastra repositories, follow `mastra-work`: obtain Justin's localhost approval before pushing, opening a PR, deploying, or marking UI work complete.
