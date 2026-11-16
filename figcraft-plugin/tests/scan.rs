//! The layer reader is hand-written (for fuel, see `src/scan.rs`), so it is tested against
//! `serde_json`: random replies, in every shape FigCraft or a future FigCraft might send, must read
//! the same through both. Damaged replies must never panic or hang.

use extract_all_rubric_audit::scan::{children, Child, Fill, Kind, Layout};
use serde_json::{json, Map, Value};
use std::borrow::Cow;

/// A small deterministic random source: no dependency, same sequence every run.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }
    fn pick<'a, T>(&mut self, list: &'a [T]) -> &'a T {
        &list[self.below(list.len() as u64) as usize]
    }
}

const STRINGS: [&str; 12] = [
    "Card",
    "Home — Light",
    "",
    "Say \"hi\"",
    "back\\slash",
    "tab\there",
    "line\nbreak",
    "ünïcödé",
    "emoji \u{1F3D4}\u{FE0F}",
    "{not json}",
    "[1,2]",
    "#F4F6F8",
];

fn number(rng: &mut Rng) -> Value {
    match rng.below(7) {
        0 => json!(rng.below(200)),
        1 => json!(-(rng.below(50) as i64)),
        2 => json!(rng.below(1000) as f64 / 8.0),
        3 => json!(12345678901234u64),
        4 => serde_json::from_str("1.5e2").unwrap(),
        5 => serde_json::from_str("2.5E-1").unwrap(),
        _ => json!(123456789012345678u64), // 18 digits: not the integer fast path
    }
}

/// Any JSON value, nested up to `depth`: what an unknown key might hold.
fn junk(rng: &mut Rng, depth: u32) -> Value {
    match rng.below(if depth == 0 { 5 } else { 7 }) {
        0 => Value::Null,
        1 => json!(rng.chance(50)),
        2 => number(rng),
        3 | 4 => json!(*rng.pick(&STRINGS)),
        5 => Value::Array((0..rng.below(4)).map(|_| junk(rng, depth - 1)).collect()),
        _ => Value::Object(
            (0..rng.below(4))
                .map(|i| (format!("k{i}{}", rng.below(9)), junk(rng, depth - 1)))
                .collect(),
        ),
    }
}

/// A value for a known key: usually the right type, sometimes not.
fn known(rng: &mut Rng, right: impl FnOnce(&mut Rng) -> Value) -> Value {
    if rng.chance(85) {
        right(rng)
    } else {
        junk(rng, 2)
    }
}

fn layout(rng: &mut Rng) -> Value {
    let mut m = Map::new();
    if rng.chance(90) {
        m.insert(
            "mode".into(),
            json!(*rng.pick(&["horizontal", "vertical", "none", "grid"])),
        );
    }
    if rng.chance(80) {
        m.insert("gap".into(), number(rng));
    }
    if rng.chance(80) {
        m.insert(
            "padding".into(),
            Value::Array((0..4).map(|_| number(rng)).collect()),
        );
    }
    for extra in [
        "columnTracks",
        "rowTracks",
        "crossGap",
        "wrap",
        "contentAlign",
    ] {
        if rng.chance(70) {
            m.insert(extra.into(), junk(rng, 2));
        }
    }
    Value::Object(m)
}

fn fill(rng: &mut Rng) -> Value {
    let mut m = Map::new();
    if rng.chance(90) {
        m.insert(
            "type".into(),
            json!(*rng.pick(&["solid", "gradient", "image"])),
        );
    }
    if rng.chance(90) {
        m.insert(
            "color".into(),
            json!(*rng.pick(&["#F4F6F8", "#ff0000", "#00000080"])),
        );
    }
    if rng.chance(30) {
        m.insert("visible".into(), json!(rng.chance(50)));
    }
    if rng.chance(30) {
        m.insert("opacity".into(), number(rng));
    }
    Value::Object(m)
}

