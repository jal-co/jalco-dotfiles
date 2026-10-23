# PLTFRM-2749 local sizing review

## Scope and review model

Review the current uncommitted server-only launch implementation in `/Users/justin/.t3/worktrees/platform/jal-pltfrm-2749-project-sizing-ui`. The owner’s current handoff supersedes the older worker-sizing scope and records Justin’s UI and interaction approval. No commit or publication is authorized.

The minimum sufficient change exposes fixed server sizes and truthful server-only pricing behind the exact `billing-vnext` flag. Flag-off and unresolved states must not issue new sizing requests. Viewers and customer-cloud users cannot resize. Existing server mutation services remain authoritative for permissions, included capacity and memory-fit rejection. Durable-agent controls and new worker diagram nodes are excluded from this launch.

Readiness should disable submission until the same guard used by the mutation is ready. Confirmation dismissal must restore focus in both normal and reduced-motion modes. Tests should exercise real flag resolution and HTTP boundaries, not replace the guards with booleans.

Review high-risk paths first: query/mutation guards, server read aggregation and prices, settings confirmation, shared dialog lifecycle, and diagram/card behavior. Follow callers and regression tests. Existing owner test logs and browser artifacts are evidence to inspect, not independent test runs. The coordinator does not run repository builds or tests.

This is a context-informed parent review, not a blind or cross-family review. The handoff and changed-file summary were already read before this record.

## Result

No new blocking defect found in the inspected production paths. Server-only scope is reflected in the settings, card, picker and overview changes. New worker controls and worker pricing are absent. The legacy workers branches remain behind the inverse sizing gate.

- `useProjectSizing.ts:13` uses `skipToken` when disabled, unresolved or customer-cloud. The settings wrapper prevents mounting its billing reads while unavailable.
- `useProjectSizingMutations.ts:23-50` shares the same `canResize` result with the form and still guards direct mutation calls. The first-save regression uses a real PostHog client, staggered timers and MSW, asserting zero early writes and exactly one successful submission after readiness.
- `servers/api/src/routes/billing.ts:1041` authenticates the organization and checks the exact hyphenated flag before organization-scoped sizing reads. The read model preserves paid same-size attachments and reports incoherent billing as unknown instead of inventing coverage.
- `ConfirmationDialog.tsx:33-43` makes dismissed content inert and uses the installed dialog unmount action for reduced motion. Regression tests cover mobile and desktop dismissal and focus return. Browser evidence is fixture-based, not a live infrastructure resize.
- The standalone fixture binds to `127.0.0.1:3013`, has no upstream fetch, parses sizing writes with the existing schema and refuses other mutation routes. Its separate Vite configuration does not add a production route.

## Verification evidence inspected

The owner’s current logs show 31 frontend suites / 363 tests and four API suites / 304 tests passing. Formatting passes. The scoped lint log is empty, consistent with the recorded passing command. The anti-slop log reports two retained findings: the outbound fixture JSON serializer and the inherited API test module mock. This is not an all-green anti-slop run. No repository test, build or lint was executed by this coordinator.

Read the saved cold-start contact sheet and the final mobile screenshot. The cold-start sequence shows delayed controls followed by a successful Large resize. The file named `fixed-mobile-light.png` actually depicts dark mode. An earlier `server-only-mobile-light.png` depicts light mode; do not use the final screenshot’s filename as evidence of a new light-mode run. This is an evidence-label discrepancy, not a demonstrated product regression.

The current handoff and decisions ledger record Justin’s final server-only UI and interaction approval. The preview and fixture listeners on ports 5182 and 3013 are stopped. No new process was started for this review.

## Retained boundaries

Base and HEAD remain `509a038588b273d7eb70a87e50129788e79bed1f`, with zero commits ahead of locally recorded `origin/main` and 223 behind it. The checkout is dirty, with the implementation and prototype uncommitted. This review does not establish compatibility with current main. Updating the branch and any commit, push or PR require further authorization.

Live WorkOS refresh, real checkout/provisioning and broad accessibility cleanliness remain unverified. Shared project-card axe findings are not fixed by this task. No tracker change or publication was made.
