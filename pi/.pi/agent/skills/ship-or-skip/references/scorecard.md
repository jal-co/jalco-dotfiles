# Scorecard rubric

Eight axes, scored **1–5** (5 = best). Every score MUST carry a one-line reason grounded in research or the user's answers — never a bare number. The agent MUST anchor to evidence and MUST say when it is guessing.

> The scorecard is an instrument, not a verdict machine. After scoring, the agent MUST step back and make a **holistic** call (SHIP / SHAPE / SKIP), and MUST explain any time it overrules the composite.

---

## 1. Problem severity
How acute is the pain? Vitamins are nice; painkillers get paid for.

| Score | Meaning |
|---|---|
| 5 | Urgent, recurring, expensive pain people already pay or hack around to solve |
| 3 | Real but mild; a "would be nice" more than a "need this now" |
| 1 | Manufactured problem; users don't feel it |

Probe: *What do they do today instead? How much does the status quo cost them in time/money/risk?*

## 2. Market size / niche viability
Is there enough there to support what you want (side income vs. venture scale)?

| Score | Meaning |
|---|---|
| 5 | Clearly large enough for your goal, with room to grow or expand outward |
| 3 | Workable niche but tight ceiling; viable for a small business, not much more |
| 1 | So narrow it can't sustain the effort |

Note: small and specific can be a strength for a solo/paid product. Calibrate to the user's actual goal, not generic "TAM."

## 3. Competition intensity
**Both extremes are bad.** Too crowded = hard to be heard and undercut on price. Too empty = often no demand.

| Score | Meaning |
|---|---|
| 5 | Healthily contested: real demand, incumbents exist but are beatable/leave a clear lane |
| 3 | Crowded but with an underserved seam, OR thin with plausible latent demand |
| 1 | Dominated by an entrenched free/cheap incumbent, OR a true desert with no signal of demand |

## 4. Differentiation / moat
Why can't the obvious incumbent copy this next quarter?

| Score | Meaning |
|---|---|
| 5 | Durable edge: data, distribution, network effects, deep niche insight, switching costs |
| 3 | A real but shallow edge (better UX, narrower focus) that can be copied with effort |
| 1 | No edge; a thin wrapper anyone could clone in a weekend |

## 5. Willingness-to-pay / monetization
Will the people with the pain actually pay, and is there a clean way to charge?

| Score | Meaning |
|---|---|
| 5 | Clear buyer, clear budget, obvious pricing model; comparable products already monetize |
| 3 | Plausible but unproven; may depend on free→paid conversion |
| 1 | Audience expects it free, or no one with the pain controls a budget |

## 6. Distribution & GTM reachability
Can *you* reach these users repeatably and affordably? Many good products die here.

| Score | Meaning |
|---|---|
| 5 | A concrete, low-cost channel you can access (existing audience, SEO seam, community, integration) |
| 3 | A channel exists but it's competitive or you'd have to build the audience first |
| 1 | No idea how you'd reach buyers; channels are expensive or gatekept |

## 7. Founder-fit / unfair advantage
Why you? Fit compounds; its absence shows.

| Score | Meaning |
|---|---|
| 5 | Strong unfair advantage: domain expertise, audience, prior art (e.g. your OSS), unique insight |
| 3 | Capable but generic — you could build it, but so could many |
| 1 | Outside your strengths/interest; you'd likely lose motivation or get out-executed |

## 8. Name & domain availability *(lighter weight)*
Informs, rarely decides. A great idea with a taken `.com` is a naming problem, not a kill.

| Score | Meaning |
|---|---|
| 5 | Strong name available with a clean domain/handles |
| 3 | Workable name; compromise domain (alt TLD, slight variant) |
| 1 | Crowded/trademark-risky naming space; no reasonable domain |

---

## Presenting the result

```
| # | Axis                         | Score | Why |
|---|------------------------------|-------|-----|
| 1 | Problem severity             | 4/5   | ... |
| 2 | Market size / niche          | 3/5   | ... |
| 3 | Competition intensity        | 2/5   | ... |
| 4 | Differentiation / moat       | 3/5   | ... |
| 5 | Willingness-to-pay           | 4/5   | ... |
| 6 | Distribution & GTM           | 2/5   | ... |
| 7 | Founder-fit / advantage      | 5/5   | ... |
| 8 | Name & domain availability   | 3/5   | ... |

Composite: 3.25/5
Verdict: SHAPE — strong founder-fit and real pain, but distribution is the gap.
To move to SHIP: prove one repeatable channel to reach [buyer] for under $X CAC.
Biggest risk: an entrenched free incumbent ([name]) already owns the workflow.
```

The agent MUST always end with: the **one biggest reason** for the verdict, the **biggest risk**, and — for SHAPE/SKIP — **what would change its mind**.
