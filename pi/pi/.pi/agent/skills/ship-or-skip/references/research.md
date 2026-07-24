# Research playbook

The point of this skill is **realistic** answers. That means doing actual research, not vibes. **Search first; reason only as a fallback.**

<rules>

## Rule of thumb
- If the host agent has web search/fetch tools, the agent MUST use them for every real-world claim below.
- If it does not, the agent MUST answer from training knowledge but MUST prefix each such claim with `⚠️ unverified (from training knowledge — verify this)` and tell the user what to check.
- The agent MUST include source links for anything it searched.

</rules>

## What to research

### Competitors
Find both **direct** (same job, same user) and **adjacent** (different angle, same user, or same job for a different user) players.

Good queries:
- `<problem> software` / `<problem> tool` / `best <category> for <user>`
- `<idea> alternatives` / `<closest known competitor> alternatives`
- `<category> site:reddit.com` (find what users actually complain about)
- `<category> site:news.ycombinator.com` (Show HN posts, Ask HN)
- Product Hunt, G2, Capterra, AlternativeTo for the category
- GitHub for OSS competitors: `<category>` topic search, stars as a rough demand signal

For each competitor capture: **name, link, what they do, pricing, rough strength**, and any obvious weakness/complaint users voice.

### Market size & demand signals
You usually can't get a clean TAM — use **proxies**:
- Search volume / keyword interest (note if you can't measure it precisely)
- Size + activity of relevant subreddits, Discords, communities
- Number and funding of competitors (lots of funded players = real money; zero players = investigate why)
- Job postings or agencies built around the problem (sign businesses pay to solve it)
- Existing products' review counts and pricing (revenue proxy)

### Pricing & willingness-to-pay
- What do incumbents charge, and on what model (seat, usage, flat, freemium)?
- Is the category expected to be free (hard) or are people used to paying (good)?
- Who controls the budget — the user, their boss, or no one?

### "Why now"
- Recent shifts that make this newly possible or newly needed (a platform change, a new API, a regulation, an AI capability, a cost collapse).
- If there's no "why now," say so — it weakens the case.

### Domain & naming availability
Covered in `naming.md`. Search first; the `scripts/check-domain.sh` helper is a best-effort check.

<rules>

## Honesty discipline
- The agent MUST distinguish **found** (with a link) from **inferred** (its reasoning) from **unknown** (say it).
- The agent MUST NOT inflate a market to be encouraging, and MUST NOT dismiss one it did not actually look into.
- If the evidence is thin, the agent SHOULD recommend cheap validation before building and MUST name a specific test (a landing page, 5 customer interviews, a Reddit post gauging interest).

</rules>
