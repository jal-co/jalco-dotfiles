---
name: ui-annotation
description: Turn screenshots of a UI into annotated explainers, where short handwritten-style notes in the margins explain the design rationale and thin curved arrows point at the exact element being explained. Use when asked to annotate a UI, explain a design decision visually, make a screenshot walkthrough, review a flow with callouts, or produce a "here is why this interface works this way" image for a team, a doc, or a tweet.
---

# UI annotation

An annotated UI is a real screenshot with the designer's reasoning drawn around it. The screenshot is evidence. The notes are the argument.

The reader should finish knowing why each mechanism exists, not what it looks like. A note that describes the pixels is noise. A note that explains the constraint, the failure it prevents, or the trade it makes is the product.

## Why this exists

Screenshots alone invite opinions about taste. Annotations convert taste into reasoning: this control exists because the alternative caused a specific mistake, this friction is deliberate because the action is destructive. Written at the margin, next to the pixels, with a line pointing at the exact element, the reasoning survives review.

## The reference style

Four to six screens of one flow, laid on a light neutral canvas in a grid. Each note sits **outside** the UI, in the gutters, in a single accent colour, set in a handwritten italic script. A thin curved leader line with a small open arrowhead runs from the note to the exact element it describes. Nothing is drawn over the interface itself.

Elements that make it read as one authored piece:

- **One accent colour**, usually a deep indigo or violet, for both the script and the lines. Never two.
- **Script italic** at one size, roughly 1.5x the body text in the UI, with generous line spacing.
- **Lower-case, fragmentary phrasing.** Two or three short lines, each a clause, no full sentence, no full stop. It reads as margin notes, not as copy.
- **Curved leaders, not straight rulers.** One gentle bezier per note, entering the element from the nearest gutter rather than crossing the screen.
- **A small open arrowhead**, smaller than the line weight suggests, sitting right on the element.
- **Screens keep their own shadow and rounded corners**, unretouched, at a consistent device width across the set.

## What to annotate

Annotate the reasoning a reviewer cannot see in the screenshot. Those fall into four kinds, and a good set uses at least three:

1. **The failure this prevents.** "captures paste events even when not focused, to reduce friction" or "icon and description to minimize mistakes checking the wrong place".
2. **The deliberate trade.** "justify why we're increasing friction by explaining benefit".
3. **The remembered state or hidden mechanism.** "remembers your preference for passcode or authenticator, de-emphasizes the other option going forward".
4. **The next step the UI quietly performs.** "looks up MX records and provides an inbox sniper link to get the code quickly".

What not to annotate: obvious affordances ("this is a button"), implementation detail ("this calls the verify endpoint"), colour or spacing choices nobody asked about, and anything the screenshot already says in words. Two strong notes beat six weak ones. Aim for zero to three notes per screen.

## Method

1. **Capture the screens.** Use the running app in a browser at a fixed device width, one screenshot per state, same width and same zoom across the set, so the grid reads as one flow. Name them by step. If the flow has four states, capture four; do not pad to fill a grid.
2. **Decide the argument before drawing.** Write the notes in plain text first, one line each, and check each is a reason rather than a description. Rewrite any note that a reader could infer from the screenshot alone.
3. **Lay out the canvas.** Neutral background, a grid with gutters wide enough to hold the longest note without shrinking it. Leave outer margin for notes that point inward from the outside edges. The reference is roughly 2:1 landscape, but fit the set rather than forcing a ratio.
4. **Place notes in the gutters.** Never over the UI. A note nearest the element it explains, and the line short. If a note needs a long line, move the note closer.
5. **Route the leader.** A bezier that leaves the note's nearest edge, curves around content rather than through it, and arrives perpendicular to the element's edge. The tip lands on the element, not on the card's outer corner. Two notes never cross.
6. **Compose as HTML and SVG.** Screenshots as images at their natural size, notes as text, leaders as SVG paths with an open arrowhead marker. One accent colour defined once as a variable so the script and the lines cannot drift.
7. **Render at 2x.**

```bash
<chrome> --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1600,900 --screenshot=annotated@2x.png "file://$PWD/annotated.html"
```

8. **Verify each arrow numerically, not by eye.** For every note, confirm the arrow tip lands within a few pixels of the intended element at 1x: measure the element's bounding box in the page and compare it to the path's endpoint. Arrows off by tens of pixels are the most common defect and are invisible at thumbnail size.

## Type and line rules

- Script at one size, one colour, no bolding, no emphasis.
- Line weight thin, roughly 2px at 1x, so it reads as a pencil mark rather than a diagram connector.
- Arrowhead open, about 8px across at 1x.
- Script line height generous, about 1.6, so the note reads as handwriting rather than as a paragraph.
- Keep notes to two or three lines. A four-line note means the idea is two ideas.

## Self-check

- [ ] Every note states a reason, not a description
- [ ] Notes sit outside the UI; nothing is drawn over the interface
- [ ] One accent colour across script and leaders
- [ ] Script italic, single size, sentence fragments
- [ ] One curved leader per note, no crossings, tip on the element
- [ ] Arrow tips verified against element bounds, not eyeballed
- [ ] Screens at consistent width, shadows and radii untouched
- [ ] Zero to three notes per screen, none obvious
- [ ] Rendered at 2x with dimensions confirmed
- [ ] Canvas margins large enough that no note is cramped, and the set reads as one flow
