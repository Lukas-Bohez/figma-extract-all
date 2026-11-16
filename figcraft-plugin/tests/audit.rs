//! The audit and the plugin's buttons against an in-memory stand-in for FigCraft, with a document
//! whose numbers are known. (The real thing, in the real app: `node figcraft-plugin/test.mjs`.)

use extract_all_rubric_audit::host::{Host, Shell};
use extract_all_rubric_audit::{audit, dispatch, report};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

struct Node {
    name: &'static str,
    kind: &'static str,
    props: Value,
    children: Vec<u64>,
}

/// FigCraft as far as the plugin sees it: it answers `node.get` the way the app does (the
/// requested `fields` come back for every child, plus `childCount`).
struct Fake {
    nodes: BTreeMap<u64, Node>,
    variables: Value,
    styles: Value,
    components: Value,
    broken: Vec<u64>,
    calls: usize,
    shown: Vec<Value>,
    notices: Vec<String>,
    saved: Vec<(String, String, Vec<u8>)>,
    closed: bool,
}

impl Host for Fake {
    fn call_raw(&mut self, command: &str, params: &str) -> Result<Vec<u8>, String> {
        let params: Value = serde_json::from_str(params).map_err(|e| format!("bad params: {e}"))?;
        self.answer(command, &params)
            .map(|v| serde_json::to_vec(&v).expect("serialise"))
    }
}