fn child(rng: &mut Rng, id: u64) -> Value {
    let mut m = Map::new();
    m.insert("id".into(), known(rng, |_| json!(id)));
    m.insert("name".into(), known(rng, |r| json!(*r.pick(&STRINGS))));
    m.insert(
        "type".into(),
        known(rng, |r| {
            json!(*r.pick(&[
                "TEXT",
                "FRAME",
                "COMPONENT",
                "INSTANCE",
                "RECTANGLE",
                "VECTOR",
                "SLICE"
            ]))
        }),
    );
    if rng.chance(50) {
        m.insert("childCount".into(), known(rng, |r| json!(r.below(30))));
    }
    if rng.chance(50) {
        m.insert("fontSize".into(), known(rng, number));
    }
    if rng.chance(60) {
        m.insert("layout".into(), known(rng, layout));
    }
    if rng.chance(60) {
        m.insert(
            "fills".into(),
            known(rng, |r| {
                Value::Array(
                    (0..r.below(4))
                        .map(|_| if r.chance(90) { fill(r) } else { junk(r, 1) })
                        .collect(),
                )
            }),
        );
    }
    if rng.chance(50) {
        m.insert(
            "boundVariables".into(),
            known(rng, |r| {
                let mut b = Map::new();
                if r.chance(70) {
                    b.insert(
                        "fill".into(),
                        if r.chance(80) {
                            json!("VariableID:1")
                        } else {
                            Value::Null
                        },
                    );
                }
                if r.chance(40) {
                    b.insert("stroke".into(), json!("VariableID:2"));
                }
                Value::Object(b)
            }),
        );
    }
    if rng.chance(50) {
        m.insert(
            "styles".into(),
            known(rng, |r| {
                let mut b = Map::new();
                for key in ["text", "fill", "effect"] {
                    if r.chance(50) {
                        b.insert(
                            key.into(),
                            if r.chance(60) {
                                json!("S:1")
                            } else {
                                Value::Null
                            },
                        );
                    }
                }
                Value::Object(b)
            }),
        );
    }
    for extra in [
        "absoluteBounds",
        "characters",
        "constraints",
        "devStatus",
        "sizing",
        "x",
        "y",
        "visible",
    ] {
        if rng.chance(40) {
            m.insert(extra.into(), junk(rng, 2));
        }
    }
    Value::Object(m)
}

// ── the reference: what the audit used to read, straight from the serde tree ──

fn reference(v: &Value) -> Child<'_> {
    let kind = match v["type"].as_str() {
        Some("TEXT") => Kind::Text,
        Some("FRAME") => Kind::Frame,
        Some("COMPONENT") => Kind::Component,
        Some("INSTANCE") => Kind::Instance,
        _ => Kind::Other,
    };
    let layout = v["layout"].as_object().map(|l| Layout {
        auto: l
            .get("mode")
            .and_then(Value::as_str)
            .is_some_and(|m| m != "none"),
        padding: l
            .get("padding")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_f64).collect())
            .unwrap_or_default(),
        gap: l.get("gap").and_then(Value::as_f64),
    });
    let fills = v["fills"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|f| f.is_object())
                .map(|f| Fill {
                    solid: f["type"].as_str() == Some("solid"),
                    visible: f["visible"].as_bool() != Some(false),
                    color: f["color"].as_str().map(Cow::Borrowed),
                })
                .collect()
        })
        .unwrap_or_default();
    Child {
        id: v["id"].as_f64().map_or(0, |n| n as u64),
        name: Cow::Borrowed(v["name"].as_str().unwrap_or("")),
        kind,
        child_count: v["childCount"].as_f64().map_or(0, |n| n as u64),
        layout,
        fills,
        bound_fill: v["boundVariables"]
            .as_object()
            .is_some_and(|b| b.get("fill").is_some_and(|x| !x.is_null())),
        font_size: v["fontSize"].as_f64(),
        text_style: v["styles"]
            .as_object()
            .is_some_and(|b| b.get("text").is_some_and(|x| !x.is_null())),
    }
}

fn reply(rng: &mut Rng, n: u64) -> Value {
    let mut m = Map::new();
    m.insert("id".into(), json!(1));
    m.insert("name".into(), json!(*rng.pick(&STRINGS)));
    m.insert("type".into(), json!("FRAME"));
    if rng.chance(50) {
        m.insert("layout".into(), layout(rng));
    }
    m.insert(
        "children".into(),
        Value::Array((0..n).map(|i| child(rng, 100 + i)).collect()),
    );
    Value::Object(m)
}

fn encode(rng: &mut Rng, v: &Value) -> Vec<u8> {
    if rng.chance(50) {
        serde_json::to_vec(v)
    } else {
        serde_json::to_vec_pretty(v)
    }
    .unwrap()
}

