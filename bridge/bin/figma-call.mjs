#!/usr/bin/env node
// Send one command to Figma through a running bridge. Handy for scripts and
// for LLMs that can run shell commands but do not speak MCP.
//
//   node bin/figma-call.mjs status
//   node bin/figma-call.mjs get_node "{\"ids\":[\"12:34\"],\"depth\":1}"
//   node bin/figma-call.mjs rubric_check

import { connectRemote, DEFAULT_PORT } from '../src/hub.mjs';

const [cmd, json] = process.argv.slice(2);
if (!cmd) {
  console.log(`Gebruik: figma-call <commando> [json-parameters]
Commando's: status, get_document, get_selection, get_node, screenshot, get_variables,
get_styles, rubric_check, create, update, delete, create_component, combine_as_variants,
create_variables, bind_variable, apply_text_style, create_spacing_variables,
create_text_styles, text_inventory, create_text_styles_bulk, apply_text_styles_auto, cancel, create_instance, get_components, set_variable_mode, bind_raw_spacing, layer_audit, rename_generic, dedupe_text_styles, list_color_variables, bind_raw_colors, snap_to_grid, import_layout, set_selection, notify`);
  process.exit(1);
}
try {
  const hub = await connectRemote({ port: DEFAULT_PORT });
  const result = await hub.send(cmd, json ? JSON.parse(json) : {});
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(e.message.includes('fetch failed') ? 'Geen bridge actief. Start er een met: node bin/figma-hub.mjs' : e.message);
  process.exit(1);
}
