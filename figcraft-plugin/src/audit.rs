//! The rubric audit: the same checks as `rubricAudit()` in the Extract All Figma plugin
//! (`features.ts`), written against FigCraft's commands instead of the Figma Plugin API.
//!
//! It only reads. The report has the same keys as the Figma plugin's, so the two variants can be
//! compared on the same design.

use crate::host::Host;
use crate::scan::{self, Child, Kind};
use serde_json::{json, Value};

/// The rubric's spacing scale: variables that should exist.
pub const SPACING_SCALE: [&str; 8] = [
    "space/1", "space/2", "space/3", "space/4", "space/5", "space/6", "space/7", "space/8",
];

/// The rubric's text scale: text styles that should exist, and the font sizes they stand for.
pub const TEXT_SCALE: [(&str, f64); 7] = [
    ("text/xs", 12.0),
    ("text/sm", 14.0),
    ("text/base", 16.0),
    ("text/lg", 18.0),
    ("text/xl", 22.0),
    ("text/2xl", 28.0),
    ("text/3xl", 36.0),
];

/// Padding and gaps should be a multiple of this (8px grid, 4px as the half step).
pub const GRID: f64 = 4.0;

/// FigCraft stops a run that uses more than 1,000,000,000 fuel and fails it. The walk adds up what
/// it has spent (see [`Counted::fuel`]) and stops with a partial report, flagged as such, at this.
const FUEL_BUDGET: u64 = 850_000_000;

/// What the walk asks of every layer. FigCraft returns these for each child of the layer it is
/// asked about, so one command covers a whole level.
const NODE_FIELDS_JSON: &str =
    r#"["name","type","layout","fills","boundVariables","fontSize","styles","children"]"#;

// ───────────────────────────── small pure helpers (unit-tested) ─────────────────────────────

/// `word`, then an optional space and digits, in any case: "Variant2", "variant 12", "Property 1".
fn word_number(s: &str, word: &str) -> bool {
    let Some(head) = s.get(..word.len()) else {
        return false;
    };
    if !head.eq_ignore_ascii_case(word) {
        return false;
    }
    let rest = &s[word.len()..];
    let rest = rest.strip_prefix(' ').unwrap_or(rest);
    !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())
}

/// A variant property that kept its default name ("Property 1").
pub fn is_generic_prop(name: &str) -> bool {
    word_number(name, "property")
}

/// A variant value that says nothing ("Variant2", "Property 1", "Default").
pub fn is_generic_value(value: &str) -> bool {
    value.eq_ignore_ascii_case("default")
        || word_number(value, "variant")
        || word_number(value, "property")
}

/// The `prop=value` pairs in a variant's name ("Style=Primary, Size=Md"). A name without `=` is
/// a value of the property Figma-style tools call "Property 1".
pub fn variant_pairs(name: &str) -> Vec<(String, String)> {
    name.split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| match part.split_once('=') {
            Some((k, v)) => (k.trim().to_string(), v.trim().to_string()),
            None => ("Property 1".to_string(), part.to_string()),
        })
        .collect()
}

fn on_grid(value: f64) -> bool {
    let r = (value % GRID).abs();
    r < 1e-6 || (GRID - r).abs() < 1e-6
}

/// The padding and gap values of an auto-layout frame that are above zero and not on the grid.
pub fn off_grid_values(padding: &[f64], gap: Option<f64>) -> Vec<f64> {
    padding
        .iter()
        .copied()
        .chain(gap)
        .filter(|v| *v > 0.0 && !on_grid(*v))
        .collect()
}

/// A font size as a short key: 13, 13.5, 12.25.
fn size_key(size: f64) -> String {
    format!("{}", (size * 100.0).round() / 100.0)
}

fn bump(list: &mut Vec<(String, u64)>, key: String) {
    match list.iter_mut().find(|(k, _)| *k == key) {
        Some(entry) => entry.1 += 1,
        None => list.push((key, 1)),
    }
}

fn top(mut list: Vec<(String, u64)>, n: usize) -> Value {
    list.sort_by(|a, b| b.1.cmp(&a.1)); // stable: ties keep the order they were found in
    Value::Array(
        list.into_iter()
            .take(n)
            .map(|(k, c)| json!([k, c]))
            .collect(),
    )
}

