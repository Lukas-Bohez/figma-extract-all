//! Turns the audit's report (JSON) into text: the sections of the panel and the Markdown file.
//! Both come from the same [`sections`], so they always say the same.

use crate::audit::{SPACING_SCALE, TEXT_SCALE};
use serde_json::{json, Value};

pub struct Section {
    pub title: &'static str,
    pub lines: Vec<String>,
}

fn n(report: &Value, key: &str) -> u64 {
    report[key].as_u64().unwrap_or(0)
}

fn list(report: &Value, key: &str) -> Vec<Value> {
    report[key].as_array().cloned().unwrap_or_default()
}

fn s(value: &Value) -> &str {
    value.as_str().unwrap_or("?")
}

fn percent(part: u64, whole: u64) -> u64 {
    if whole == 0 {
        0
    } else {
        (part * 100 + whole / 2) / whole
    }
}

fn plural(count: u64, one: &str, many: &str) -> String {
    format!("{count} {}", if count == 1 { one } else { many })
}

/// "[ok]" for a pass, "[!]" for something to look at. Plain ASCII: it must draw in any font.
fn mark(pass: bool) -> &'static str {
    if pass {
        "[ok]"
    } else {
        "[!]"
    }
}

pub fn sections(report: &Value) -> Vec<Section> {
    let mut out = Vec::new();

    // ── Variables
    let mut lines = Vec::new();
    let collections = list(report, "collections");
    if collections.is_empty() {
        lines.push("[!] No local variables in this file.".to_string());
    } else {
        let parts: Vec<String> = collections
            .iter()
            .map(|c| {
                let modes = c["modes"].as_array().map_or(0, |m| m.len() as u64);
                format!(
                    "{} ({}, {})",
                    s(&c["name"]),
                    plural(modes, "mode", "modes"),
                    plural(c["count"].as_u64().unwrap_or(0), "variable", "variables")
                )
            })
            .collect();
        lines.push(format!(
            "{}: {}",
            plural(collections.len() as u64, "collection", "collections"),
            parts.join(", ")
        ));
        if let Some(types) = report["variableTypes"].as_object() {
            let parts: Vec<String> = types
                .iter()
                .map(|(k, v)| format!("{k} {}", v.as_u64().unwrap_or(0)))
                .collect();
            lines.push(format!("Types: {}", parts.join(", ")));
        }
    }
    let aliases = n(report, "aliasCount");
    lines.push(if aliases > 0 {
        format!(
            "[ok] {} alias another variable: a semantic layer on top of the primitives.",
            plural(aliases, "variable", "variables")
        )
    } else {
        "[!] No variable aliases: the tokens are not layered (primitives, then semantic)."
            .to_string()
    });
    let spacing = report["hasSpacing"].as_bool().unwrap_or(false);
    lines.push(format!(
        "{} Spacing scale {} .. {} {}.",
        mark(spacing),
        SPACING_SCALE[0],
        SPACING_SCALE[SPACING_SCALE.len() - 1],
        if spacing {
            "is complete"
        } else {
            "is missing or incomplete"
        }
    ));
    out.push(Section {
        title: "Variables",
        lines,
    });

    // ── Components
    let mut lines = Vec::new();
    let sets = list(report, "componentSets");
    lines.push(format!(
        "{}, {}, {}.",
        plural(sets.len() as u64, "component set", "component sets"),
        plural(n(report, "componentCount"), "component", "components"),
        plural(n(report, "instanceCount"), "instance", "instances"),
    ));
    if sets.is_empty() {
        lines.push("[!] No component sets, so no variants.".to_string());
    }
    for set in sets.iter().take(8) {
        let props: Vec<&str> = set["props"]
            .as_array()
            .map(|p| p.iter().map(s).collect())
            .unwrap_or_default();
        lines.push(format!(
            "{}: {}, {}",
            s(&set["name"]),
            if props.is_empty() {
                "no properties".to_string()
            } else {
                format!("properties {}", props.join(", "))
            },
            plural(set["variants"].as_u64().unwrap_or(0), "variant", "variants"),
        ));
    }
    if sets.len() > 8 {
        lines.push(format!("... and {} more sets", sets.len() - 8));
    }
    for g in list(report, "genericVariants").iter().take(8) {
        let values: Vec<&str> = g["values"]
            .as_array()
            .map(|v| v.iter().map(s).collect())
            .unwrap_or_default();
        lines.push(format!(
            "[!] {}: property \"{}\" has default-looking names ({}).",
            s(&g["set"]),
            s(&g["prop"]),
            values.join(", ")
        ));
    }
    out.push(Section {
        title: "Components and variants",
        lines,
    });

    // ── Text styles
    let mut lines = Vec::new();
    lines.push(format!(
        "{} in the file.",
        plural(
            list(report, "textStyles").len() as u64,
            "text style",
            "text styles"
        )
    ));
    let missing = list(report, "missingTextStyles");
    lines.push(if missing.is_empty() {
        format!(
            "[ok] The whole scale exists ({} .. {}).",
            TEXT_SCALE[0].0,
            TEXT_SCALE[TEXT_SCALE.len() - 1].0
        )
    } else {
        format!(
            "[!] Missing from the scale: {}.",
            missing.iter().map(s).collect::<Vec<_>>().join(", ")
        )
    });
    let (texts, unstyled) = (n(report, "textTotal"), n(report, "textUnstyled"));
    lines.push(format!(
        "{} {} text layers, {} without a text style ({}%).",
        mark(unstyled == 0),
        texts,
        unstyled,
        percent(unstyled, texts)
    ));
    let off = list(report, "offScale");
    let sizes: Vec<String> = TEXT_SCALE
        .iter()
        .map(|(_, size)| format!("{size}"))
        .collect();
    lines.push(if off.is_empty() {
        format!(
            "[ok] Every font size is on the scale ({}).",
            sizes.join(", ")
        )
    } else {
        let parts: Vec<String> = off
            .iter()
            .map(|e| format!("{} (x{})", s(&e[0]), e[1].as_u64().unwrap_or(0)))
            .collect();
        format!(
            "[!] Font sizes off the scale ({}): {}.",
            sizes.join(", "),
            parts.join(", ")
        )
    });
    out.push(Section {
        title: "Text styles",
        lines,
    });

    // ── Auto layout and grid
    let mut lines = Vec::new();
    let (frames, auto) = (n(report, "frameTotal"), n(report, "frameAuto"));
    lines.push(format!(
        "{} {} of {} frames use auto layout ({}%).",
        mark(frames == auto),
        auto,
        frames,
        percent(auto, frames)
    ));
    let off_total = n(report, "offGridTotal");
    if off_total == 0 {
        lines.push("[ok] All padding and gaps are on the 4px grid.".to_string());
    } else {
        let examples: Vec<String> = list(report, "offGrid")
            .iter()
            .take(5)
            .map(|f| {
                let v: Vec<String> = f["values"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(Value::as_f64)
                            .map(|x| format!("{x}"))
                            .collect()
                    })
                    .unwrap_or_default();
                format!("{} ({})", s(&f["name"]), v.join(", "))
            })
            .collect();
        lines.push(format!(
            "[!] {} off the 4px grid, e.g. {}.",
            plural(
                off_total,
                "auto-layout frame has padding or gap",
                "auto-layout frames have padding or gap"
            ),
            examples.join("; ")
        ));
    }
    let no_auto = list(report, "noAutoLayout");
    if !no_auto.is_empty() {
        let parts: Vec<String> = no_auto
            .iter()
            .take(5)
            .map(|f| {
                format!(
                    "{} ({})",
                    s(&f["name"]),
                    f["children"].as_u64().unwrap_or(0)
                )
            })
            .collect();
        lines.push(format!(
            "[!] Frames with several children but no auto layout: {}.",
            parts.join(", ")
        ));
    }
    out.push(Section {
        title: "Auto layout and grid",
        lines,
    });

    // ── Colour tokens
    let mut lines = Vec::new();
    let (bound, raw) = (n(report, "fillsBound"), n(report, "fillsRaw"));
    lines.push(format!(
        "{} {} solid fills bound to a variable, {} hard-coded ({}% bound). Paint styles do not count as tokens here.",
        mark(raw == 0 && bound > 0),
        bound,
        raw,
        percent(bound, bound + raw)
    ));
    let colours: Vec<String> = list(report, "topRawColors")
        .iter()
        .take(5)
        .map(|c| format!("{} (x{})", s(&c[0]), c[1].as_u64().unwrap_or(0)))
        .collect();
    if !colours.is_empty() {
        lines.push(format!(
            "Most used hard-coded colours: {}.",
            colours.join(", ")
        ));
    }
    out.push(Section {
        title: "Colour tokens",
        lines,
    });

    // ── Pages and coverage
    let mut lines = Vec::new();
    let pages: Vec<&str> = report["pages"]
        .as_array()
        .map(|p| p.iter().map(s).collect())
        .unwrap_or_default();
    lines.push(format!(
        "{}: {}.",
        plural(pages.len() as u64, "page", "pages"),
        pages.join(", ")
    ));
    lines.push(format!(
        "{} checked.",
        plural(n(report, "layersChecked"), "layer", "layers")
    ));
    if report["truncated"].as_bool().unwrap_or(false) {
        lines.push("[!] Stopped early to stay inside FigCraft's limit for one run: the numbers cover part of the file.".to_string());
    }
    let unreadable = n(report, "unreadable");
    if unreadable > 0 {
        lines.push(format!(
            "[!] {} could not be read.",
            plural(unreadable, "layer", "layers")
        ));
    }
    out.push(Section {
        title: "Pages and coverage",
        lines,
    });

    // Layer names come from the document and may hold line breaks or tabs; FigCraft refuses
    // control characters in panel text, and a Markdown bullet must stay on one line.
    for section in &mut out {
        section.lines = section.lines.drain(..).map(clean).collect();
    }
    out
}

