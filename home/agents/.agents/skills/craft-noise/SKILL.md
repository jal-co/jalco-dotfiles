---
name: craft-noise
description: Add or review subtle SVG grain on web interface surfaces without degrading readability or performance. Use when a user asks for noise, grain, texture, gradient banding fixes, a tactile surface, or invokes `/craft-noise`.
metadata:
  source: https://craft.gustavofior.com/noise
---

# Craft Noise

<overview>
Apply Gustavo Fior's SVG turbulence technique as a restrained surface treatment. Noise is a corrective texture for gradient banding or an intentionally tactile visual direction, not a default decoration for routine application UI.
</overview>

<workflow>
1. Inspect the target surface, its stacking context, border radius, themes, and existing styling system.
2. Decide whether noise solves a visible problem. Skip it when the surface is dense, text-heavy, already textured, or merely needs better color and contrast.
3. Reuse an existing project noise asset or filter before adding another. Otherwise add one shared SVG filter and a surface overlay.
4. Start with `baseFrequency="0.8"`, `numOctaves="3"`, grayscale output, `mix-blend-mode: overlay`, and opacity `0.08`.
5. Place content above the overlay so grain does not reduce text or icon clarity.
6. Tune only opacity and `baseFrequency`. Lower frequency creates larger, softer grain; higher frequency creates finer grain.
7. Verify the result in every supported theme and at the surface's real size. Compare with noise disabled and keep it only when the improvement remains visible without reading as dirt.
8. Check scrolling and interaction performance. Replace the live filter with a small static repeating texture when the filtered area is large, repeated, or causes frame drops.
</workflow>

<constraints>
- The grain MUST live on a separate non-interactive overlay. It MUST NOT filter the content tree.
- The overlay MUST use `pointer-events: none` and be hidden from accessibility APIs.
- The surface MUST use `isolation: isolate`; otherwise blend mode changes with unrelated content behind it.
- The overlay MUST inherit the surface's clipping and corner shape.
- Default opacity MUST NOT exceed `0.08`. Values above `0.12` require an explicitly decorative direction.
- Noise MUST NOT be used to disguise insufficient contrast, compression artifacts, or a broken gradient.
- Multiple surfaces SHOULD reference one filter definition instead of duplicating SVG filters.
</constraints>

<implementation>

```html
<svg aria-hidden="true" class="absolute size-0">
  <filter id="craft-grain">
    <feTurbulence
      type="fractalNoise"
      baseFrequency="0.8"
      numOctaves="3"
      stitchTiles="stitch"
    />
    <feColorMatrix type="saturate" values="0" />
  </filter>
</svg>
```

```css
.craft-noise {
  position: relative;
  isolation: isolate;
  overflow: hidden;
}

.craft-noise::before {
  position: absolute;
  z-index: 0;
  inset: 0;
  content: "";
  pointer-events: none;
  filter: url("#craft-grain");
  opacity: 0.08;
  mix-blend-mode: overlay;
}

.craft-noise > * {
  position: relative;
  z-index: 1;
}
```

When the direct-child rule would disturb layout or stacking, add one dedicated overlay element and one content wrapper instead of forcing positioning onto every child.
</implementation>

<quality-checklist>
- Noise addresses visible banding, flatness, or an explicit tactile direction.
- Text, icons, images, focus rings, and controls remain crisp above the overlay.
- Light and dark themes both look intentional.
- Rounded corners clip the texture correctly.
- Hover, scroll, and animation remain smooth.
- Disabling the overlay confirms that noise provides a real improvement.
</quality-checklist>
