# Figma bridge — Claude (and other AIs) in Figma

Local tooling around the **Extract All** plugin:

| | What it does |
|---|---|
| **MCP server** | 42 tools that let Claude read, check and build in your open Figma file — including *seeing* frames as images |
| **Hub** | the local meeting point (127.0.0.1:3055); also plain HTTP for AIs/scripts that don't speak MCP |
| **Capture** | render any web page (React, HTML, localhost or online) in a real browser and turn it into editable Figma layers |
| **Contrast** | measure WCAG contrast of every text layer of a page, against what it actually sits on |

```
Figma plugin UI  <── WebSocket ──>  hub  <── MCP (stdio) ── Claude Code / Claude Desktop / Cursor / ...
  (tab "Claude")                     │
                                     └── HTTP POST /command ── scripts, other LLMs
```

Nothing leaves your machine. The plugin has to stay open while an AI works in Figma.

---

## Setup (once per PC)

```powershell
cd bridge
npm install
```

Needs Node 22+ and Edge or Chrome (for capture/contrast). Then in Figma
(desktop app): **Plugins → Development → Import plugin from manifest…** →
`manifest.json` in the folder above this one.

> The bridge only works when the plugin is loaded **from its manifest**
> (development mode): `localhost:3055` is allowed via `devAllowedDomains`,
> which Figma ignores for published plugins. That is deliberate — the
> published plugin stays network-free.

### Claude Code

The `.mcp.json` in the root of the 2school repo already registers it for that workspace (relative path); reload the
window and approve "figma" once. Elsewhere:

```powershell
claude mcp add figma -- node "C:\full\path\to\figma-extract-all\bridge\bin\figma-mcp.mjs"
```

### Claude Desktop

`%APPDATA%\Claude\claude_desktop_config.json`:

```json
{ "mcpServers": { "figma": { "command": "node", "args": ["C:\\full\\path\\to\\figma-extract-all\\bridge\\bin\\figma-mcp.mjs"] } } }
```

### Other AIs / scripts (no MCP)

```powershell
node bin/figma-hub.mjs                               # keep running
node bin/figma-call.mjs status                       # one command
node bin/figma-call.mjs get_node "{\"ids\":[\"1:23\"],\"depth\":1}"
```

or `POST http://127.0.0.1:3055/command` with `Content-Type: application/json`
and body `{"cmd": "status", "params": {}}`.

### Connect

In Figma: open **Extract All**, tab **Claude**, click **Verbinden**. Then ask
Claude things like:

- *"Check my Figma file against the rubric and fix what you can."*
- *"Put http://localhost:5173 in Figma, light and dark."*
- *"Turn the selected frames into a Button component set with variant and size properties."*
- *"Create light/dark colour variables in two layers and bind the cards' fills to them."*

---

## Tools

| Tool | |
|---|---|
| `figma_status` | connected? file, page, selection. Start here. |
| `figma_get_document` | pages and their top-level layers |
| `figma_get_selection`, `figma_get_node` | properties: fills (hex + bound variable name), strokes, radius, auto layout, sizing, text, text style, variant |
| `figma_screenshot` | PNG of layers, returned as an image Claude can see |
| `figma_get_variables`, `figma_get_styles` | collections with modes and values (aliases by name); text/paint/effect styles |
| `figma_rubric_check` | 8px grid, two-layer variables, **how many fills are actually bound to variables**, text styles, generic variant names, auto-layout coverage, off-scale font sizes |
| `figma_create`, `figma_update`, `figma_delete` | frames, rectangles, ellipses, text, SVG; any property incl. auto layout and sizing |
| `figma_create_component`, `figma_combine_as_variants` | components and variant sets with meaningful properties |
| `figma_duplicate` | clone layers; a cloned variant stays in its component set (e.g. to make a `state=hover` variant) |
| `figma_set_hover` | prototype hover: "While hovering → Change to" from the rest variant to the hover variant with the same other properties; reports variants that still lack a hover twin |
| `figma_create_variables`, `figma_bind_variable` | variables with modes and aliases; bind them to fills, strokes, padding, gap, radius… |
| `figma_apply_text_style`, `figma_create_text_styles`, `figma_create_spacing_variables` | typography and the 8px grid |
| `figma_import_layout` | import a captured page from a file or inline |
| `figma_capture_webpage` | URL → Figma, `theme: "both"` gives light and dark side by side |
| `web_contrast_audit` | WCAG AA for every text layer of a page (no Figma needed) |
| `figma_select`, `figma_notify` | point the user at something |
| `figma_get_components`, `figma_create_instance` | list the components, and place **instances** of a component or variant with text overrides (so a design really uses its components) |
| `figma_set_variable_mode` | show layers in another mode of a variable collection, e.g. the Dark mode of the Semantic variables |
| `figma_bind_raw_spacing` | bind raw padding, gaps and corner radii to FLOAT variables by value (8px grid), like `bind_raw_colors` does for colours |
| `figma_cancel` | ask a heavy command that is still running in Figma (after a time-out) to stop with what is done |
| `figma_build` | build a whole tree of layers in one call (frames with auto layout, shapes, vector paths, arcs, SVG, text) with fills, strokes, radius, spacing and text styles bound to variables **by name**; rolls back if anything fails; `replaceByName` makes it repeatable |
| `figma_export` | save layers to disk as PNG, JPG, SVG, PDF or REST JSON. A plugin cannot make a `.fig` (use *File → Save local copy*) |
| `figma_use_file` | several Figma files can be connected at once: list them, choose the one commands go to, or unpin |
| `figma_set_page` | go to a page by name (optionally create it) |
| `figma_set_code_syntax`, `figma_delete_variables` | Dev Mode code syntax per variable; delete variables or whole collections |

