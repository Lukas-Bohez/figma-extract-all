//! The line between the audit and FigCraft.
//!
//! The audit only needs to run FigCraft commands (`node.get`, `variable.list`, ...) and, at the
//! end, show a panel or offer a file. [`Host`] and [`Shell`] are those two doors: in WebAssembly they
//! are FigCraft's `figcraft` imports ([`wasm`]), in tests they are an in-memory stand-in
//! (`tests/audit.rs`), so all the logic can run with a plain `cargo test`.

use serde_json::Value;

/// Runs FigCraft commands.
pub trait Host {
    /// Run `command` with JSON `params` (text) and return the raw JSON reply. `Err` carries FigCraft's
    /// refusal or failure text. The layer walk reads these bytes itself (see [`crate::scan`]).
    fn call_raw(&mut self, command: &str, params: &str) -> Result<Vec<u8>, String>;

    /// Like [`Host::call_raw`], with the reply parsed. Meant for small replies: parsing costs fuel.
    fn call(&mut self, command: &str, params: &Value) -> Result<Value, String> {
        let body = self.call_raw(command, &params.to_string())?;
        if body.is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_slice(&body).map_err(|e| format!("{command}: unreadable reply ({e})"))
    }
}

/// Everything the plugin does besides running commands.
pub trait Shell: Host {
    /// A short toast for the user.
    fn notify(&mut self, message: &str);
    /// Show (or replace) the plugin's panel; `spec` is FigCraft's panel spec.
    fn show_panel(&mut self, spec: &Value) -> Result<(), String>;
    /// Close the panel and end the session.
    fn close_panel(&mut self);
    /// Offer a file for the user to save (FigCraft asks where it goes; the plugin never learns a path).
    fn save_file(&mut self, name: &str, mime: &str, data: &[u8]) -> Result<(), String>;
}

/// FigCraft's real host: the functions the app provides to the module `figcraft`.
#[cfg(target_arch = "wasm32")]
pub mod wasm {
    use super::{Host, Shell};
    use serde_json::Value;

    mod ffi {
        #[link(wasm_import_module = "figcraft")]
        extern "C" {
            pub fn call(
                cmd_ptr: *const u8,
                cmd_len: usize,
                params_ptr: *const u8,
                params_len: usize,
            ) -> i32;
            pub fn reply_len() -> usize;
            pub fn reply_read(ptr: *mut u8, len: usize) -> usize;
            pub fn notify(ptr: *const u8, len: usize);
            pub fn set_output(ptr: *const u8, len: usize);
            pub fn ui_show(ptr: *const u8, len: usize) -> i32;
            pub fn ui_close();
            pub fn save_file(
                name_ptr: *const u8,
                name_len: usize,
                mime_ptr: *const u8,
                mime_len: usize,
                data_ptr: *const u8,
                data_len: usize,
            ) -> i32;
        }
    }

    /// The host reply of the last call (when `figcraft_run` starts, it holds the input).
    pub fn reply() -> Vec<u8> {
        let len = unsafe { ffi::reply_len() };
        // No `vec![0; len]`: zeroing the buffer is a loop that costs fuel, and the host overwrites it anyway.
        let mut buf: Vec<u8> = Vec::with_capacity(len);
        if len > 0 {
            // SAFETY: the host copies at most `len` bytes into the spare capacity and returns how many.
            let copied = unsafe { ffi::reply_read(buf.as_mut_ptr(), len) };
            unsafe { buf.set_len(copied.min(len)) };
        }
        buf
    }

    /// The run's result (JSON or text), or its error message when the run fails.
    pub fn set_output(text: &str) {
        unsafe { ffi::set_output(text.as_ptr(), text.len()) }
    }

    fn reply_text() -> String {
        String::from_utf8_lossy(&reply()).into_owned()
    }

    pub struct Figcraft;

    impl Host for Figcraft {
        fn call_raw(&mut self, command: &str, params: &str) -> Result<Vec<u8>, String> {
            let status = unsafe {
                ffi::call(
                    command.as_ptr(),
                    command.len(),
                    params.as_ptr(),
                    params.len(),
                )
            };
            let body = reply();
            if status != 0 {
                return Err(format!("{command}: {}", String::from_utf8_lossy(&body)));
            }
            Ok(body)
        }
    }

    impl Shell for Figcraft {
        fn notify(&mut self, message: &str) {
            unsafe { ffi::notify(message.as_ptr(), message.len()) }
        }

        fn show_panel(&mut self, spec: &Value) -> Result<(), String> {
            let spec = spec.to_string();
            match unsafe { ffi::ui_show(spec.as_ptr(), spec.len()) } {
                0 => Ok(()),
                _ => Err(format!("panel refused: {}", reply_text())),
            }
        }

        fn close_panel(&mut self) {
            unsafe { ffi::ui_close() }
        }

        fn save_file(&mut self, name: &str, mime: &str, data: &[u8]) -> Result<(), String> {
            let status = unsafe {
                ffi::save_file(
                    name.as_ptr(),
                    name.len(),
                    mime.as_ptr(),
                    mime.len(),
                    data.as_ptr(),
                    data.len(),
                )
            };
            match status {
                0 => Ok(()),
                _ => Err(format!("saving the report was refused: {}", reply_text())),
            }
        }
    }
}
