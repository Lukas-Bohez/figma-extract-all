# Extract All — Figma to Anything

> **The most comprehensive Figma extraction plugin. Export SVGs, PNGs, text, variables, styles, components, and metadata — selectively or in bulk, per page or across all pages.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Figma Plugin](https://img.shields.io/badge/Figma-Plugin-18a0fb.svg)](https://www.figma.com/community/)

---

## 📋 What This Plugin Does

Extract **everything** from any Figma file into structured, reusable formats — making it trivially easy to:

- Import designs into **After Effects** (SVGs + metadata)
- Build a **website using AI** (structured JSON + SVGs + PNGs)
- Create **design token pipelines** (variables, styles as JSON)
- Migrate or archive designs (complete data dumps)
- Feed Figma data into any tool, script, or AI system

---

## 🗂 Output Structure (What You Get)

When you run a **Full Extract**, you get:

```
{FileName}_full-extract.json    ← Complete structured data
{FileName}_text.json            ← All text nodes with typography details
{FileName}_text.txt             ← Plain text dump (AI-friendly)
{FileName}_variables.json       ← All design variables (colors, numbers, etc.)
{FileName}_styles.json          ← All styles (paint, text, effect, grid)
{FileName}_components.json      ← All components & component sets
{FileName}_pages.json           ← Page structure & metadata
```

When you export **SVGs/PNGs**, each node becomes an individual file:

```
node-name.svg                   ← Each node as separate SVG
node-name.png                   ← Each node as separate PNG (scalable)
page-name/node-name.svg         ← Page-prefixed when exporting all pages
```

---

## 🎮 How to Use

### 1. Install the Plugin

**Option A — Figma Desktop (recommended):**
1. Download the latest `.zip` from [Releases](https://github.com/Lukas-Bohez/figma-extract-all/releases)
2. In Figma, go to **Plugins → Development → Import plugin from manifest**
3. Select the `manifest.json` file from the unzipped folder

**Option B — From Source:**
```bash
git clone https://github.com/Lukas-Bohez/figma-extract-all.git
cd figma-extract-all
npm install
npm run build
```
Then in Figma: **Plugins → Development → Import plugin from manifest** → select `manifest.json`

If you already cloned the repo into another folder, make sure you run `npm install` and `npm run build` from the folder that actually contains `package.json`.

### How This Plugin Works

The plugin runs in two parts:

1. **Main plugin code (`code.ts` → `code.js`)** reads the current page or selection, walks the Figma document tree, and extracts text, pages, components, variables, styles, and exportable nodes.
2. **UI code (`ui.html`)** handles the buttons, file downloads, progress display, Lottie import/export, and the final ZIP or file assembly.

When you choose an export, the plugin:

- Reads the current page or selected nodes from the open Figma document
- Uses Figma’s local APIs to collect metadata, text content, variables, styles, and component information
- Uses Figma’s export APIs to render SVG, PNG, JPG, or PDF assets
- Sends the generated data back to the UI, which packages it into downloads or ZIP chunks
- Stays local to the plugin runtime unless a specific UI dependency needs to be loaded from a whitelisted external site

For Lottie work, the UI can also import Bodymovin JSON, analyze it, render it to canvas, and place the rendered animation back into the canvas as an image-filled rectangle.

### Permissions & Network Access

This plugin requests `documentAccess: "dynamic-page"` because it needs to read the active Figma document, inspect the current page and selection, and export data from the nodes you choose. In practice, that means it can access the current page tree, local styles, local variables, components, and node export output inside the file you have open.

The only declared network access is `https://cdnjs.cloudflare.com`, which is used to load `lottie_canvas.min.js` in the plugin UI. That library powers the Lottie-to-GIF rendering flow in the import/export tab. The plugin does not send your Figma document contents to that CDN or to any other remote service.

The GitHub link shown in the UI is just a normal external link for convenience; it is not used by the plugin to process or transmit design data.

### 2. Use the Plugin

Open any Figma file, run the plugin, and choose your action:

| Section | What It Does |
|---|---|
| **📊 Data Extraction** | Export JSON/text data — full extract, text only, variables, styles, components, pages |
| **🎯 Selected Nodes** | Export *only* the nodes you've selected in Figma as SVG/PNG/JPG/SVG-code |
| **🗂 Batch Export** | Export *every* node on the current page (or all pages) as SVG or PNG |

### 3. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` / `⌘+Enter` | Full Extract (downloads everything) |
| `Esc` | Cancel ongoing export |

---

## 📦 Export Formats

| Format | Use Case |
|---|---|
| **SVG** | Vector graphics → After Effects, websites, AI tools |
| **PNG** | Raster images at chosen scale (1x–8x) |
| **JPG** | Compressed raster for web/email previews |
| **SVG Code** | Get raw SVG markup as `.svg` text files |
| **JSON** | Structured data for scripts, AI pipelines, database imports |
| **TXT** | Plain text for LLM context, copy-paste workflows |

---

## 🧠 AI-Friendly Design

This plugin is specifically designed to make **AI-assisted development** seamless:

1. **`_full-extract.json`** — Contains *everything*: node tree, text with positions, variables, styles, components, page info. Drop this into any LLM for full design context.
2. **Individual SVGs** — Every visual element as a separate SVG file, named by its Figma node name. Perfect for AI to reference specific components.
3. **Plain text dump** — All text content in one `.txt` file for quick LLM context injection.
4. **This README** — Serves as the navigation map. Any AI can read this file to understand the entire export structure.

### Example AI Prompt

> "Here is my Figma design exported with Extract All. Read `README.md` to understand the file structure. The full design data is in `design_full-extract.json`. All SVGs are in the `svgs/` folder. Build me a responsive React website from this."

---

## 🏗 Architecture (For Developers)

```
figma-extract-all/
├── manifest.json          ← Figma plugin manifest
├── code.ts                ← Main plugin logic (TypeScript → compiled to code.js)
├── ui.html                ← Plugin UI (self-contained HTML/CSS/JS)
├── package.json           ← NPM config & scripts
├── tsconfig.json          ← TypeScript compiler config
├── README.md              ← This file — the AI navigation map
├── LICENSE                ← MIT license
├── .gitignore             ← Git ignore rules
└── node_modules/          ← Dev dependencies (after npm install)
```

### Build

```bash
npm install        # Install TypeScript + Figma plugin typings
npm run build      # Compile code.ts → code.js
npm run watch      # Watch mode for development
```

---

## 🔌 Key Technical Details

### Text Extraction
Extracts every `TEXT` node with:
- Full text content (`characters`)
- Font family, style, size, weight
- Line height, letter spacing
- Text alignment (horizontal + vertical)
- Fill colors, opacity
- Position (x, y), dimensions (width, height)
- Constraints (auto-layout behavior)
- Parent page name

### Variable Extraction
Uses `figma.variables.getLocalVariablesAsync()` to extract:
- Variable name, ID, resolved type
- Values by mode (light/dark etc.)
- Scopes (which properties the variable applies to)
- Code syntax for developer handoff
- Remote status (library variables)

### Style Extraction
Collects all local styles across 4 categories:
- **Paint styles** (colors, gradients)
- **Text styles** (typography presets)
- **Effect styles** (shadows, blurs)
- **Grid styles** (layout grids)

### Component Extraction
Finds all components and component sets with:
- Component name, key, description
- Variant properties (for component sets)
- Parent page location

### Batch Export (SVG/PNG)
- Processes nodes in batches of 20 for performance
- Filters to only exportable node types (frames, groups, shapes, text, etc.)
- Skips hidden nodes (`visible: false`)
- Shows real-time progress with percentage
- Namespacing with page name when exporting across all pages

---

## 🎬 After Effects / Lottie Workflow

The plugin includes a dedicated **After Effects / Lottie Export** section:

1. **Select** the nodes you want to animate/motion-design
2. Click **"Export Lottie JSON Bundle"** — this generates a single JSON file containing:
   - Every selected node as an embedded SVG string
   - Position metadata (x, y, width, height)
   - Page and type information for each layer
3. Use the resulting JSON in After Effects (via Bodymovin), LottieFiles, or any Lottie-compatible tool
4. **Import & Validate** — drag any Lottie JSON file into the validator to see its structure, layer count, and top-level keys

### Lottie Export Bundle Structure
```json
{
  "fileName": "YourFile_lottie.json",
  "exportDate": "2024-07-02T...",
  "source": "FigmaFile",
  "items": [
    {
      "id": "node-id",
      "name": "button",
      "type": "FRAME",
      "pageName": "Page 1",
      "width": 200,
      "height": 60,
      "svg": "<svg>...</svg>"
    }
  ]
}
```

---

## 🚀 Use Cases

| Scenario | What to Use |
|---|---|
| **Import to After Effects** | Lottie JSON Bundle (motion-ready SVGs + positions) or batch SVG + full JSON |
| **Build a website with AI** | Full Extract JSON + all SVGs → feed to LLM |
| **Design token pipeline** | Variables JSON + Styles JSON |
| **Content audit** | Text JSON + Text TXT |
| **Component library docs** | Components JSON + export each component as SVG |
| **Design archive/backup** | Full Extract + all SVGs + all PNGs |
| **Handoff to developers** | Full Extract JSON + selected SVGs + variables |

---

## 📄 License

MIT — see [LICENSE](LICENSE) file.

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run `npm run build` to compile TypeScript
5. Test in Figma (Plugins → Development → Import plugin from manifest)
6. Submit a PR

---

## ⭐ Support

If this plugin saves you time, consider starring the repo on GitHub! It helps others discover it.

---

*Made for designers and developers who want Figma → anything, as easily as possible.*