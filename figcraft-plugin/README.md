# Rubric audit for FigCraft

The design-rubric check of [Extract All](../README.md), as a plugin for
[FigCraft](https://github.com/storytold/figcraft): the open-source, native design app (a Figma
alternative written in Rust). It reads the open file and tells you where it falls short of the
rubric, in a panel you can save as Markdown.

> **Not to be confused with** other projects that are also called "FigCraft" (for example a Figma plugin
> with an MCP relay by another author). This plugin is for the Craft-family app at
> [storytold/figcraft](https://github.com/storytold/figcraft).

It is a port, not a copy: Figma plugins are JavaScript, FigCraft plugins are sandboxed WebAssembly. FigCraft's
docs say it plainly: *"Plugins written for other apps (JavaScript plugins) don't run."* So the checks were
rewritten in Rust against FigCraft's own commands. The report has the same keys as the Figma plugin's, so
the two variants can be compared on the same design.

## Install

1. Download `rubric-audit-figcraft-v0.1.0.zip` from the [latest release](https://github.com/Lukas-Bohez/figma-extract-all/releases/latest) and unzip it.
2. In FigCraft: **Plugins ▸ Development ▸ Import plugin from manifest…** and pick `figcraft-plugin.json` in the unzipped folder.
3. Run **Plugins ▸ Rubric audit…** (a plugin with a single command shows up as one item in the Plugins menu).

Needs a FigCraft with plugin API 4 (0.18.1 has it). The panel shows the report; **Save report (.md)** offers
it as a file (FigCraft asks where it goes: a plugin never gets a path), **Run again** re-checks the file.

## What it checks

The same criteria as the **Rubric** tab of the Figma plugin. The rubric's scales are constants at the top of
[`src/audit.rs`](src/audit.rs): change them to your own.

| Check | Looks at |
|---|---|
| **Variables** | collections and modes, variable types, how many variables **alias** another one (a semantic layer on top of primitives), whether the spacing scale `space/1` .. `space/8` exists |
| **Components** | component sets and their properties, and **generic variant names**: a property still called `Property 1`, values like `Variant2` or `Default` |
| **Text styles** | whether the text scale `text/xs` .. `text/3xl` exists, how many text layers have **no** text style, font sizes that are **off the scale** (12, 14, 16, 18, 22, 28, 36) |
| **Auto layout and grid** | how many frames use auto layout, auto-layout frames whose padding or gap is **off the 4px grid**, frames with several children and **no auto layout** |
| **Colour tokens** | how many solid fills are **bound to a variable** and how many are hard-coded, with the most used raw colours |

Read-only: the manifest asks for `access: read`, so FigCraft itself refuses any edit the plugin might try.

## How it differs from the Figma plugin

FigCraft describes a document differently from Figma, so a few numbers are derived differently:

- **Variant properties** come from the variant names (`Style=Primary, Size=Md`), because FigCraft's component
  list has no property definitions. A name without `=` counts as the value of `Property 1`, as in Figma.
- **Bound fills**: FigCraft reports one binding for the first fill (`boundVariables.fill`); further solid fills of the
  same layer count as hard-coded. Paint *styles* do not count as tokens, only variables (as in the Figma plugin).
- **Auto layout** is any layout mode other than `none`, grid included.
- All pages are walked, and the layers inside instances count, as in the Figma plugin.

Not ported, because the sandbox has no network, no files and no HTML, or because FigCraft already does it:
Lottie import (needs a browser canvas), the After Effects / AI exports (FigCraft exports and inspects on its own),
Build (needs the bridge's browser) and the **Claude bridge**: FigCraft ships its own MCP server
(`figcraft-cli mcp`, or `--attach <port>` to drive a running app), so Claude can work in FigCraft without a plugin.

## Limits

FigCraft meters every plugin run at one billion "fuel" (about instructions) and 100,000 host calls.

- Reading a reply with `serde_json::Value` costs about 470 fuel per byte, which ran a 4,000-layer design out of budget.
  [`src/scan.rs`](src/scan.rs) is a small hand-written reader that keeps only the fields the checks need
  and is about three times cheaper overall (it is tested against `serde_json` on 600 random replies and on damaged ones).
- One `node.get` returns a whole level of layers with the requested fields, so the walk costs one command per
  container, not per layer.
- Measured in FigCraft 0.18.1: 348 layers use 37M fuel, 4,282 layers 310M, so about 12,000 layers fit in one run.
  The walk adds up its own estimate and **stops by itself at 850M** with a report that says it is partial
  (`truncated`), instead of letting FigCraft fail the run.

## Build and test

You need Rust with the WebAssembly target: `rustup target add wasm32-unknown-unknown`.

```bash
node build.mjs              # -> dist/rubric-audit/{figcraft-plugin.json, rubric_audit.wasm}  (about 250 KB)
cargo test                  # 23 tests on the host: the checks, the buttons, the reader
node test.mjs <figcraft-cli> <design.figcraft>    # the real plugin in the real FigCraft, see below
```

`cargo test` runs the plugin's logic against an in-memory stand-in for FigCraft (`tests/audit.rs`) and the
reader against `serde_json` (`tests/scan.rs`).

`test.mjs` runs the built `.wasm` in FigCraft's headless CLI (`figcraft-cli run`, the same engine and plugin host as the
app) on the designs you give it, and checks the plugin's numbers against FigCraft's own counts (`node.find`,
`variable.list`, `style.list`, `component.list`), which do not go through the plugin's walk. It also presses the
panel's buttons. On FigCraft 0.18.1 it passes 68 checks on four designs, from 348 to about 13,000 layers.
It was not run through the desktop app's window: the panel was only checked through its spec and the CLI.

The real FigCraft found a bug the stand-in could not: panel notes are single paragraphs and may not hold line breaks.
The stand-in now enforces the same panel rules (control characters, 64 controls, 1,000 characters).

## Layout

| File | What |
|---|---|
| `figcraft-plugin.json` | the plugin's manifest (id, commands, permissions) |
| `src/lib.rs` | the entry point FigCraft calls, and the panel's buttons |
| `src/audit.rs` | the checks |
| `src/scan.rs` | the layer reader (see Limits) |
| `src/report.rs` | the report as panel notes and Markdown |
| `src/host.rs` | the door to FigCraft: the real `figcraft` imports in WebAssembly, a trait for tests |
| `tests/`, `test.mjs` | the tests above |
| `build.mjs` | compiles and puts the module next to its manifest |

MIT, like the rest of the repository.
