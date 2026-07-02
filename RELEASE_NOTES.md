## Install Guide

### Option 1: Install from the release .zip (recommended)
1. Download the **Source code (zip)** from this release.
2. Unzip it somewhere on your machine.
3. In Figma Desktop, go to **Plugins → Development → Import plugin from manifest**.
4. Select the `manifest.json` file from the unzipped folder.
5. Done — open any Figma file and run "Extract All".

### Option 2: Install from source
```
git clone https://github.com/Lukas-Bohez/figma-extract-all.git
cd figma-extract-all
npm install
npm run build
```
Then import `manifest.json` in Figma via **Plugins → Development → Import plugin from manifest**.

---

## What's New in v1.1.0

### 🎬 After Effects / Lottie Export
- **Export Lottie JSON Bundle** — Select nodes in Figma and export them as a single Lottie-compatible JSON with embedded SVGs, positions, and dimensions.
- **Lottie Import Validator** — Drag any Lottie JSON file into the plugin to validate its structure.

### 📊 Full Extract Progress
- Full Extract now shows step-by-step progress (text → variables → styles → components → pages).

### 🎨 Improved UI
- Light/dark theme toggle (persisted across sessions).
- Glassmorphism card design, live selection state bar.

### 🔧 Technical
- Real-time selectionchange and currentpagechange listeners.
- Auto-reset isExporting lock for single-shot operations.

**Full docs:** https://github.com/Lukas-Bohez/figma-extract-all#readme