fn clean(line: String) -> String {
    if line.chars().any(char::is_control) {
        line.chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .collect()
    } else {
        line
    }
}

/// One line for the toast and the panel's first note.
pub fn headline(report: &Value) -> String {
    let (frames, auto) = (n(report, "frameTotal"), n(report, "frameAuto"));
    let (bound, raw) = (n(report, "fillsBound"), n(report, "fillsRaw"));
    format!(
        "Rubric audit: auto layout {}%, colours bound {}%, {} without a text style",
        percent(auto, frames),
        percent(bound, bound + raw),
        plural(n(report, "textUnstyled"), "text layer", "text layers"),
    )
}

pub fn markdown(report: &Value) -> String {
    let mut md = String::from("# Rubric audit\n\n");
    md.push_str(&format!("{}\n\n", headline(report)));
    for section in sections(report) {
        md.push_str(&format!("## {}\n\n", section.title));
        for line in section.lines {
            md.push_str(&format!("- {line}\n"));
        }
        md.push('\n');
    }
    md.push_str("Made with the Extract All rubric audit for FigCraft.\n");
    md
}

/// A note is at most 1,000 characters.
fn clip(text: String) -> String {
    if text.chars().count() <= 1000 {
        return text;
    }
    let mut short: String = text.chars().take(996).collect();
    short.push_str(" ...");
    short
}

/// FigCraft allows 64 controls in a panel: keep room for the three buttons.
const MAX_NOTES: usize = 60;

/// The panel: a note for the headline, one for each section title and one for each line (FigCraft
/// notes are a single paragraph: no line breaks), then the buttons.
pub fn panel(report: &Value) -> Value {
    let note = |text: String| json!({ "type": "note", "label": clip(text) });
    let mut controls = vec![note(headline(report))];
    for section in sections(report) {
        controls.push(note(section.title.to_uppercase()));
        for line in section.lines {
            controls.push(note(format!("- {line}")));
        }
    }
    controls.truncate(MAX_NOTES);
    controls.push(json!({ "type": "button", "name": "save", "label": "Save report (.md)" }));
    controls.push(json!({ "type": "button", "name": "again", "label": "Run again" }));
    controls.push(json!({ "type": "button", "name": "close", "label": "Close" }));
    json!({ "title": "Rubric audit", "controls": controls })
}