## Several Figma files at once

Every Figma window with the plugin open and connected is listed by `figma_status` / `figma_use_file`. A command goes to:

1. the file named in the command (`"file": "my file"` in `POST /command`), else
2. the file you chose with `figma_use_file`, else
3. the only connected file, else
4. **nowhere**: with several files connected and none chosen the hub answers `409` with the file names. Nothing is ever
   built in a guessed file.

The same file connecting again (plugin reopened) replaces its own old window; a different file never does. Each plugin window
shows in the Claude tab whether it is the file Claude works in.

---

## Heavy commands: budget, busy and cancel

Commands that change many layers (`apply_text_styles_auto`, `create_text_styles_bulk`, `bind_raw_colors`, `snap_to_grid`,
`rename_generic`, `dedupe_text_styles`) can take a long time in a large file. The bridge gives up after its time-out, but
**Figma keeps working**, so calling again used to start a second job that piled up behind the first. Now:

- A second call of a command that is still running answers at once with `{ "busy": true, "runningForSeconds": … }`.
- `apply_text_styles_auto` has a time budget (`timeBudgetMs`, default 40 000 ms, `0` = none). It returns what it did and
  `remaining`; call it again until `remaining` is 0. It also reports `ms` and loads each font once, not once per layer.
- `cancel` (`figma_cancel`) asks the running command to stop with what is done.
- `bind_raw_colors` leaves see-through fills alone (a variable cannot hold transparency, so binding turned a dark overlay opaque) and reports them as `skippedTransparent`.

## Capture from the command line

```powershell
node bin/capture.mjs http://localhost:5173 --theme dark --out anchor-dark.json --screenshot anchor-dark.png
node bin/contrast.mjs http://localhost:5173 --theme light      # exit code 1 if anything fails
node bin/make-bookmarklet.mjs                                   # writes bookmarklet.txt
```

Drop the JSON on the **Build** tab. The **bookmarklet** captures whatever is
on screen — useful behind a login, or in a state you clicked your way into.

### What capture converts

- boxes → frames with fill, border (per side), radius (per corner), shadows, opacity, clipping
- flexbox → **auto layout** (direction, gap, padding, alignment, wrap) — only where the result is faithful; otherwise absolute positions
- text → text layers with **styled runs** (a `<strong>` inside a paragraph stays one layer), font weight, size, line height, letter spacing, case, decoration
- SVG → vector layers, with CSS variables / `currentColor` / classes resolved to real colours
- `<img>` → image fills; inputs → their value or placeholder
- any CSS colour (`oklch()`, `color-mix()`, `light-dark()`…) → sRGB

### Honest limitations

- **Not converted:** gradients and background images, `::before`/`::after`
  content, CSS transforms/rotations on HTML boxes (on SVG elements they *are* converted: chart markers keep their
  position), `<canvas>`/`<video>`, iframes. They
  appear as a warning in the result.
- **Auto layout comes from flexbox only.** CSS Grid containers keep absolute
  positions (their children are still frames you can edit).
- **Fonts** Figma doesn't have fall back to **Inter** at the nearest weight.
- **Cross-origin images** without CORS can't be read and become a grey
  placeholder (with a warning).
- A capture is a snapshot of one viewport width. Capture 1440, 1024 and 390
  separately for responsive frames.

---

## Security

- The hub listens on **127.0.0.1 only**.
- **WebSockets ignore CORS**, so any website you visit could otherwise connect
  to `localhost:3055` and pose as the plugin. The hub accepts only origin
  `null` (Figma plugin iframes) and `*.figma.com`; real web pages always send
  their real origin, and that cannot be forged. Add exceptions with
  `FIGMA_BRIDGE_ALLOW_ORIGIN`.
- HTTP commands with an `Origin` header (i.e. from a browser) get **403**, and
  must be `application/json`, which a page cannot send cross-site without a
  CORS preflight this server never approves (**415** otherwise).
- One process owns the port; a second MCP server (a second Claude window)
  forwards to it instead of failing.

## Tests

```powershell
node test/plugin.test.mjs [capture.json]   # compiled code.js in a mock that enforces Figma's runtime rules — 64 tests
node test/bridge.test.mjs [url]            # real MCP client -> server -> hub -> plugin -> code.js — 34 tests
node test/ui.test.mjs [url]                # the real ui.html in headless Edge, against a real hub — 22 tests
```

`test/figma-mock.mjs` enforces what the TypeScript typings can't: text can't be
edited before its font is loaded, `layoutSizing*` only on children of auto
layout, `resize()` ≥ 0.01, ranges inside the text, and the sync APIs that throw
under `documentAccess: "dynamic-page"`.

What the tests **don't** prove: pixel-exact rendering inside real Figma. The
first import of a real page in Figma is the check that remains.
