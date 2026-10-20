---
name: pr-screenshots
disable-model-invocation: true
description: Use when attaching screenshots, images, or videos to GitHub or Azure DevOps issues, pull requests, and comments, especially for before-and-after UI evidence.
---

# PR Screenshots

<overview>
Attach visual evidence directly to the issue, pull request, or comment so reviewers can inspect the result without checking out the branch. GitHub uploads use the native `gh --attach` workflow.
</overview>

<workflow>

1. Capture the before state before changing existing UI. Capture both light and dark themes when the surface supports them.
2. Capture the verified after state in the same themes, viewport, crop, content state, and scroll position.
3. Validate every before-and-after pair with `agent-browser diff screenshot --baseline <before.png>` before upload.
4. Write brief Markdown that names what each image shows. Keep images visible instead of placing them in a collapsed section.
5. Upload with the platform workflow below.
6. Open the published issue, pull request, or comment and verify every image or video renders for reviewers.

## Agent Browser capture

When Agent Browser drives the capture, produce each theme pair in one pass and scope the crop to the changed surface instead of cropping images afterward:

```bash
agent-browser set media light
agent-browser screenshot ./before-light.png
agent-browser set media dark
agent-browser screenshot ./before-dark.png
```

After implementation, recapture the same routes and states, then validate each pair:

```bash
agent-browser set media dark
agent-browser diff screenshot --baseline ./before-dark.png --output ./pair-check-dark.png
```

A dimension-mismatch result means the viewport, device pixel ratio, or crop drifted; recapture rather than resizing an image. Inspect the reported mismatch regions: changes outside the edited surface are unintended regressions to fix or report, not evidence to upload. The generated red-highlight diff image is a validation artifact; do not attach it to the pull request unless it illustrates a finding. Use `--selector <sel>` on `screenshot` capture and `diff screenshot` for element-scoped pairs, including Storybook's `#storybook-root`.

### Full-page captures

Scope the crop to the changed surface whenever possible. When the whole page must be shown, GitHub centers a shorter image vertically inside its table cell, so the tops of a before and after pair misalign. Make both files the same pixel height:

1. Open both states at the same viewport and read `document.documentElement.scrollHeight` in each.
2. In the shorter page only, append bottom-only space up to the taller height, then take both `--full` screenshots:

```bash
agent-browser eval "const d=document.createElement('div');d.style.height=(TALLER-document.documentElement.scrollHeight)+'px';document.body.append(d)"
agent-browser screenshot --full ./after-light.png
```

3. Confirm both files have identical pixel dimensions before upload.

Never add space above the page, because that shifts content and breaks the pair. Padding is an alignment aid, not a way to hide a layout change; the `diff screenshot` check still applies to the unpadded region.

A motion, transition, drag-and-drop, multi-step interaction, loading animation, or timing-sensitive feedback change MUST include a short video with matching theme and viewport state:

```bash
agent-browser record start ./interaction.webm
# perform one focused interaction
agent-browser record stop
ffmpeg -y -i ./interaction.webm -an -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart ./interaction.mp4
```

Start from a settled initial state and stop after the final state settles. Keep the interaction focused enough to review without scrubbing. Upload the MP4 for consistent playback. A recording supplements the required resulting-state screenshot; it never replaces it.

</workflow>

<format>

```markdown
| | Light | Dark |
| --- | --- | --- |
| Before | ![Navigation clipped in light mode](./before-light.png) | ![Navigation clipped in dark mode](./before-dark.png) |
| After | ![Navigation fixed in light mode](./after-light.png) | ![Navigation fixed in dark mode](./after-dark.png) |
```

Before-and-after pairs MUST use the same CSS viewport dimensions, device pixel ratio, browser zoom, `visualViewport.scale`, crop, content state, scroll position, and capture method. Browser zoom and `visualViewport.scale` MUST remain `1`. Matching output image dimensions alone is insufficient because a Retina screenshot can have twice as many pixels as its CSS viewport.

Agents MUST verify each pair's browser metrics before capture and its pixel dimensions before upload. They MUST NOT pass a Retina image's physical pixel dimensions to `set viewport`; browser viewport commands use CSS pixels. Capture and record at device pixel ratio 2 (`set viewport <w> <h> 2`, the task-browser default) so media stays sharp on Retina screens; never downscale a 2x image or video before upload. A mismatch requires recapture, not resizing one image afterward.

UI screenshot sets SHOULD show light and dark variants whenever the surface supports both. UI changes MUST include both themes; if the surface supports only one theme, state that in the pull request. Use HTML only when display sizing is needed:

```html
<img src="uploaded-url" width="600" alt="Navigation with the selected item fully visible" />
```

</format>

<instructions>

## Playground UI Storybook

For `packages/playground-ui`, use Storybook's native **Open canvas in new tab** action for the exact story. This opens the isolated `iframe.html?id={story-id}&viewMode=story` canvas.

PR screenshots MUST contain only the rendered story canvas. They MUST NOT include the Storybook sidebar, toolbar, addon panels, browser address bar, or other Storybook manager chrome. Do not take a full Storybook screenshot and crop the manager UI away afterward.

Set the Storybook background global to Light, open the canvas, and save the light screenshot. Repeat with Dark. Confirm the preview document has the expected `light` or `dark` class before capture.

