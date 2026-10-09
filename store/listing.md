# Figma Community listing — v19.1.0

Copy each field into **Publish new version** in Figma Desktop.
Every claim below was checked against the code of v19.1.0.

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
The open-source version on GitHub includes a local MCP server with 25 tools, so Claude or another AI can read, check and build in your open file, capture web pages and set prototype hover interactions. It only works when you run the plugin from its manifest (Plugins → Development); this Community version has no network access.

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

| # | File | Caption |
|---|------|---------|
| 1 | `screenshots/01-lottielight.png` | Drop a Lottie or Bodymovin JSON file |
| 2 | `screenshots/02-lottiedark.png` | Light and dark theme |
| 3 | `screenshots/03-aiexportlight.png` | Export everything an AI coding tool needs, in one ZIP |
| 4 | `screenshots/04-aiexportdark.png` | AI Export in dark mode |
| 5 | `screenshots/05-aeexportlight.png` | SVGs and positions for After Effects |
| 6 | `screenshots/06-aeexportdark.png` | After Effects Export in dark mode |
| 7 | `screenshots/07-assets.png` | SVG, PNG and JPG at any scale, single or batch |
| 8 | `screenshots/08-rubric.png` | Audit grid, variables, text styles and auto layout |
| 9 | `screenshots/09-build.png` | Import a captured web page as editable layers |
| 10 | `screenshots/10-claude.png` | Developers: let Claude work in your file |

The screenshots are portrait (about 520 × 740). Figma shows carousel media in a
16:9 frame (1920 × 1080), so they will appear with bars on the sides.

## Version notes

```
v19.1.0: Cleaner interface with Lucide icons, fully English Build, Rubric and Claude tabs, and a fixed Bodymovin settings summary.
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
