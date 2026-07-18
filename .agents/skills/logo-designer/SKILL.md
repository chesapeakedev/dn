---
name: logo-designer
description: Design, critique, refine, and deliver distinctive logo systems. Use when creating a logo, logomark, wordmark, monogram, app or repository icon, responsive logo family, identity lockup, or production-ready SVG/PNG logo assets; when improving an existing logo; or when evaluating logo concepts for conceptual fit, distinctiveness, scalability, typography, color, and category clichés.
---

# Logo designer

Treat logo design as identity work, not as a one-shot image prompt. Preserve the
user's facts, desired qualities, and exclusions while supplying the process and
production guardrails they should not need to specify.

Read [research.md](references/research.md) when choosing among competing design
principles, explaining a recommendation, or reviewing an existing mark.

## Establish the brief

Separate the input into:

- **Identity:** exact name, required text, pronunciation, and existing assets.
- **Offering:** what the product or organization actually does.
- **Audience and context:** who encounters it and where.
- **Desired perception:** three prioritized qualities and their opposites.
- **Distinctive facts:** origin, behavior, mechanism, history, or point of view.
- **Applications:** smallest digital use, primary layout, light/dark surfaces,
  print, motion, and other required contexts.
- **Constraints:** required elements, forbidden elements, colors, licensing, and
  compatibility requirements.
- **Competitive field:** adjacent marks and overused category symbols.

Ask no more than three high-leverage questions when missing information would
materially change the direction. Otherwise, state narrow assumptions and
continue. Prefer concrete tradeoffs such as `quiet rather than energetic` over
adjective piles such as `modern, clean, bold, timeless`.

## Explore concepts before rendering

Develop three to five genuinely different conceptual territories in words. For
each territory, state:

1. One organizing idea.
2. The visual mechanism, without prescribing decoration.
3. Its connection to the brief.
4. Its likely distinctiveness within the category.
5. Its main failure risk.

Vary metaphor distance deliberately: literal, suggestive, and abstract can all
be valid. Do not merge territories into a compromise. Obtain the user's
selection before polishing when practical; if the user delegates selection,
choose one and explain the tradeoff briefly.

Keep one dominant idea per mark. A monogram, transformation, product symbol, and
visual metaphor are not four requirements to superimpose. Suggest a useful
property instead of diagramming the entire product.

## Screen clichés

Inventory the obvious symbols and visual conventions in the category before
generation. Treat them as risks, not automatic bans. Reject an obvious device
unless the concept transforms it in a brand-specific way.

Common unearned defaults include:

- blue-purple gradients and generic "technology" palettes;
- swooshes, sparkles, shields, globes, arrows, hexagons, and circuit traces;
- letterforms forced into an unrelated object;
- gratuitous negative-space tricks;
- before/after diagrams presented as marks;
- visual noise used merely to mean complexity;
- mockups, bevels, glow, glass, shadows, and 3D used to disguise weak geometry.

Honor the user's explicit exclusions even when a generator tends toward them. Do
not imitate a living artist, agency, or existing brand.

## Construct the mark

Start in one color. Establish silhouette, proportion, counterspace, and optical
balance before choosing a palette. Simplicity is a reproduction constraint, not
an instruction to remove all character.

Keep symbol and typography separable during exploration. Do not rely on an image
model for exact text. Typeset or draw the wordmark deterministically, and verify
every glyph. Do not redistribute or outline fonts without confirming that the
license permits it.

Use image generation for divergent visual exploration when it adds value. Treat
generated raster output as concept art, not as a production master. Reconstruct
the selected simple geometry as clean SVG; retain a raster master only when the
requested identity intentionally depends on raster texture.

Do not present a stationery, wall, device, or merchandise mockup as the primary
logo artifact. Show the flat mark first.

## Apply hard gates

Reject or revise a concept that fails any applicable gate:

- **Brief:** conveys the prioritized perception and violates no constraint.
- **Focus:** has one dominant idea and a coherent visual hierarchy.
- **Distinctiveness:** does not collapse into a stock or category-generic mark.
- **Meaning:** works without requiring a paragraph of hidden-story explanation.
- **Typography:** contains exact, legible text with deliberate spacing.
- **Silhouette:** remains identifiable as a solid one-color shape.
- **Small use:** preserves essential features at the required minimum size; test
  at 16, 24, 32, and 64 px when the mark may be an app, CLI, or repo icon.
- **Contrast:** has usable positive and reversed versions on light and dark
  surfaces; do not use color as the only structural distinction.
- **Geometry:** has intentional curves, joins, spacing, and optical balance.
- **Production:** has a tight view box, transparent background where needed, no
  accidental raster embedding, and no unexplained clipping or filters.
- **Originality:** has been compared with relevant competitors and obvious
  visual matches. Describe trademark screening as preliminary, never legal
  clearance.

Use reduction sheets, monochrome proofs, silhouette comparisons, and blurred or
one-second views as diagnostic heuristics. Do not turn their results into
pseudo-scientific scores.

## Refine without averaging

Critique the concept against the brief and hard gates. Make one targeted change
per iteration so the reason for improvement remains visible. Preserve the
selected concept's organizing idea; do not add rejected territories back into it
to satisfy every association.

When editing an existing logo, list invariants before changing it. Preserve
recognition-bearing geometry unless the user explicitly authorizes a redesign.

## Deliver a usable system

Match the deliverables to actual applications. For a new general-purpose logo,
provide when relevant:

- primary horizontal or vertical lockup;
- compact mark for square and small-use contexts;
- wordmark and symbol as separate assets;
- full-color, one-color, and reversed variants;
- SVG masters with PNG exports at requested sizes;
- clear-space and minimum-size guidance;
- a short rationale describing the single organizing idea;
- exact palette values and any typography dependencies.

Keep source artwork editable. Verify final files by opening or rendering them,
and report the saved paths. Never claim an image is vector merely because it has
flat colors or a `.svg` extension.
