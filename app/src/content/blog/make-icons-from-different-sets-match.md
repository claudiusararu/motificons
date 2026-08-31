---
title: "How to Make Icons from Different Sets Match"
description: "Icons from different open-source sets rarely match by default - different stroke widths, grid sizes and corner rounding. Here is why it happens and how to actually fix it."
pubDate: 2026-08-13
tags: ["icons", "design-systems"]
---

You needed a settings icon and grabbed one from Tabler. Then you needed a bell for notifications and the search result you liked was from Feather. Then a trash icon from Lucide because it was the cleanest one in the results. You drop all three into your header and something is wrong. You cannot quite say what, but it looks like three different designers worked on the same toolbar without talking to each other. Because they did.

This happens to almost everyone who builds with open-source icons, and it is not a taste problem. It is a measurement problem.

## What is actually different

Icon sets look distinct because a handful of concrete numbers differ between them, even when the icons are drawn in a similar overall style.

**Stroke width.** Most outline icon sets use a stroke somewhere between 1.5px and 2px, but they do not agree on which. Put a 1.5px icon next to a 2px one at the same pixel size and the 2px one reads as bolder and closer, the 1.5px one as thinner and further back. Your eye picks up the mismatch before your brain can explain it.

**Grid size.** Icons are drawn on an internal grid - 20x20, 24x24, sometimes 16x16 - and that grid determines how much padding sits around the glyph inside its bounding box. A 24-grid icon and a 20-grid icon rendered at the same output size do not fill the same amount of that box, so one looks like it has more breathing room than the other even though both are "24px icons" on your page.

**Corner rounding.** Some sets round every corner and line cap; others keep hard corners and square caps. A rounded bell next to a square-cornered trash can reads as two different visual languages, not two icons from the same page.

**Optical size.** This is the subtle one. Two icons can share the same stroke width and grid and still look mismatched because the actual glyph occupies a different proportion of its canvas - one set draws generously large shapes, another leaves more empty margin. Nothing in the file metadata tells you this; you only see it once the icons are side by side.

None of these differences are bugs. Each set is internally consistent - every icon within Tabler matches every other icon within Tabler. The mismatch only shows up when you start picking one icon at a time from wherever the best result happens to be, which is exactly what most of us do when the icon you need does not exist in your primary set.

## Why it looks "subtly broken" instead of obviously bad

If the icons were wildly different - a photorealistic icon next to a stick-figure one - everyone would notice immediately and nobody would ship it. The dangerous case is when they are close: same rough style, similar line weight, similar grid. Close enough that it passes a first glance, close enough that a reviewer approves the PR, and then a user spends thirty seconds on the page with a nagging feeling that something is off, without ever being able to point at the exact icon that is wrong. That is worse for a product than an obvious mismatch, because nobody files a bug for "feels slightly cheap."

## The manual fix, and why it does not scale

The direct fix is to open each mismatched SVG and edit it by hand: bump `stroke-width` from 1.5 to 2, adjust the `viewBox` and re-center the path so the optical size lines up, maybe nudge every `stroke-linecap` and `stroke-linejoin` from `miter` to `round` so the corners agree with the rest of your set.

This works, once. The problems start after that:

- It is manual per icon, so it does not survive adding a fourth icon from a fourth set next month.
- Adjusting stroke width on a hand-edited path is not just changing a number - if the path was drawn assuming a specific stroke width, scaling it can distort the shape rather than just thickening the line.
- Nobody remembers which icons were hand-patched six months later, so the next person who touches that file has no idea it is fragile.
- It does nothing for color. If you also want every icon on the same 3-4-color palette, that is a second manual pass on top of the first.

It is a fine one-off fix for one icon in one place. It is not a system, and a product with more than a handful of icons needs a system.

## What normalization actually does

This is the problem Motificons collections are built to solve. Instead of hand-editing each SVG, you build a [collection](/search) of the icons you actually use and pick one of them as the anchor icon - the icon whose look you want everything else to match. The system reads that anchor's fingerprint: its stroke width, its corner and cap behavior, its optical size relative to its own canvas, and its palette. That fingerprint becomes the collection's style profile.

From then on, every icon you add to the collection is retargeted to match the profile on export - stroke width adjusted, optical size aligned so the glyphs feel like they occupy the same amount of space, colors mapped onto the same palette. You are not hand-editing thirty files; you are picking one anchor and letting the rest follow it. Change the anchor and the whole collection re-normalizes.

Collections are free with an [account](/register), which also lifts the daily search limit and gives you an MCP key. The engine behind them is genuinely more than a converter: normalizing a stroke without warping the path, or aligning optical size across sets with wildly different internal grids, takes real per-icon computation, not a global multiply.

## What normalization cannot fix

It would be dishonest to imply this solves everything, so here is what stays out of scope even with a well-chosen anchor:

**Filled versus outline.** If your anchor is an outline icon and the icon you are adding only exists as a solid fill, normalization will not invent an outline version for you. Stroke retargeting assumes there is a stroke to retarget. Converting a filled glyph into a convincing outline (or the reverse) is a much harder, more subjective problem - effectively a redraw - and it is not something the engine attempts.

**Different corner language.** Rounding a straight-cornered icon's outer bounding box is straightforward. Rounding the internal geometry of a complex glyph - the notch in a bell, the teeth of a gear - without changing what it depicts is a different kind of problem, and not every icon's internal detail can be safely rounded without redrawing it.

**Perspective and dimensionality.** A handful of icon sets draw with isometric or pseudo-3D perspective. Those do not normalize against a flat 2D anchor in any way that preserves their meaning - mixing a perspective icon into a flat set is a design decision to make before you add it to the collection, not something normalization should paper over.

The honest way to think about it: normalization fixes the measurable stuff - stroke, size, color - that was never a deliberate style choice in the first place, just an accident of which set an icon happened to come from. It does not fix a genuine style incompatibility, because that is not a bug to normalize away, it is a sign the icon does not belong in that collection.

If you have a header full of icons that almost match and you cannot say why they don't, that is usually a stroke-width or optical-size mismatch, not a taste problem - and it is worth checking before you spend more time picking a "better" icon that will have the exact same issue.
