# Source procedures

<instructions>

## Mobbin

1. Discover the existing `mobbin` tools with `tool_search`. Use `search_screens` for one screen, `search_sections` if exposed for a website section, or `search_flows` for a journey. Read the live schema rather than assuming all three are available.
2. Describe one screen or journey per query and pass the platform separately. Keep `task_intent`, `output_destination`, and any `output_tool` consistent for the task. The destination is what the references will feed next, not the search source. Use `reference_library` only for a save-for-later request, not merely because you download a temporary image.
3. Inspect the returned previews, then download each selected `image_url` when files are needed. It is the high-resolution asset; the inline tool image is only a preview. Follow redirects and check the decoded file type rather than assuming a PNG suffix means PNG bytes.
4. Cite the exact returned `mobbin_url` for every result mentioned. Asset URLs expire after 30 days, so saved work needs downloaded files, not hotlinks.
5. If `ai_usage_notice` is present, show its `text` verbatim as its own block after the results. Do not crop watermarks or remove attribution from downloaded files.
6. Authentication failure blocks Mobbin, not the other sources. Report that `pi mcp login mobbin` is needed; do not change server configuration. An absent tool is unavailable, not an empty search result.

## Pinterest

1. Use `web_search` with `site:pinterest.com/pin/` plus the content or visual idea. Search engines can return `/ideas/` pages despite this query; those are discovery leads, not item citations. Open a concrete `/pin/` result.
2. Alternatively, browse Pinterest search in the isolated browser and inspect its actual results. Signed-out search can load results behind a login modal. Do not remove the modal with DOM edits or treat that as complete authenticated access. Public pin pages and their public HTML may still expose usable metadata.
3. On the selected pin, inspect the main image, `srcset`, Open Graph image, and public embedded pin data. Look for `images_orig` or an equivalent original-image field associated with that exact pin. Related pins and avatars on the same page MUST NOT be mistaken for its image.
4. Use the original URL exactly as supplied. Do not manufacture `/originals/` paths or retain a thumbnail's extension: an original PNG can have JPEG thumbnail renditions. If no original is advertised, choose the largest advertised matching rendition and label it accordingly. Fetch the actual bytes and inspect the image before claiming retrieval.
5. Record the pin permalink and the outbound creator URL separately. A repin is not proof of authorship. Validate `rel=canonical` against the item, since it can point to a different pin. If it fails the match, cite the verified input pin and flag canonical metadata as unreliable.
6. If the needed content is gated, stop that path. For an authorized authenticated read, use only `task-browser auth-import-helium pinterest.com` to copy that domain's existing cookies into the isolated session, then reload. If no usable cookies exist, ask for access only when the blocked content is necessary. Never sign up, save a pin, follow an account, or post a comment as part of finding references.

## recent.design

1. Open `https://recent.design/` in the isolated browser. Use the visible category buttons or the Websites, App Screenshots, and other browse links that fit the brief. Inspect a fresh snapshot rather than hardcoding refs or routes beyond the homepage.
2. `web_search` with `site:recent.design` is a discovery aid, not a full catalog search. The smoke check found no text-search control on the home feed, and search-engine results were sparse. Use browse/category selection when search misses; do not invent a search API or claim exhaustive coverage.
3. Open the item's own link, observed as `/i/<id>-<slug>`. Record it and any creator post or original website link displayed there. Avoid `/go/` sponsor redirects as provenance. A detail page can incorrectly declare the homepage as canonical; retain its verified item permalink instead.
4. Inspect the item's images and `srcset`. Select the largest advertised candidate for the chosen image, not an avatar or a feed thumbnail. The tested detail page advertised 480, 720, 1200, and 2048-pixel WebP renditions. Read the current page instead of constructing those URLs.
5. Call this a `largest advertised rendition`, not the creator's original. Creator files may live elsewhere or require separate access. Video posters are not the motion reference itself; mark motion unverified unless you inspect the video. Do not infer interaction behavior from a still image.
6. If detail media is unavailable, report that limit even when a feed thumbnail loads. Do not replace missing media with an unrelated image from the same page.

</instructions>

<examples>

## Isolated browser inspection

Load the installed `agent-browser` skill and `agent-browser skills get core` before browser use. Give this task a unique session name and reuse it for every command. All browser automation MUST go through the existing wrapper to preserve personal browser state.

```bash
export AGENT_BROWSER_SESSION="references-task-unique-id"
BROWSER="$HOME/.pi/agent/browser-testing/task-browser"
"$BROWSER" open https://recent.design/
"$BROWSER" snapshot -i -u
"$BROWSER" eval --stdin <<'JS'
JSON.stringify({
  url: location.href,
  title: document.title,
  canonical: document.querySelector('link[rel="canonical"]')?.href,
  images: Array.from(document.images).map(image => ({
    alt: image.alt,
    src: image.currentSrc,
    srcset: image.srcset,
    width: image.naturalWidth,
    height: image.naturalHeight
  }))
})
JS
"$BROWSER" close
```

This inspection returns candidates, not an automatic selection. Responsive images can report density-adjusted `naturalWidth`; measure the downloaded file to determine actual pixels.

## Download verification

Set `IMAGE_URL` to the observed asset URL and `OUTPUT` to a new task-owned file. These commands are for public assets; they do not transfer browser authentication.

```bash
curl --fail --location --silent --show-error --max-time 30 "$IMAGE_URL" --output "$OUTPUT"
file "$OUTPUT"
sips -g pixelWidth -g pixelHeight "$OUTPUT"
```

Use the image read tool to inspect the downloaded file. `sips` is available on macOS; elsewhere use an already installed decoder. If decoding is unavailable, report dimensions as unverified instead of installing another dependency. For a failed HTTP download, report the failure and do not treat an HTML error body as image evidence.

</examples>
