# Recorded smoke checks

Checked 2026-10-22 on the local Mac. These are narrow access and asset checks, not a curated recommendation set or a guarantee of future access. No canvas or account writes were made.

## Existing workflow

`pi/agent/prompts/paper-variants.md` already owned a Mobbin reference-gathering step. It resolves to `/Users/justin/dev/agent-contracts-justin/prompts/paper-variants.md`, outside this task's repository. An attempted link-back edit was reversed after detecting that boundary. The prompt remains unchanged; invoke `find-references` directly for the reusable multi-source workflow. No existing standalone finder was found in the inspected local skill directories. The inspected `create-canvas` skill builds live component canvases and is not a reference finder. It and all vendor skills were left unchanged.

## Mobbin: supported through existing MCP

- `search_screens` with `query="pricing page"`, `platform="web"`, `mode="standard"`, `limit=1` returned [Later](https://mobbin.com/screens/9aa8bab1-cf72-4f74-a1fa-54e4ed763f1e).
- Downloaded the returned high-resolution `image_url` through its short-link redirect. `file` and `sips` decoded WebP, **1920 × 1320**. Inspected the downloaded image: three pricing cards and a billing-period toggle, with Mobbin attribution intact.
- Evidence file: `/tmp/reference-finder-smoke/mobbin.webp`. The temporary URL is not a permanent citation. No usage notice was returned for this call.
- Not tested: flow/section retrieval, expired-link recovery, or signed-out MCP behavior.

## Pinterest: public item retrieval supported; signed-out search limited

- Web search for `site:pinterest.com/pin/ pricing page design` found [Pricing Calculator Ilustration](https://in.pinterest.com/pin/653514595963491729/), alongside `/ideas/` pages. The image is an isometric calculator illustration, not a pricing screen. This demonstrates why search text alone is insufficient.
- Isolated browser navigation rendered that pin's title and image. Public HTML exposed its `images_orig` URL: `https://i.pinimg.com/originals/72/1a/fe/721afe854552155b814c40bf3b92d6c5.png`. Downloaded and visually inspected the **1000 × 750 PNG**. The visible Open Graph preview was only 736 × 552 JPEG.
- The pin exposed [the creator's Dribbble shot](https://dribbble.com/shots/5639736-Pricing-Calculator-Ilustration). That outbound page was not opened, so creator-site access and its own original file are unverified.
- Important provenance failure: the pin declared [a different pin](https://www.pinterest.com/pin/connected-virtual-city-part-1--265219865542503577/) as canonical. Opening it showed another title and image hash. The declared canonical was rejected; the original visited pin permalink above is the provenance link for this asset.
- `/search/pins/?q=pricing%20page%20design` loaded filters and pin buttons but also a login modal. Complete signed-in search is **not verified**. No cookies were imported and no account actions were taken.
- Evidence files: `/tmp/reference-finder-smoke/pinterest.png`, `pinterest-dom.json`, and `pinterest.html`. Public original retrieval on this pin does not establish access to every pin or private board.

## recent.design: public browse and high-resolution rendition supported

- The public homepage exposed category buttons and item links without login. A site-scoped web search returned sparse general pages; no home-feed text-search control appeared in the inspected snapshot.
- Opened [Neon Marker Scrawls](https://recent.design/i/42s4ob5-neon-marker-postcard-scrawls). The item advertised 480, 720, 1200, and 2048-pixel image renditions in `srcset`.
- Downloaded `https://cdn.recent.design/items/42s4ob5/0/image/7d0adadd8e95c89e60a7/2048.webp`. `file` and `sips` decoded **2048 × 2720 WebP**. Visual inspection showed orange lettering on a printed postcard. This is the largest advertised rendition checked, not a verified creator original.
- The page linked [Lee's X post](https://x.com/senssylee/status/2108125563386724451); that external destination was not opened. The detail page's `rel=canonical` incorrectly pointed to the homepage, so the stable `/i/` permalink is retained.
- Evidence files: `/tmp/reference-finder-smoke/recent.webp` and `recent-dom.json`.
- Not tested: original creator media, videos, authenticated features, or exhaustive search.

## Cleanup and repeatability

Pi's installed `loadSkills` loader discovered exactly one `find-references` skill at `~/.pi/agent/skills/design/find-references/SKILL.md`, with no diagnostics for it. Local checks passed for section tag nesting, relative links, whitespace, and absence of em dashes. `git diff --check` passed. The external Paper prompt has no diff. SHA-1 checksums of the three protected modified files and `create-canvas/SKILL.md` matched their pre-task values. Existing sessions can use `/reload`, then `/skill:find-references pricing page references across Mobbin, Pinterest, and recent.design`.

The isolated `reference-finder-smoke` browser session was closed. Files under `/tmp/reference-finder-smoke/` are local temporary evidence and may be cleaned by the OS; use the item links and source procedures to repeat the checks. No image files or temporary page dumps are included in dotfiles.
