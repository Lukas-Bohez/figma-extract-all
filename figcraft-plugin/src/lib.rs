//! Rubric audit for FigCraft: the design-rubric check of the Extract All Figma plugin, as a
//! FigCraft WebAssembly plugin.
//!
//! FigCraft runs plugins as sandboxed WebAssembly: no network, no files, no HTML. A plugin acts on
//! the document only through FigCraft's own commands. This one only reads (`permissions.access:
//! "read"`), shows its report in a panel and, when asked, offers it as a Markdown file to save.
//!
//! * [`audit`]  the checks, ported from `rubricAudit()` in the Figma plugin
//! * [`report`] the report as panel notes and Markdown
//! * [`scan`]   a small reader for the big replies (a layer walk must stay inside FigCraft's fuel budget)
//! * [`host`]   the door to FigCraft (real in WebAssembly, a stand-in in tests)

pub mod audit;
pub mod host;
pub mod report;
pub mod scan;

use host::Shell;
use serde_json::{json, Value};

/// Handle one call of the plugin: the first run of the command, or a button of the open panel.
/// Returns the run's result (JSON text); `Err` fails the run, which FigCraft shows to the user.
pub fn dispatch(shell: &mut dyn Shell, input: &Value) -> Result<String, String> {
    let command = input["command"].as_str().unwrap_or("audit");
    if command != "audit" {
        return Err(format!("unknown command \"{command}\""));
    }

    // A button of the panel calls the plugin again, with the event.
    if let Some(event) = input.get("event").filter(|e| !e.is_null()) {
        match event["control"].as_str() {
            Some("close") => {
                shell.close_panel();
                return Ok(json!({ "closed": true }).to_string());
            }
            Some("save") => {
                let report = audit::run_audit(shell)?;
                shell.save_file(
                    "rubric-report.md",
                    "text/markdown",
                    report::markdown(&report).as_bytes(),
                )?;
                return Ok(json!({ "saved": "rubric-report.md" }).to_string());
            }
            _ => {} // "again": audit and show the panel anew
        }
    }

    let report = audit::run_audit(shell)?;
    shell.show_panel(&report::panel(&report))?;
    shell.notify(&report::headline(&report));
    Ok(json!({ "report": report }).to_string())
}

/// The entry point FigCraft calls: the input JSON is in the reply buffer, `0` means success and
/// anything else fails the run (the text given to `set_output` is the error message).
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn figcraft_run(_input_len: i32) -> i32 {
    use host::wasm::{reply, set_output, Figcraft};

    let outcome = serde_json::from_slice::<Value>(&reply())
        .map_err(|e| format!("unreadable input: {e}"))
        .and_then(|input| dispatch(&mut Figcraft, &input));
    match outcome {
        Ok(result) => {
            set_output(&result);
            0
        }
        Err(message) => {
            set_output(&message);
            1
        }
    }
}