When capture is automated, use the repository's installed Playwright and save an element screenshot of `#storybook-root` from the canvas-only URL:

```ts
await page.locator('#storybook-root').screenshot({ path: screenshotPath });
```

Use the story's stable rendered state. For an interaction change, complete the interaction in the canvas and capture the resulting state.

## GitHub

GitHub CLI 2.99.0 or later is REQUIRED. Confirm with `gh --version` when the installed version is uncertain.

Use repeatable `--attach` flags with `gh issue create`, `gh issue edit`, `gh issue comment`, `gh pr create`, `gh pr edit`, or `gh pr comment`:

```bash
gh pr edit 123 \
  --body-file /tmp/pr-body.md \
  --attach ./before.png \
  --attach ./after.png
```

Reference each local path in the Markdown body and pass the same path through `--attach`. GitHub CLI rewrites the local reference in place and preserves its alt text. An attached file that is absent from the body is appended at the end.

For an appended image, add alt text after `#` and quote the argument:

```bash
gh issue comment 456 --attach './error.png#Settings form showing a validation error'
```

Images support PNG, JPEG, GIF, WebP, and SVG. Videos support MP4, MOV, and WebM. Video references MUST be the only content in their paragraph to render as a player. Alt text after `#` does not apply to video.

The authenticated GitHub account MUST have write access to upload media. GitHub Enterprise Server does not support this workflow. Images and GIFs have a 10 MB limit. Videos have a 10 MB limit on Free plans and a 100 MB limit on paid plans.

### Format and replace one marked block

`scripts/format.mjs` (vendored from vercel-labs/before-and-after, PolyForm Shield, license beside it; we added `--grid` and the alt flags) formats existing local media and replaces one `<!-- before-and-after:start/end -->` block in the PR body, so redone screenshots never duplicate evidence. It errors on a missing file, whitespace in a path, a path outside the working directory, mismatched pair counts, an incomplete or repeated marker, and a before image paired with an after video.

Run it from the directory that holds the media. `--grid` with a `--label` per theme emits the Light/Dark grid from the format section; `--before-alt` and `--after-alt` set specific alt text. Alt flags are matched to pairs by position, so pass one for every pair or none:

```bash
SCRIPT=~/.agents/skills/pr-screenshots/scripts/format.mjs
gh pr view 123 --json body --jq .body > body.md
node $SCRIPT --grid --body-file body.md \
  --before before-light.png --after after-light.png --label Light \
  --before-alt "Navigation clipped in light mode" --after-alt "Navigation fixed in light mode" \
  --before before-dark.png --after after-dark.png --label Dark \
  --before-alt "Navigation clipped in dark mode" --after-alt "Navigation fixed in dark mode" > next.md
ARGS=(); while IFS= read -r f; do ARGS+=(--attach "$f"); done < <(node $SCRIPT --attach-list \
  --before before-light.png --after after-light.png --before before-dark.png --after after-dark.png)
gh pr edit 123 --body-file next.md "${ARGS[@]}"
```

For new UI, drop the `--before` flags and the grid gets a single Preview row. Without `--grid` each label becomes its own Before/After table, which suits one-theme surfaces. Without alt flags the alt text falls back to generic text such as `Before Light`; always pass specific alt text. With no existing block the script appends one; move it after the opening sentence or sketch and before implementation detail, never into the middle of other Markdown. Read the published body back and confirm no local `./` paths remain inside the block.

### Before and after videos side by side

`gh --attach` does not rewrite local paths inside `<video src>`, so a side-by-side table takes two steps:

1. Upload both videos as own-line references in a temporary PR comment: `gh pr comment 123 --body-file videos.md --attach ./before.mp4 --attach ./after.mp4`.
2. Read the comment with `gh api` and collect the `https://github.com/user-attachments/assets/...` URLs in before, after order.
3. Build the table and edit the PR body: `node $SCRIPT --body-file body.md --before-video-url URL --after-video-url URL > next.md`, then `gh pr edit 123 --body-file next.md`.
4. Read the edited body back and confirm both URLs are present, then delete the temporary comment. Deleting first loses the only copy of the upload if the edit failed.
5. Open the rendered PR and confirm both players load and show controls.

A single after-only video needs no table: use an own-line reference with `--attach`.

Agents MUST use `gh --attach` for supported GitHub media uploads. They MUST NOT commit upload assets to an orphan branch or use browser-cookie upload endpoints as a workaround.

## Azure DevOps

Upload PR images through the attachment REST API with `POST` to:

```text
https://{org}.visualstudio.com/{projectId}/_apis/git/repositories/{repoId}/pullRequests/{prId}/attachments/{filename}?api-version=7.1-preview.1
```

Use `HttpClient` for binary uploads. Use a new filename when replacing an attachment. Reference the full attachment URL in Markdown, and do not commit screenshots to the branch.

</instructions>

<quality-checklist>

- Existing UI has matched before-and-after evidence in light and dark themes when supported.
- Each comparison pair has identical CSS viewport, device pixel ratio, zoom, visual scale, crop, output dimensions, and capture method.
- Playground UI captures contain only `#storybook-root`, with no Storybook or browser chrome.
- Every image has specific alt text.
- Uploaded media comes from the locally verified state.
- Motion and timing changes include a focused MP4 plus a resulting-state screenshot.
- The published body keeps images visible.
- Every attachment renders at the published URL.

</quality-checklist>
