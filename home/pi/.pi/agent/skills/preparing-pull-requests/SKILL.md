---
name: preparing-pull-requests
description: Use when preparing, opening, updating, or finalizing a pull request; when asked to create a PR, draft a PR description, push a change for review, attach PR screenshots, or make a branch ready for review. Also use before implementing UI changes intended for a PR so before screenshots are captured in time.
---

# Preparing pull requests

<workflow>

1. Read repository instructions, `CONTRIBUTING.md`, the PR template, and the complete diff against the actual base. Load `git` for Git operations and repository-specific exceptions. Load `gh-stack` only for an existing or explicitly requested stack. Confirm which changes belong to this PR; preserve unrelated work.
2. For frontend application or rendered UI changes, load `pr-screenshots` before capture. Capture existing UI before editing. If implementation already happened, capture the actual base version safely; never label an after screenshot as before. Run the required Agent Browser journey and applicable Playwright assertions after implementation, then obtain required human localhost approval before pushing. Capture the verified after state, including the resulting interaction state. Follow `pr-screenshots` for matched dimensions, scale, crop, both supported themes, and isolated Storybook canvases. New UI needs after evidence only.
3. Before drafting the title or body, load `write-like-justin` and `emil-unslop-writing`. Use the body contract below. For a change whose control flow, data flow, state transitions, or ownership need explanation, load `show-me` and include one small `diff`-fenced sketch. Prefix added and removed lines with `+` and `-` in the first column; keep unchanged context unmarked. Simple changes need no sketch.
4. Run applicable existing checks. Stop on failing checks, missing required screenshots, or missing required human approval. Publish only when the user authorized it. Use GitHub CLI 2.99.0 or later with repeatable `gh --attach` flags and matching local image references in the body. Upload-only assets stay out of Git. Preserve existing issue links and link the PR to the supplied issue.
5. Read back the published PR. Verify the title, body, issue linkage, rendered diff, and every attachment at its final URL. A successful upload command alone is insufficient. Report the PR URL and any remaining blocker accurately. Do not request reviewers, merge, or create issues without the required authorization.

</workflow>

<format>

The body contains, in order:

1. One or two sentences stating what changed and why.
2. One `show-me` diff sketch when the change needs it.
3. The `pr-screenshots` table for frontend changes: Before/After for existing UI, After for new UI, with descriptive alt text and both themes when supported.
4. One line naming the checks actually run and their results.

Keep prose under 120 words, excluding code fences and the screenshot table. Honor required repository-template fields. Use plain sentences, present tense, and Justin's voice. Omit implementation narration, redundant headings, checklists, em dashes, filler, and AI attribution. Never claim an unrun test passed.

</format>

<example>

```markdown
Keeps the selected project after refresh instead of resetting to the first project.

Verified: project-selection tests pass; selected a project and refreshed in the browser.
```

</example>