#[test]
fn it_reads_what_serde_reads() {
    let mut rng = Rng(42);
    for round in 0..600 {
        let n = rng.below(12);
        let value = reply(&mut rng, n);
        let bytes = encode(&mut rng, &value);
        let got = children(&bytes).unwrap_or_else(|| {
            panic!(
                "round {round}: could not read {}",
                String::from_utf8_lossy(&bytes)
            )
        });
        let want: Vec<Child> = value["children"]
            .as_array()
            .unwrap()
            .iter()
            .map(reference)
            .collect();
        assert_eq!(
            got,
            want,
            "round {round}: {}",
            String::from_utf8_lossy(&bytes)
        );
    }
}

#[test]
fn it_reads_a_real_reply() {
    // Taken from FigCraft 0.18.1 (`node.get` with these fields on a frame of the Ridgeline example).
    let bytes = br##"{"children":[{"childCount":2,"id":80,"layout":{"columnTracks":[],"contentAlign":"auto","crossAlign":"center","crossGap":10,"gap":12,"gridColumns":2,"gridRows":2,"mainAlign":"spaceBetween","mode":"horizontal","padding":[0,16,0,16],"reverseZ":false,"rowTracks":[],"strokesIncluded":true,"wrap":false},"name":"Header","type":"FRAME"},{"boundVariables":{"fill":"VariableID:3"},"childCount":2,"fills":[{"color":"#EAEEF3","type":"solid"}],"id":86,"name":"Search","type":"FRAME"},{"characters":"All trails","fills":[{"color":"#FFFFFF","type":"solid"}],"fontSize":13,"id":16,"name":"Label","styles":{"effect":null,"fill":null,"grid":null,"stroke":null,"text":"S:19"},"type":"TEXT"}],"id":79,"layout":{"mode":"vertical"},"name":"Content","type":"FRAME"}"##;
    let got = children(bytes).unwrap();
    assert_eq!(got.len(), 3);
    assert_eq!(
        got[0].layout,
        Some(Layout {
            auto: true,
            padding: vec![0.0, 16.0, 0.0, 16.0],
            gap: Some(12.0)
        })
    );
    assert!(got[1].bound_fill && got[1].layout.is_none() && got[1].fills.len() == 1);
    assert!(got[2].kind == Kind::Text && got[2].text_style && got[2].font_size == Some(13.0));
}

#[test]
fn a_reply_without_children_is_an_empty_list() {
    assert_eq!(
        children(br#"{"id":5,"name":"Leaf","type":"RECTANGLE"}"#),
        Some(vec![])
    );
    assert_eq!(children(br#"{"children":[]}"#), Some(vec![]));
}

#[test]
fn damaged_replies_never_panic_or_hang() {
    let mut rng = Rng(7);
    for _ in 0..60 {
        let n = rng.below(6);
        let value = reply(&mut rng, n);
        let bytes = encode(&mut rng, &value);
        // every prefix
        for cut in 0..bytes.len() {
            let _ = children(&bytes[..cut]);
        }
        // random byte changes
        for _ in 0..40 {
            let mut damaged = bytes.clone();
            for _ in 0..1 + rng.below(3) {
                let at = rng.below(damaged.len() as u64) as usize;
                damaged[at] = rng.below(256) as u8;
            }
            let _ = children(&damaged);
        }
    }
    for junk in [
        &b""[..],
        b"null",
        b"[]",
        b"{",
        b"{\"children\":",
        b"{\"children\":[",
        b"{\"children\":[{",
        b"\xff\xfe",
        b"{\"children\":[1,2,3]}",
    ] {
        let _ = children(junk);
    }
}

#[test]
fn escapes_in_names_are_decoded() {
    // JSON escapes as text: `bs` is a backslash, so this is a name with \" \ \n é and a surrogate pair.
    let bs = '\x5c';
    let json = format!("{{\"children\":[{{\"id\":1,\"name\":\"a{bs}\"b{bs}{bs}c{bs}nd {bs}u00e9 {bs}ud83d{bs}ude00\",\"type\":\"FRAME\"}}]}}");
    assert!(
        json.contains("\x5cu00e9"),
        "the test input must hold the escape as text: {json}"
    );
    let got = children(json.as_bytes()).unwrap();
    assert_eq!(got[0].name, "a\"b\x5cc\nd \u{e9} \u{1F600}");
}