// ───────────────────────────── the walk over the layers ─────────────────────────────

#[derive(Default)]
struct Tally {
    nodes: u64,
    texts: u64,
    unstyled: u64,
    off_scale: Vec<(String, u64)>,
    frames: u64,
    auto: u64,
    instances: u64,
    off_grid: Vec<Value>,
    off_grid_total: u64,
    no_auto: Vec<(u64, Value)>,
    bound: u64,
    raw: u64,
    raw_colors: Vec<(String, u64)>,
}

impl Tally {
    /// Count one layer. `node` is a child entry of a `node.get` reply.
    fn visit(&mut self, node: &Child<'_>) {
        self.nodes += 1;

        if node.kind == Kind::Text {
            self.texts += 1;
            if !node.text_style {
                self.unstyled += 1;
            }
            if let Some(size) = node.font_size {
                let rounded = size.round();
                if !TEXT_SCALE.iter().any(|(_, s)| *s == rounded) {
                    bump(&mut self.off_scale, size_key(size));
                }
            }
        }

        // Are the colour tokens used? A solid fill is "bound" when its colour comes from a variable.
        // FigCraft reports the binding of the first fill (`boundVariables.fill`); further fills count as raw.
        for (i, fill) in node.fills.iter().enumerate() {
            if !fill.solid || !fill.visible {
                continue;
            }
            if i == 0 && node.bound_fill {
                self.bound += 1;
            } else {
                self.raw += 1;
                if let Some(hex) = &fill.color {
                    bump(&mut self.raw_colors, hex.to_lowercase());
                }
            }
        }

        if matches!(node.kind, Kind::Frame | Kind::Component | Kind::Instance) {
            self.frames += 1;
            if node.kind == Kind::Instance {
                self.instances += 1;
            }
            match &node.layout {
                Some(layout) if layout.auto => {
                    self.auto += 1;
                    let bad = off_grid_values(&layout.padding, layout.gap);
                    if !bad.is_empty() {
                        self.off_grid_total += 1;
                        if self.off_grid.len() < 15 {
                            self.off_grid
                                .push(json!({ "id": node.id, "name": node.name, "values": bad }));
                        }
                    }
                }
                _ if node.child_count > 1 && node.kind != Kind::Instance => {
                    self.no_auto.push((
                        node.child_count,
                        json!({ "id": node.id, "name": node.name, "children": node.child_count }),
                    ));
                }
                _ => {}
            }
        }
    }
}

// ───────────────────────────── the audit ─────────────────────────────

/// A host that counts what the calls through it cost, to stay inside FigCraft's per-run fuel.
struct Counted<'a, H: Host + ?Sized> {
    host: &'a mut H,
    calls: usize,
    /// Bytes of layer replies, read with [`scan`].
    scanned: usize,
    /// Bytes of replies parsed with `serde_json`.
    parsed: usize,
}

impl<H: Host + ?Sized> Counted<'_, H> {
    /// A small reply, parsed into a `Value`.
    fn call(&mut self, command: &str, params: Value) -> Result<Value, String> {
        self.calls += 1;
        let body = self.host.call_raw(command, &params.to_string())?;
        self.parsed += body.len();
        if body.is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_slice(&body).map_err(|e| format!("{command}: unreadable reply ({e})"))
    }

    /// A layer reply, to be read with [`scan::children`].
    fn call_raw(&mut self, command: &str, params: &str) -> Result<Vec<u8>, String> {
        self.calls += 1;
        let body = self.host.call_raw(command, params)?;
        self.scanned += body.len();
        Ok(body)
    }

    /// The fuel spent so far, estimated from measurements in FigCraft 0.18.1: a command is three host
    /// calls (30,000) plus about 20,000 of our own work, a byte read with [`scan`] costs about 130 and a
    /// byte parsed with serde_json about 500, and the run itself starts at about 3,000,000.
    fn fuel(&self) -> u64 {
        3_000_000
            + self.calls as u64 * 50_000
            + self.scanned as u64 * 130
            + self.parsed as u64 * 500
    }
}

