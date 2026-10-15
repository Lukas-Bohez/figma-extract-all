# Changelog

All notable changes to **Extract All**. The format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow the `featureVersion` shown in the plugin's Claude tab and in `figma_status`.

## [19.2.0] - 2026-10-15

> **For Figma Community users:** the Lottie Import, AI Export, After Effects Export, Assets, Rubric and Build tabs work
> as before. Everything below that mentions the bridge, MCP or Claude only exists when you run the plugin from its
> manifest (Plugins → Development → Import plugin from manifest); the published Community plugin has no network access
> by design. What the Community version gets from this release: the Claude tab now tells you which file is the target
> when several files are open, and the plugin no longer fights itself over the connection.

### Added

- **`build` command / `figma_build` tool.** Builds a whole tree of layers in one call: frames with auto layout, rectangles,
  ellipses (with arcs for rings and pies), vector paths, SVG and text. Fills, strokes, corner radius, padding and gap are
  bound to variables by **name** (`fillVar`, `strokeVar`, `vars: { cornerRadius, padding, itemSpacing }`), text takes a
  local text style (`textStyle`). A chart with 200 marks is one round trip. A failed build rolls back everything it made, and
  `replaceByName` makes a build repeatable without piling up copies (the old version is only removed once the new one exists).
- **SVG layers can use variables.** For `kind: "SVG"`, `fillVar` and `strokeVar` bind the paints *inside* the imported
  SVG (icons), and leave the frame itself see-through.
- **`export` command / `figma_export` tool.** Saves layers to disk as PNG, JPG, SVG, PDF or the REST JSON of the layer
  (`dir`, `scale`, `outlineText`). A plugin cannot create a `.fig` file; the tool says so and points to *File → Save local copy*.
- **Several Figma files at once.** The hub now keeps one connection per file instead of letting the newest window replace
  the previous one. With more than one file connected and none chosen, a command is refused with the file names, so
  nothing lands in the wrong file. New tool **`figma_use_file`** (list, choose, unpin) and a per-command `file` for
  scripts (`POST /command {"cmd": …, "file": "my file"}`). `figma_status` lists all connected files. The plugin window
  shows whether it is the file Claude works in.
- **`set_page` / `figma_set_page`**: go to a page by name or id, optionally creating it.
- **`set_code_syntax` / `figma_set_code_syntax`** and **`delete_variables` / `figma_delete_variables`**.
- `create_variables` (and the MCP tool) accept **`codeSyntax`** and **`description`** per variable; `get_variables` returns them.
- `create` accepts **`VECTOR`** (SVG path data: absolute `M L C Q Z`), **stroke caps, joins and dash patterns**, `rotation`,
  `clip` and **`arc`** for ellipses.
- `bind_variable` accepts `cornerRadius` and `padding` and fans them out to the four corners and sides.
- 42 MCP tools (was 36).

### Fixed

- **Two open Figma files made the plugin flip-flop.** Each window kept replacing the other, so a command could land in
  a different file than the one you meant. This is the main reason for the multi-file hub above.
- A plugin window closed because the same file connected from another window no longer reconnects in a loop.
- **Straight vector lines were invisible.** An open path with stroke alignment *inside* draws nothing in Figma; vector
  strokes are now centered by default.
- **Capture (Build tab) of pages with SVG charts.** Elements positioned by a CSS `transform` or `translate` (chart markers,
  icons) all ended up in the top-left corner because the style attribute was discarded; the computed transform is now written
  back as a matrix. SVG text keeps its font family, size, weight and letter spacing (it fell back to 16 px). Invisible hit
  areas and `<title>`/`<desc>` no longer clutter the result.

### Changed

- Bridge documentation lists the real number of tools (it said 30 and 25).
- `package.json` and `featureVersion` are 19.2.0.

### Tested

`npm test`: plugin test 94 passed, bridge test 47 passed (real compiled `code.js` against a Figma mock, real MCP client against
the hub). Also verified in Figma Desktop: the build command (fifteen frames, about 2,300 layers, 1,431 fills bound to variables), vector strokes,
arcs, dash patterns, SVG paint binding and variable modes (Light/Dark) on a frame.

## [19.1.0]

Lucide icons, English Build, Rubric and Claude tabs, honest note about the bridge, fixed Bodymovin settings summary.
Bridge additions after 19.1.0: bulk text styles, colour binding, grid snapping, layer audit, `rename_generic`,
`create_instance`, `get_components`, `set_variable_mode`, `bind_raw_spacing`, heavy-command budget/busy/cancel.

Older releases: see the tags (`v5.0.0` … `v19.1.0`) and `RELEASE_NOTES.md`.
