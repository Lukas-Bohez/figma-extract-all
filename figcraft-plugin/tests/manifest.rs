//! The plugin folder must import as it is: FigCraft's "Import plugin from manifest" reads the
//! manifest and then the module it names, from the same folder. A clone of the repository has to
//! hold both (a clone once had the manifest but not the module, and the import failed).

use serde_json::Value;
use std::{fs, path::PathBuf};

fn folder() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn json(name: &str) -> Value {
    let text = fs::read_to_string(folder().join(name)).unwrap_or_else(|e| panic!("{name}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name} is not JSON: {e}"))
}

#[test]
fn manifest_json_is_a_copy_of_figcraft_plugin_json() {
    assert_eq!(
        json("manifest.json"),
        json("figcraft-plugin.json"),
        "run `node build.mjs`: it copies figcraft-plugin.json to manifest.json"
    );
}

#[test]
fn the_module_the_manifest_names_sits_next_to_it() {
    let manifest = json("manifest.json");
    let main = manifest["main"].as_str().expect("main");
    assert!(
        main.ends_with(".wasm") && !main.contains('/'),
        "main must be a .wasm in the same folder, got {main}"
    );
    let bytes = fs::read(folder().join(main)).unwrap_or_else(|e| {
        panic!("{main} is not next to manifest.json ({e}): run `node build.mjs` and commit it")
    });
    assert_eq!(
        bytes[..4],
        [0x00, 0x61, 0x73, 0x6d],
        "{main} is not a WebAssembly module"
    );
    assert!(
        bytes.len() < 1_000_000,
        "{} bytes: FigCraft allows modules up to 16 MB, but this one should stay small",
        bytes.len()
    );
}

#[test]
fn the_manifest_says_what_the_plugin_is_and_needs() {
    let m = json("manifest.json");
    assert_eq!(
        m["version"],
        env!("CARGO_PKG_VERSION"),
        "the manifest and Cargo.toml must have the same version"
    );
    assert_eq!(m["id"], "io.github.lukas-bohez.rubric-audit");
    assert_eq!(m["api"], 4, "saving the report needs plugin API 4");
    assert_eq!(m["permissions"]["access"], "read", "the audit only reads");
    assert_eq!(m["permissions"]["saveFile"], true);
    assert_eq!(m["commands"][0]["id"], "audit");
}