/// Run the whole audit and return the report.
pub fn run_audit<H: Host + ?Sized>(host: &mut H) -> Result<Value, String> {
    let mut host = Counted {
        host,
        calls: 0,
        scanned: 0,
        parsed: 0,
    };

    // Criterion: local variables, in two layers
    let vars = host.call("variable.list", json!({}))?;
    let variables = vars["variables"].as_array().cloned().unwrap_or_default();
    let collections: Vec<Value> = vars["collections"]
        .as_array()
        .map(|list| {
            list.iter()
                .map(|c| {
                    let count = variables
                        .iter()
                        .filter(|v| v["collection"] == c["id"])
                        .count();
                    let modes: Vec<Value> = c["modes"]
                        .as_array()
                        .map(|m| m.iter().map(|x| x["name"].clone()).collect())
                        .unwrap_or_default();
                    json!({ "name": c["name"], "modes": modes, "count": count })
                })
                .collect()
        })
        .unwrap_or_default();
    let mut variable_types = serde_json::Map::new();
    let mut alias_count = 0u64;
    for v in &variables {
        let ty = v["resolvedType"].as_str().unwrap_or("?").to_string();
        let n = variable_types.get(&ty).and_then(Value::as_u64).unwrap_or(0);
        variable_types.insert(ty, json!(n + 1));
        if v["values"]
            .as_object()
            .is_some_and(|m| m.values().any(|x| x["type"] == "alias"))
        {
            alias_count += 1;
        }
    }
    let has_spacing = SPACING_SCALE
        .iter()
        .all(|name| variables.iter().any(|v| v["name"] == *name));

    // Criterion: text styles
    let styles = host.call("style.list", json!({}))?;
    let text_styles: Vec<&Value> = styles
        .as_array()
        .map(|a| a.iter().filter(|s| s["type"] == "text").collect())
        .unwrap_or_default();
    let missing_text_styles: Vec<&str> = TEXT_SCALE
        .iter()
        .map(|(name, _)| *name)
        .filter(|name| !text_styles.iter().any(|s| s["name"] == *name))
        .collect();
    let text_styles_out: Vec<Value> = text_styles
        .iter()
        .map(|s| json!({ "name": s["name"], "size": s["style"]["font_size"], "font": s["style"]["font_style"] }))
        .collect();

    // Criterion: components and variants
    let comps = host.call("component.list", json!({}))?;
    let comps = comps.as_array().cloned().unwrap_or_default();
    let component_count = comps.iter().filter(|c| c["type"] == "COMPONENT").count();
    let mut component_sets = Vec::new();
    let mut generic_variants = Vec::new();
    let mut errors = 0u64;
    for set in comps.iter().filter(|c| c["type"] == "COMPONENT_SET") {
        let reply = match host.call(
            "node.get",
            json!({ "id": set["id"], "fields": ["name", "children"] }),
        ) {
            Ok(r) => r,
            Err(_) => {
                errors += 1;
                continue;
            }
        };
        let variants = reply["children"].as_array().cloned().unwrap_or_default();
        let mut props: Vec<(String, Vec<String>)> = Vec::new();
        for variant in &variants {
            for (key, value) in variant_pairs(variant["name"].as_str().unwrap_or("")) {
                match props.iter_mut().find(|(k, _)| *k == key) {
                    Some((_, values)) => {
                        if !values.contains(&value) {
                            values.push(value);
                        }
                    }
                    None => props.push((key, vec![value])),
                }
            }
        }
        let set_name = set["name"].as_str().unwrap_or("?");
        for (prop, values) in &props {
            if is_generic_prop(prop) || values.iter().any(|v| is_generic_value(v)) {
                generic_variants.push(json!({ "set": set_name, "prop": prop, "values": values }));
            }
        }
        component_sets.push(json!({
            "name": set_name,
            "props": props.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(),
            "variants": variants.len(),
        }));
    }

    // Pages, then every layer on them: text, auto layout, grid, colours
    let pages = host.call("page.list", json!({}))?;
    let pages = pages.as_array().cloned().unwrap_or_default();
    let mut tally = Tally::default();
    let mut stack: Vec<u64> = pages
        .iter()
        .rev()
        .filter_map(|p| p["id"].as_u64())
        .collect();
    let mut truncated = false;
    while let Some(id) = stack.pop() {
        if host.fuel() > FUEL_BUDGET {
            truncated = true;
            break;
        }
        // One command returns the whole next level, with the fields the checks need on every child.
        let params = format!(r#"{{"id":{id},"fields":{NODE_FIELDS_JSON}}}"#);
        let body = match host.call_raw("node.get", &params) {
            Ok(b) => b,
            Err(_) => {
                errors += 1;
                continue;
            }
        };
        let Some(children) = scan::children(&body) else {
            errors += 1;
            continue;
        };
        for child in &children {
            tally.visit(child);
        }
        for child in children.iter().rev() {
            if child.child_count > 0 {
                stack.push(child.id);
            }
        }
    }

    let mut no_auto = tally.no_auto;
    no_auto.sort_by(|a, b| b.0.cmp(&a.0));

    Ok(json!({
        "collections": collections,
        "variableTypes": variable_types,
        "aliasCount": alias_count,
        "hasSpacing": has_spacing,
        "componentSets": component_sets,
        "componentCount": component_count,
        "instanceCount": tally.instances,
        "genericVariants": generic_variants,
        "textStyles": text_styles_out,
        "missingTextStyles": missing_text_styles,
        "textTotal": tally.texts,
        "textUnstyled": tally.unstyled,
        "offScale": top(tally.off_scale, 12),
        "frameTotal": tally.frames,
        "frameAuto": tally.auto,
        "offGrid": tally.off_grid,
        "offGridTotal": tally.off_grid_total,
        "noAutoLayout": no_auto.into_iter().take(10).map(|(_, v)| v).collect::<Vec<_>>(),
        "fillsBound": tally.bound,
        "fillsRaw": tally.raw,
        "topRawColors": top(tally.raw_colors, 8),
        "pages": pages.iter().map(|p| p["name"].clone()).collect::<Vec<_>>(),
        "layersChecked": tally.nodes,
        "truncated": truncated,
        "commands": host.calls,
        "fuelEstimate": host.fuel(),
        "unreadable": errors,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generic_names_are_recognised() {
        assert!(is_generic_prop("Property 1"));
        assert!(is_generic_prop("property12"));
        assert!(!is_generic_prop("Property"));
        assert!(!is_generic_prop("Size"));
        assert!(is_generic_value("Variant2"));
        assert!(is_generic_value("variant 3"));
        assert!(is_generic_value("DEFAULT"));
        assert!(is_generic_value("Property 2"));
        assert!(!is_generic_value("Primary"));
        assert!(!is_generic_value("Variant"));
        assert!(!is_generic_value("Défaut"));
        assert!(!is_generic_value("Vari\u{e4}nt1")); // a multi-byte character where the cut falls does not panic
    }

    #[test]
    fn variant_names_are_split() {
        assert_eq!(
            variant_pairs("Style=Primary, Size = Md"),
            vec![
                ("Style".into(), "Primary".into()),
                ("Size".into(), "Md".into())
            ]
        );
        assert_eq!(
            variant_pairs("Variant2"),
            vec![("Property 1".into(), "Variant2".into())]
        );
        assert!(variant_pairs("  ").is_empty());
    }

    #[test]
    fn the_grid_check_looks_at_padding_and_gap() {
        assert!(off_grid_values(&[16.0, 8.0, 0.0, 24.0], Some(12.0)).is_empty());
        assert_eq!(
            off_grid_values(&[13.0, 16.0, 0.0, 16.0], Some(10.0)),
            vec![13.0, 10.0]
        );
        assert!(off_grid_values(&[11.999999999], Some(4.0000000001)).is_empty());
        assert_eq!(off_grid_values(&[], Some(13.5)), vec![13.5]);
    }

    #[test]
    fn font_sizes_become_short_keys() {
        assert_eq!(size_key(13.0), "13");
        assert_eq!(size_key(13.5), "13.5");
        assert_eq!(size_key(12.254), "12.25");
    }

    #[test]
    fn ties_keep_the_order_they_were_found_in() {
        let list = vec![
            ("b".to_string(), 2),
            ("a".to_string(), 2),
            ("c".to_string(), 5),
        ];
        assert_eq!(top(list, 2), json!([["c", 5], ["b", 2]]));
    }
}
