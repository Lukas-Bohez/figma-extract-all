# Changelog

All notable changes to **Extract All**. The format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow the `featureVersion` shown in the plugin's Claude tab and in `figma_status`.

## [19.4.0] - 2026-10-22

### Added

- **`set_prototype` command / `figma_set_prototype` tool.** Puts prototype links between frames: click (or drag, or after a
  timeout) on one frame and go to another, with smart animate. The hover variants that `set_hover` makes are for inside one
  component; this is between screens, so a whole app flow can be shown in Figma. It replaces an existing reaction with the
  same trigger on the same frame and reports per link what it made, or why not.

### Fixed

- **A single-line label no longer breaks in two.** Text that the browser measured as one line now hugs its own width in
  Figma, and centred text is shifted back to the middle of the box the browser measured. A button label like *Pauze* used to
  be rendered as *Pauz / e*, because Figma's Inter is slightly wider than the font the page used. Wrapped text is unchanged.

## [19.3.2] - 2026-10-22

### Fixed

- **Importing a real page no longer fails on an absolutely positioned layer.** The importer marked nodes it had to place
  absolutely by writing `__abs` on the Figma node. Figma nodes are not extensible, so as soon as a page had one such layer
  (a skip-link, a floating badge, a pinned button) the whole import stopped with
  `Could not build the root. FRAME "…": object is not extensible`. The marker is now a `WeakSet` next to the tree, which
  also removes the `delete` on a node property.
- **A single-line label no longer breaks in two.** Text that the browser measured as one line and that is left-aligned now
  hugs its own width in Figma instead of keeping the browser's box. A button label like *Pauze* used to be rendered as
  *Pauz / e*, because Figma's Inter is slightly wider than the font the page used. Wrapped and centred text is unchanged.

### Changed

- `bridge/test/figma-mock.mjs` still does not model node extensibility; the fix above was found by importing a real page.

## [19.3.1] - 2026-10-17

### Changed

- **The published plugin can reach the bridge.** `manifest.json` now lists `http://localhost:3055` and `ws://localhost:3055` in
  `allowedDomains` (they were only in `devAllowedDomains`), so everybody who runs the bridge on their own computer can use
  the Claude tab and all commands with the plugin from the Figma Community, not only with a plugin imported from the
  manifest. Nothing else is reachable: no external servers.

## [19.3.0] - 2026-10-17

### Added

- **`index` on `create` and `create_instance`** (`figma_create`, `figma_create_instance`): puts the new layer at a place in
  its parent (0 = first) instead of always at the end. A layer in the middle of a card can now be replaced on the same
  spot without making the layers after it again. An index beyond the end puts it last.
- **`swap_component` command / `figma_swap_component` tool.** Makes instances show another component, or a variant of
  another component set, without placing them again: the place, the size and the text overrides of layers with the same
  name stay. Turns, for example, a text field into a dropdown on the same spot. Refuses a layer that is not an instance
  and an unknown variant, with an explanation.
- **Owner commands** `move_node` (reparent a layer), `add_variant` (add a variant to an existing component set by copying
  one), `set_variant` (switch instances to another variant) and `owner_status`. They are part of the one build (`code.js`):
  nothing extra to install. Every call needs the owner key, which the bridge adds (`FIGMA_OWNER_KEY` or the file
  `~/.figma-extract-all/owner-key`, made by the bridge on its first run); the plugin keeps the first key it sees in
  `figma.clientStorage` and accepts only that one afterwards. The MCP tools `figma_move_node`, `figma_add_variant`,
  `figma_set_variant` and `figma_owner_status` exist where a key exists. Publishing to Figma is not possible from a
  plugin; the README says what to click.
- `figma-call` knows the owner commands and adds the key to them.
- The test mock has `clone`, `insertChild`, `setProperties` and `swapComponent`; 49 new tests for the owner commands
  (`bridge/test/owner.test.mjs`) and 8 for the three changes in this version (`bridge/test/plugin.test.mjs`), all run by `npm test`.

### Changed

- `duplicate` keeps the copy of a layer in an auto layout in the flow, right after the original, instead of giving it a
  position next to it (which a layer in an auto layout cannot use: the copy ended up out of place). Outside an auto layout
  the copy still goes next to the original.
- `package.json` and `featureVersion` are 19.3.0.

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
