# Figma Community listing — v19.2.0

Copy each field into **Publish new version** in Figma Desktop.
Every claim below was checked against the code of v19.2.0.

---

## Name

```
Extract All: Lottie, AI Export & Design Audit
```

## Tagline (97 / 100 characters)

```
Place Lottie as GIFs, export SVGs, variables and text for AI coding tools, and audit your design.
```

## Description

Extract All gets things in and out of Figma: Lottie animations in, everything an AI coding tool or After Effects needs out, and a design audit on top. It runs entirely inside Figma, with no network access, and the larger exports download as a single ZIP.

**Lottie Import**
Drop a Lottie or Bodymovin JSON file and see what is inside before you use it:
- animation info, layer tree and layer statistics
- a check of the Bodymovin export settings, with warnings and how to fix them
- one click renders it frame by frame into an animated GIF and places it on your canvas

**AI Export**
One ZIP with everything an AI coding tool such as Cursor, Claude, ChatGPT or v0 needs to rebuild your design:
- SVGs of your layers
- text with colors (hex), fonts and positions
- variables (colors also as CSS `rgba()`), styles and components
- the layer hierarchy and a plain text dump

**After Effects Export**
SVGs of your layers plus a JSON with their positions and the text content, so you can rebuild the scene in After Effects.

**Assets**
- export the selection as SVG, PNG or JPG at any scale
- batch-export a page or all pages
- download variables, styles, components and pages as JSON

**Design Audit (Rubric)**
Check a file the way a design reviewer would:
- padding and gaps on a 4/8 px grid
- variables in two layers (base and semantic) with at least two modes, such as light and dark
- how many color fills are actually bound to variables, and which colors are still hard-coded
- local text styles, font sizes off the type scale, generic variant names such as "Property 1" or "Variant2"
- auto layout coverage

It can also add 8 px spacing variables and a text style scale for you. Nothing is overwritten, and Ctrl/Cmd+Z undoes it.

**Build**
Import a captured web page as editable layers: frames with auto layout from flexbox, styled text, SVGs and shadows. Pages are captured with the free capture tool or bookmarklet from the GitHub repository.

**For developers: AI bridge**
The open-source version on GitHub includes a local MCP server with 42 tools, so Claude or another AI can read, check and build in your open file, build whole designs in one call with colours and spacing bound to your variables, export layers as PNG, SVG or PDF, capture web pages and set prototype hover interactions. It works with several open Figma files and always asks which one. It only works when you run the plugin from its manifest (Plugins → Development); this Community version has no network access.

Open source (MIT): https://github.com/Lukas-Bohez/figma-extract-all
Built and maintained by Lukas Bohez. Bug reports and feature requests are welcome on GitHub.

## Category

```
Import & export
```

## Tags

```
lottie, export, svg, after effects, ai, figma to code, design system, variables, audit, gif
```

## Carousel (upload in this order)

Eight 16:9 slides of 1920 × 1080 in `carousel/`. Slide 1 also works as the
thumbnail.

| # | File | Shows |
|---|------|-------|
| 1 | `carousel/01-overview.png` | Name, tagline and the six features |
| 2 | `carousel/02-lottie-import.png` | Lottie Import, light and dark |
| 3 | `carousel/03-ai-export.png` | AI Export, light and dark |
| 4 | `carousel/04-after-effects.png` | After Effects Export, light and dark |
| 5 | `carousel/05-assets.png` | Assets |
| 6 | `carousel/06-design-audit.png` | Design Audit (Rubric) |
| 7 | `carousel/07-build.png` | Build |
| 8 | `carousel/08-claude-bridge.png` | Claude bridge, for developers |

The plugin windows in the slides are the real `ui.html` of v19.1.0, rendered
sharp at 1920 × 1080 in the same states as the screenshots in `screenshots/`
(Lukas's originals, kept as the reference). The Claude slide shows the
connected state and the single log line from `screenshots/10-claude.png`.

To render them again after a UI change: see the usage line at the top of
`make-slides.mjs`.

## Version notes

```
v19.2.0: The Claude tab shows which file the AI works in when several files are open, and no longer reconnects in a loop. Developer bridge: build whole designs in one call, export PNG/SVG/PDF, variables with code syntax, SVG charts keep their positions when a web page is imported. Full list in CHANGELOG.md.
```

---

## What changed compared with the previous listing

The previous listing ("Import Lottie JSON — Extract All for AI") promised
things the plugin does not do. Corrected after checking the code:

| Previous claim | What the plugin actually does |
|---|---|
| Lottie frames become "native, editable Figma vectors" you can restyle | Import renders the animation into an **animated GIF** and places it as an image (`code.ts`, `lottie-gif-rendered` → `figma.createImage`) |
| Extracts "CSS values" | Only color variables get a CSS `rgba()` string (`code.ts`, `info.css`); there is no CSS export |
| Extracted SVGs "drop straight into After Effects" and go back out as a motion scene | The AE export is SVGs plus a position JSON to rebuild the scene by hand |
| Tags `pdf`, `html`, `web` | No PDF export in the interface; HTML/web is only the Build tab, so those tags were replaced |

Not claimed on purpose: the "Lottie JSON Bundle" checkbox in the After Effects
tab only writes a placeholder file (`code.ts`, "Lottie bundle placeholder"),
not a real Lottie export.
