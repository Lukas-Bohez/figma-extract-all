## Install Guide

### Option 1: Download from release (recommended)
1. Download **Source code (zip)** from this release.
2. Unzip somewhere on your machine.
3. In Figma Desktop: **Plugins → Development → Import plugin from manifest** → select `manifest.json`.
4. Done — open any Figma file and run "Extract All".

### Option 2: Build from source
```
git clone https://github.com/Lukas-Bohez/figma-extract-all.git
cd figma-extract-all
npm install && npm run build
```
Then import `manifest.json` in Figma.

---

## v2.0.0 — Major Quality Overhaul

### ✨ Rich Data (what was missing before)

| Before (v1.x) | Now (v2.0) |
|---|---|
| Raw RGBA floats (0.545...) | **Hex colors** (#008B9E) + CSS rgba() |
| Mode IDs ("19:0") | **Named modes** ("Light", "Dark") |
| Relative x/y only | **Absolute page position** + parent frame name |
| No parent info | **Full parent path** ("Page > Frame > Group") |
| Empty components.json | Actual component data with dimensions |
| Garbled TXT (emoji) | **Clean safe text** with [icon] placeholders |
| No SVGs in full extract | **ALL SVGs embedded** in JSON + separate files |
| No hierarchy | **Full node tree** in hierarchy array |
| Confusing progress | **8-step progress** with clear labels |

### 🎯 Full Extract now includes:
- **textNodes** — hex colors, parentPath, parentFrame, absoluteX/Y, font details
- **svgs** — every exportable node as embedded SVG with metadata
- **variables** — named modes (Light/Dark/etc.) with hex + CSS values
- **styles** — rich typography data (fontSize, fontFamily, lineHeight)
- **components** — dimensions and child counts
- **pages** — topLevelFrames with width/height/childCount
- **hierarchy** — complete nested tree of every node on the page
- **meta** — plugin version, extraction timestamp, scope

### 📊 Clear Progress
- 8-step progress bar with descriptive labels during Full Extract
- Instant visual feedback: "Text extracted (523 nodes)", "Exporting SVGs (145/287)"

### 📝 Safe Text Dump
- Clean plaintext with metadata headers (font, color hex, position)
- Emoji and special characters safely replaced

**One click, everything you need.™**