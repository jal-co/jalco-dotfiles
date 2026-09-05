---
name: growth-ux-audit
description: >-
  Audit product UI and UX flows for revenue opportunities without disrupting the existing experience. Use when reviewing onboarding, activation, conversion, pricing, checkout, upgrade, expansion, retention, referral, or monetization flows; when asked how a product can increase conversion, revenue, ARPU, retention, or paid adoption with tasteful changes. Read-only: observes the current flow, ranks low-interruption experiments, and protects usability and trust. Triggers on: growth audit, growth engineering, conversion audit, monetization audit, revenue opportunities, improve conversion, increase upgrades, product-led growth, activation, retention, expansion, paywall, upgrade prompt.
---

# Growth UX Audit

<overview>
Audit the product as a growth engineer with design taste. Find the smallest changes that can improve revenue while preserving the product's current interaction model, visual language, and user trust.

This is a read-only skill. The output is a short, evidence-backed audit, not code or a backlog dump.
</overview>

<rules>

- MUST NOT edit source, create files, change analytics, or write to external platforms.
- MUST observe and understand the current flow before suggesting changes.
- MUST tie every recommendation to a revenue mechanism and an observed moment in the flow.
- MUST prefer the least interruptive change likely to work.
- MUST preserve the user's primary task, existing mental model, and established visual language.
- MUST NOT recommend dark patterns, fake urgency, hidden costs, confirmshaming, forced continuity, blocked dismissal, or repeated nagging.
- MUST distinguish observed evidence from hypotheses. Never invent conversion data, user intent, or revenue impact.
- MUST keep the final audit short. Return the top three to five opportunities, not every plausible idea.

</rules>

<workflow>

## 1. Establish the business context

Determine from the repository, product, analytics, pricing, plans, and existing documentation:

- Revenue model and paid value
- Target user and lifecycle stage
- Flow being audited
- Current growth goal and primary metric
- Existing experiments, prompts, limits, and upgrade surfaces

Gather accessible context directly. Ask one focused question only when the revenue model or target flow cannot be inferred safely.

## 2. Experience the current flow

When the product is runnable, use the browser and complete the flow as the target user. Inspect the relevant code when it explains state, eligibility, frequency, or event tracking that the interface cannot show.

Record only what affects the audit:

1. User goal
2. First value moment
3. Monetization moment
4. Existing friction and interruptions
5. Exit, recovery, and repeat-use behavior

Do not judge an isolated screen when the surrounding journey changes its meaning.

## 3. Find revenue opportunities

Look across five mechanisms:

| Mechanism | Question |
| --- | --- |
| Activation | Can users reach meaningful value sooner? |
| Conversion | Is paid value clear when purchase intent is present? |
| Expansion | Does usage reveal a natural reason to upgrade, add seats, or adopt more? |
| Retention | Does the flow reinforce achieved value and make return behavior easier? |
| Referral | Is sharing or collaboration useful enough to create organic acquisition? |

Ignore ideas with no credible path to revenue, even if they might move clicks.

## 4. Use the interruption ladder

Consider changes in this order and stop at the lowest sufficient level:

1. No new UI: remove friction, improve defaults, fix eligibility, or clarify existing copy
2. Existing surface: adjust hierarchy, timing, placement, or value framing
3. Inline addition: add contextual proof, limit visibility, or a quiet upgrade path
4. Persistent addition: add a restrained status, usage, or plan affordance
5. Interruption: modal, gate, takeover, or notification

A level-five recommendation requires strong evidence of user intent, low frequency, easy dismissal, and a clear user benefit. Reject it otherwise.

## 5. Apply the taste and trust gate

A recommendation passes only when all answers are yes:

- Does it help the user understand or reach value?
- Does it appear at a moment related to the user's current intent?
- Can it fit the existing component, copy, and interaction system?
- Does it preserve one clear primary action?
- Is it accessible, reversible, and honest?
- Will repeated exposure remain tolerable for frequent users?
- Can success be measured without sacrificing a trust or usability guardrail?

Read `emil-design-foundations` before finalizing a recommendation that changes visual hierarchy or interaction. Use `emil-ui-review` only when the user also asks for a code-level craft review.

## 6. Rank without fake precision

Rank opportunities by:

1. Revenue potential
2. Confidence in the evidence
3. Design and flow fit
4. Interruption cost
5. Implementation effort

Use High, Medium, or Low. Do not manufacture a numeric score when the inputs are estimates.

</workflow>

<format>

## Verdict

One sentence on the strongest revenue opportunity and the health of the current flow.

## Current flow

Three to six short steps showing where value and monetization occur.

## Opportunities

Return at most five rows:

| Priority | Moment | Smallest change | Revenue mechanism | Interruption | Evidence |
| --- | --- | --- | --- | --- | --- |

Evidence MUST cite an observed route, state, event, or `file:line`. Label unsupported claims as hypotheses.

## Test first

For the top recommendation only:

- Hypothesis
- Smallest viable experiment
- Primary revenue metric
- One usability or trust guardrail

## Avoid

List up to three tempting ideas that would add interruption, conflict with the current flow, or optimize a vanity metric. Omit this section when there is nothing worth warning against.

</format>