impl Fake {
    fn answer(&mut self, command: &str, params: &Value) -> Result<Value, String> {
        self.calls += 1;
        match command {
            "variable.list" => Ok(self.variables.clone()),
            "style.list" => Ok(self.styles.clone()),
            "component.list" => Ok(self.components.clone()),
            "page.list" => Ok(
                json!([{ "id": 1, "name": "App", "children": 4, "current": true, "divider": false }]),
            ),
            "node.get" => {
                let id = params["id"].as_u64().ok_or("no id")?;
                if self.broken.contains(&id) {
                    return Err("layer is gone".into());
                }
                let node = self.nodes.get(&id).ok_or("unknown layer")?;
                let fields: Vec<&str> = params["fields"]
                    .as_array()
                    .map(|f| f.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default();
                let mut reply = json!({ "id": id, "name": node.name, "type": node.kind });
                if fields.contains(&"children") {
                    let entries: Vec<Value> = node
                        .children
                        .iter()
                        .map(|c| {
                            let child = &self.nodes[c];
                            let mut e = Map::new();
                            e.insert("id".into(), json!(c));
                            e.insert("name".into(), json!(child.name));
                            e.insert("type".into(), json!(child.kind));
                            if !child.children.is_empty() {
                                e.insert("childCount".into(), json!(child.children.len()));
                            }
                            for (k, v) in child.props.as_object().into_iter().flatten() {
                                if fields.contains(&k.as_str()) {
                                    e.insert(k.clone(), v.clone());
                                }
                            }
                            Value::Object(e)
                        })
                        .collect();
                    reply["children"] = Value::Array(entries);
                }
                Ok(reply)
            }
            other => Err(format!("unknown command {other}")),
        }
    }
}

impl Shell for Fake {
    fn notify(&mut self, message: &str) {
        self.notices.push(message.to_string());
    }
    fn show_panel(&mut self, spec: &Value) -> Result<(), String> {
        self.shown.push(spec.clone());
        Ok(())
    }
    fn close_panel(&mut self) {
        self.closed = true;
    }
    fn save_file(&mut self, name: &str, mime: &str, data: &[u8]) -> Result<(), String> {
        self.saved.push((name.into(), mime.into(), data.to_vec()));
        Ok(())
    }
}

/// FigCraft checks every panel spec; the real app refused a note with a line break, so the stand-in
/// enforces the same rules (docs/plugins.md: at most 64 controls, notes up to 1,000 characters,
/// no control characters in text, unique names).
fn assert_valid_panel(panel: &Value) {
    let controls = panel["controls"].as_array().expect("controls");
    assert!(controls.len() <= 64, "{} controls", controls.len());
    let mut names = Vec::new();
    for c in controls {
        let label = c["label"].as_str().unwrap_or("");
        assert!(label.chars().count() <= 1000, "label too long: {label}");
        assert!(
            !label.chars().any(char::is_control),
            "control character in {label:?}"
        );
        if let Some(name) = c["name"].as_str() {
            assert!(!names.contains(&name), "duplicate name {name}");
            names.push(name);
        }
    }
}

fn node(name: &'static str, kind: &'static str, props: Value, children: &[u64]) -> Node {
    Node {
        name,
        kind,
        props,
        children: children.to_vec(),
    }
}

/// A small design with known problems.
fn fake() -> Fake {
    let mut nodes = BTreeMap::new();
    nodes.insert(1, node("App", "PAGE", json!({}), &[10, 20, 30, 40]));
    // An auto-layout screen: padding 13 is off the grid, the fill is bound to a variable.
    nodes.insert(
        10,
        node(
            "Home",
            "FRAME",
            json!({
                "layout": { "mode": "vertical", "padding": [13, 16, 16, 16], "gap": 12 },
                "fills": [{ "type": "solid", "color": "#F4F6F8" }],
                "boundVariables": { "fill": "VariableID:1" },
            }),
            &[11, 12, 13],
        ),
    );
    nodes.insert(11, node("Title", "TEXT", json!({ "fontSize": 19 }), &[])); // off the scale, no style
    nodes.insert(
        12,
        node(
            "Body",
            "TEXT",
            json!({ "fontSize": 14, "styles": { "text": "S:1" } }),
            &[],
        ),
    );
    // A frame with three children and no auto layout, hard-coded colours.
    nodes.insert(
        13,
        node(
            "Card",
            "FRAME",
            json!({ "fills": [{ "type": "solid", "color": "#FFFFFF" }] }),
            &[14, 15, 16],
        ),
    );
    nodes.insert(
        14,
        node(
            "Dot",
            "RECTANGLE",
            json!({ "fills": [{ "type": "solid", "color": "#FF0000" }] }),
            &[],
        ),
    );
    nodes.insert(
        15,
        node(
            "Dot 2",
            "RECTANGLE",
            json!({ "fills": [{ "type": "solid", "color": "#ff0000" }] }),
            &[],
        ),
    );
    nodes.insert(
        16,
        node(
            "Small",
            "TEXT",
            json!({ "fontSize": 12, "styles": { "text": "S:1" } }),
            &[],
        ),
    );
    // A component set whose variants kept Figma-style default names.
    nodes.insert(20, node("Button", "COMPONENT_SET", json!({}), &[21, 22]));
    nodes.insert(21, node("Property 1=Variant2", "COMPONENT", json!({}), &[]));
    nodes.insert(22, node("Property 1=Default", "COMPONENT", json!({}), &[]));
    nodes.insert(30, node("Btn", "INSTANCE", json!({}), &[31]));
    nodes.insert(
        31,
        node(
            "Label",
            "TEXT",
            json!({ "fontSize": 16, "styles": { "text": "S:1" } }),
            &[],
        ),
    );
    nodes.insert(40, node("Chip", "COMPONENT_SET", json!({}), &[41, 42]));
    nodes.insert(41, node("Selected=On", "COMPONENT", json!({}), &[]));
    nodes.insert(42, node("Selected=Off", "COMPONENT", json!({}), &[]));

    let mut variables = vec![
        json!({ "id": "V1", "collection": "C1", "name": "color/bg", "resolvedType": "color", "values": { "m1": { "type": "color", "value": {} } } }),
        json!({ "id": "V2", "collection": "C1", "name": "color/surface", "resolvedType": "color", "values": { "m1": { "type": "alias", "value": "V1" } } }),
    ];
    for i in 1..=8 {
        variables.push(json!({ "id": format!("S{i}"), "collection": "C2", "name": format!("space/{i}"), "resolvedType": "number", "values": { "m": { "type": "number", "value": i * 4 } } }));
    }
    Fake {
        nodes,
        variables: json!({
            "collections": [
                { "id": "C1", "name": "Theme", "modes": [{ "name": "Light" }, { "name": "Dark" }] },
                { "id": "C2", "name": "Spacing", "modes": [{ "name": "Default" }] },
            ],
            "variables": variables,
        }),
        styles: json!([
            { "id": "S:1", "name": "text/sm", "type": "text", "style": { "font_size": 14, "font_style": "Regular" } },
            { "id": "S:2", "name": "Pine/500", "type": "paint" },
        ]),
        components: json!([
            { "id": 21, "name": "Property 1=Variant2", "type": "COMPONENT" },
            { "id": 22, "name": "Property 1=Default", "type": "COMPONENT" },
            { "id": 20, "name": "Button", "type": "COMPONENT_SET" },
            { "id": 41, "name": "Selected=On", "type": "COMPONENT" },
            { "id": 42, "name": "Selected=Off", "type": "COMPONENT" },
            { "id": 40, "name": "Chip", "type": "COMPONENT_SET" },
        ]),
        broken: vec![],
        calls: 0,
        shown: vec![],
        notices: vec![],
        saved: vec![],
        closed: false,
    }
}

#[test]
fn the_report_has_the_numbers_of_the_document() {
    let mut f = fake();
    let r = audit::run_audit(&mut f).unwrap();

    // variables
    assert_eq!(
        r["collections"],
        json!([{ "name": "Theme", "modes": ["Light", "Dark"], "count": 2 }, { "name": "Spacing", "modes": ["Default"], "count": 8 }])
    );
    assert_eq!(r["variableTypes"], json!({ "color": 2, "number": 8 }));
    assert_eq!(r["aliasCount"], 1);
    assert_eq!(r["hasSpacing"], true);

    // components
    assert_eq!(r["componentCount"], 4);
    assert_eq!(r["instanceCount"], 1);
    assert_eq!(
        r["componentSets"],
        json!([
            { "name": "Button", "props": ["Property 1"], "variants": 2 },
            { "name": "Chip", "props": ["Selected"], "variants": 2 },
        ])
    );
    assert_eq!(
        r["genericVariants"],
        json!([{ "set": "Button", "prop": "Property 1", "values": ["Variant2", "Default"] }])
    );

    // text
    assert_eq!(
        r["textStyles"],
        json!([{ "name": "text/sm", "size": 14, "font": "Regular" }])
    );
    assert_eq!(
        r["missingTextStyles"],
        json!([
            "text/xs",
            "text/base",
            "text/lg",
            "text/xl",
            "text/2xl",
            "text/3xl"
        ])
    );
    assert_eq!(r["textTotal"], 4);
    assert_eq!(r["textUnstyled"], 1);
    assert_eq!(r["offScale"], json!([["19", 1]]));

    // frames: Home, Card, 4 components and the instance; only Home has auto layout
    assert_eq!(r["frameTotal"], 7);
    assert_eq!(r["frameAuto"], 1);
    assert_eq!(r["offGridTotal"], 1);
    assert_eq!(
        r["offGrid"],
        json!([{ "id": 10, "name": "Home", "values": [13.0] }])
    );
    assert_eq!(
        r["noAutoLayout"],
        json!([{ "id": 13, "name": "Card", "children": 3 }])
    );

    // colours: one bound fill; three raw ones, #FF0000 and #ff0000 counted as one colour
    assert_eq!(r["fillsBound"], 1);
    assert_eq!(r["fillsRaw"], 3);
    assert_eq!(r["topRawColors"], json!([["#ff0000", 2], ["#ffffff", 1]]));

    assert_eq!(r["pages"], json!(["App"]));
    assert_eq!(r["layersChecked"], 15);
    assert_eq!(r["truncated"], false);
    assert_eq!(r["unreadable"], 0);
}

#[test]
fn one_call_covers_a_whole_level_of_layers() {
    let mut f = fake();
    audit::run_audit(&mut f).unwrap();
    // 4 lists + 2 variant sets + 5 containers (page, Home, Card, Button, Btn, Chip = 6) -> 12
    assert_eq!(
        f.calls, 12,
        "the walk should ask once per container, not once per layer"
    );
}

#[test]
fn a_layer_that_cannot_be_read_is_counted_not_fatal() {
    let mut f = fake();
    f.broken = vec![13]; // the Card frame
    let r = audit::run_audit(&mut f).unwrap();
    assert_eq!(r["unreadable"], 1);
    assert_eq!(r["layersChecked"], 12); // the card's three children are never seen
    assert!(report::sections(&r)
        .iter()
        .flat_map(|s| &s.lines)
        .any(|l| l.contains("could not be read")));
}

#[test]
fn a_failing_variable_list_fails_the_run() {
    struct Broken;
    impl Host for Broken {
        fn call_raw(&mut self, command: &str, _: &str) -> Result<Vec<u8>, String> {
            Err(format!("{command}: refused"))
        }
    }
    assert_eq!(
        audit::run_audit(&mut Broken).unwrap_err(),
        "variable.list: refused"
    );
}

#[test]
fn a_very_deep_file_stops_early_and_says_so() {
    let mut f = fake();
    f.nodes.clear();
    f.nodes.insert(1, node("App", "PAGE", json!({}), &[100]));
    for id in 100..30_000u64 {
        f.nodes.insert(
            id,
            node(
                "Nest",
                "FRAME",
                json!({ "layout": { "mode": "vertical", "padding": [0, 0, 0, 0], "gap": 0 } }),
                &[id + 1],
            ),
        );
    }
    f.nodes
        .insert(30_000, node("Leaf", "FRAME", json!({}), &[]));
    let r = audit::run_audit(&mut f).unwrap();
    assert_eq!(r["truncated"], true);
    assert!(
        f.calls < 12_500,
        "the walk stops at its fuel budget, after {} commands (FigCraft allows 33,000)",
        f.calls
    );
    assert!(
        r["fuelEstimate"].as_u64().unwrap() < 900_000_000,
        "estimated {} fuel",
        r["fuelEstimate"]
    );
    assert!(report::sections(&r)
        .iter()
        .flat_map(|s| &s.lines)
        .any(|l| l.contains("Stopped early")));
}

#[test]
fn the_command_shows_a_panel_and_a_toast() {
    let mut f = fake();
    let out = dispatch(
        &mut f,
        &json!({ "api": 4, "command": "audit", "params": {}, "selection": [] }),
    )
    .unwrap();
    let out: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(out["report"]["frameTotal"], 7);

    assert_eq!(f.shown.len(), 1);
    let panel = &f.shown[0];
    assert_eq!(panel["title"], "Rubric audit");
    assert_valid_panel(panel);
    let controls = panel["controls"].as_array().unwrap();
    let buttons: Vec<&str> = controls
        .iter()
        .filter(|c| c["type"] == "button")
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(buttons, ["save", "again", "close"]);
    assert_eq!(f.notices.len(), 1);
    assert!(
        f.notices[0].starts_with("Rubric audit: auto layout 14%"),
        "{}",
        f.notices[0]
    );
}

#[test]
fn the_save_button_offers_the_markdown_report() {
    let mut f = fake();
    dispatch(
        &mut f,
        &json!({ "command": "audit", "event": { "control": "save", "value": null }, "values": {} }),
    )
    .unwrap();
    assert_eq!(f.saved.len(), 1);
    let (name, mime, data) = &f.saved[0];
    assert_eq!(
        (name.as_str(), mime.as_str()),
        ("rubric-report.md", "text/markdown")
    );
    let md = String::from_utf8(data.clone()).unwrap();
    assert!(md.starts_with("# Rubric audit\n"));
    for heading in [
        "## Variables",
        "## Components and variants",
        "## Text styles",
        "## Auto layout and grid",
        "## Colour tokens",
        "## Pages and coverage",
    ] {
        assert!(md.contains(heading), "missing {heading}");
    }
    assert!(md.contains("- [!] Font sizes off the scale"), "{md}");
    assert!(f.shown.is_empty(), "saving does not redraw the panel");
}

#[test]
fn the_close_button_closes_without_auditing() {
    let mut f = fake();
    dispatch(
        &mut f,
        &json!({ "command": "audit", "event": { "control": "close", "value": null } }),
    )
    .unwrap();
    assert!(f.closed);
    assert_eq!(f.calls, 0);
}

#[test]
fn the_again_button_audits_and_shows_the_panel_anew() {
    let mut f = fake();
    dispatch(
        &mut f,
        &json!({ "command": "audit", "event": { "control": "again", "value": null } }),
    )
    .unwrap();
    assert_eq!(f.shown.len(), 1);
}

#[test]
fn an_unknown_command_is_refused() {
    let mut f = fake();
    assert_eq!(
        dispatch(&mut f, &json!({ "command": "nope" })).unwrap_err(),
        "unknown command \"nope\""
    );
}

#[test]
fn names_from_the_document_cannot_break_the_panel() {
    let mut f = fake();
    f.nodes.insert(
        13,
        node(
            "Card
with	a line break",
            "FRAME",
            json!({}),
            &[14, 15, 16],
        ),
    );
    dispatch(&mut f, &json!({ "command": "audit" })).unwrap();
    assert_valid_panel(&f.shown[0]);
    let md = report::markdown(&audit::run_audit(&mut f).unwrap());
    assert!(md.contains("Card with a line break (3)"), "{md}");
}

#[test]
fn a_big_report_still_fits_in_a_panel() {
    let mut f = fake();
    // 40 sets, each with a default-named property: the longest lists the report can have
    let mut sets = vec![];
    for i in 0..40u64 {
        let (set, a, b) = (1000 + i * 3, 1001 + i * 3, 1002 + i * 3);
        f.nodes
            .insert(set, node("Set", "COMPONENT_SET", json!({}), &[a, b]));
        f.nodes
            .insert(a, node("Property 1=Variant1", "COMPONENT", json!({}), &[]));
        f.nodes
            .insert(b, node("Property 1=Variant2", "COMPONENT", json!({}), &[]));
        sets.push(json!({ "id": set, "name": "Set", "type": "COMPONENT_SET" }));
    }
    f.components = Value::Array(sets);
    f.nodes.get_mut(&1).unwrap().children = (1000..1040).map(|i| 1000 + (i - 1000) * 3).collect();
    dispatch(&mut f, &json!({ "command": "audit" })).unwrap();
    assert_valid_panel(&f.shown[0]);
}

#[test]
fn an_empty_file_gets_an_honest_report() {
    let mut f = fake();
    f.nodes.clear();
    f.nodes.insert(1, node("App", "PAGE", json!({}), &[]));
    f.variables = json!({ "collections": [], "variables": [] });
    f.styles = json!([]);
    f.components = json!([]);
    let r = audit::run_audit(&mut f).unwrap();
    let text = report::markdown(&r);
    assert!(text.contains("No local variables"));
    assert!(text.contains("No component sets"));
    assert!(text.contains("0 of 0 frames use auto layout (0%)"));
}
