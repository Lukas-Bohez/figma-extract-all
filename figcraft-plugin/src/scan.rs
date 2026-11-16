//! A small, allocation-light reader for `node.get` replies.
//!
//! Why not `serde_json::Value`? FigCraft meters plugins by instructions ("fuel", one billion per
//! run), and building a `Value` tree costs about 470 fuel per byte of JSON in WebAssembly: a design
//! of 4,000 layers ran out of budget. This reader walks the bytes once, keeps the few fields the
//! audit needs and skips the rest (`layout` alone is 270 bytes of tracks and alignments that no
//! check looks at). Reading is nearly free: the same reply costs about 20 times less.
//!
//! It is only used for the layer walk, where the volume is. Small replies (variables, styles,
//! components) still go through `serde_json`.
//!
//! Strictness: structure that is not JSON makes [`children`] return `None`; a value of an
//! unexpected type for an optional field is skipped, not an error.

use std::borrow::Cow;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Text,
    Frame,
    Component,
    Instance,
    Other,
}

/// The auto-layout facts the grid check needs.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Layout {
    /// `mode` is present and not "none".
    pub auto: bool,
    pub padding: Vec<f64>,
    pub gap: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Fill<'a> {
    /// `type` is "solid".
    pub solid: bool,
    /// Everything but an explicit `visible: false`.
    pub visible: bool,
    pub color: Option<Cow<'a, str>>,
}

/// One child entry of a `node.get` reply, as far as the audit cares.
#[derive(Debug, Clone, PartialEq)]
pub struct Child<'a> {
    pub id: u64,
    pub name: Cow<'a, str>,
    pub kind: Kind,
    pub child_count: u64,
    pub layout: Option<Layout>,
    pub fills: Vec<Fill<'a>>,
    /// `boundVariables.fill` is set (FigCraft reports the binding of the first fill).
    pub bound_fill: bool,
    pub font_size: Option<f64>,
    /// `styles.text` is set.
    pub text_style: bool,
}

impl Default for Child<'_> {
    fn default() -> Self {
        Child {
            id: 0,
            name: Cow::Borrowed(""),
            kind: Kind::Other,
            child_count: 0,
            layout: None,
            fills: Vec::new(),
            bound_fill: false,
            font_size: None,
            text_style: false,
        }
    }
}

/// The children of a `node.get` reply (`{"children": [...], ...}`). No `children` key: an empty list.
pub fn children(bytes: &[u8]) -> Option<Vec<Child<'_>>> {
    let mut cur = Cur { b: bytes, i: 0 };
    let mut out = Vec::new();
    cur.object(|cur, key| {
        if key == b"children" {
            if cur.peek()? == b'[' {
                cur.array(|cur| {
                    out.push(cur.child()?);
                    Some(())
                })
            } else {
                cur.skip()
            }
        } else {
            cur.skip()
        }
    })?;
    Some(out)
}

struct Cur<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Cur<'a> {
    fn ws(&mut self) {
        while matches!(self.b.get(self.i), Some(b' ' | b'\n' | b'\r' | b'\t')) {
            self.i += 1;
        }
    }

    fn peek(&mut self) -> Option<u8> {
        self.ws();
        self.b.get(self.i).copied()
    }

    fn eat(&mut self, c: u8) -> bool {
        if self.peek() == Some(c) {
            self.i += 1;
            true
        } else {
            false
        }
    }

    /// The bytes between the quotes of the string that starts here, still escaped.
    fn raw_string(&mut self) -> Option<&'a [u8]> {
        if self.peek()? != b'"' {
            return None;
        }
        self.i += 1;
        let start = self.i;
        loop {
            match *self.b.get(self.i)? {
                b'"' => {
                    let raw = &self.b[start..self.i];
                    self.i += 1;
                    return Some(raw);
                }
                b'\\' => self.i += 2,
                _ => self.i += 1,
            }
        }
    }

    fn string(&mut self) -> Option<Cow<'a, str>> {
        let raw = self.raw_string()?;
        if raw.contains(&b'\\') {
            // Escapes are rare (a layer name with a quote or a newline): let serde_json decode them.
            let quoted = &self.b[self.i - raw.len() - 2..self.i];
            serde_json::from_slice::<String>(quoted)
                .ok()
                .map(Cow::Owned)
        } else {
            Some(String::from_utf8_lossy(raw))
        }
    }

    fn number(&mut self) -> Option<f64> {
        self.ws();
        let start = self.i;
        while matches!(
            self.b.get(self.i),
            Some(b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E')
        ) {
            self.i += 1;
        }
        let text = &self.b[start..self.i];
        if text.is_empty() {
            return None;
        }
        // Integers (ids, paddings, sizes) are the common case: no need for the float parser.
        let digits = text.strip_prefix(b"-").unwrap_or(text);
        if digits.len() <= 15 && !digits.is_empty() && digits.iter().all(u8::is_ascii_digit) {
            let n = digits
                .iter()
                .fold(0u64, |n, d| n * 10 + u64::from(d - b'0')) as f64;
            return Some(if text[0] == b'-' { -n } else { n });
        }
        std::str::from_utf8(text).ok()?.parse().ok()
    }

    fn skip(&mut self) -> Option<()> {
        match self.peek()? {
            b'"' => self.raw_string().map(|_| ()),
            b'{' | b'[' => {
                let mut depth = 0usize;
                loop {
                    match *self.b.get(self.i)? {
                        b'"' => {
                            self.raw_string()?;
                            continue;
                        }
                        b'{' | b'[' => depth += 1,
                        b'}' | b']' => {
                            depth = depth.checked_sub(1)?;
                            if depth == 0 {
                                self.i += 1;
                                return Some(());
                            }
                        }
                        _ => {}
                    }
                    self.i += 1;
                }
            }
            _ => {
                // number, true, false, null
                while !matches!(
                    self.b.get(self.i),
                    None | Some(b',' | b'}' | b']' | b' ' | b'\n' | b'\r' | b'\t')
                ) {
                    self.i += 1;
                }
                Some(())
            }
        }
    }

    /// An optional number: another kind of value is skipped and gives `None`.
    fn opt_number(&mut self) -> Option<Option<f64>> {
        match self.peek()? {
            b'0'..=b'9' | b'-' => self.number().map(Some),
            _ => self.skip().map(|()| None),
        }
    }

    /// An optional string: another kind of value is skipped and gives `None`.
    fn opt_string(&mut self) -> Option<Option<Cow<'a, str>>> {
        if self.peek()? == b'"' {
            self.string().map(Some)
        } else {
            self.skip().map(|()| None)
        }
    }

    /// Is the value here `null`? (Consumes it either way.)
    fn is_null(&mut self) -> Option<bool> {
        self.ws();
        let null = self.b[self.i..].starts_with(b"null");
        self.skip()?;
        Some(null)
    }

    /// `{ "key": value, ... }`: `f` is called with each key and must consume the value.
    fn object(&mut self, mut f: impl FnMut(&mut Self, &'a [u8]) -> Option<()>) -> Option<()> {
        if !self.eat(b'{') {
            return None;
        }
        if self.eat(b'}') {
            return Some(());
        }
        loop {
            let key = self.raw_string()?;
            if !self.eat(b':') {
                return None;
            }
            f(self, key)?;
            if self.eat(b',') {
                continue;
            }
            return if self.eat(b'}') { Some(()) } else { None };
        }
    }

    /// `[ value, ... ]`: `f` is called for each element and must consume it.
    fn array(&mut self, mut f: impl FnMut(&mut Self) -> Option<()>) -> Option<()> {
        if !self.eat(b'[') {
            return None;
        }
        if self.eat(b']') {
            return Some(());
        }
        loop {
            f(self)?;
            if self.eat(b',') {
                continue;
            }
            return if self.eat(b']') { Some(()) } else { None };
        }
    }

    fn layout(&mut self) -> Option<Option<Layout>> {
        if self.peek()? != b'{' {
            return self.skip().map(|()| None);
        }
        let mut layout = Layout::default();
        self.object(|cur, key| match key {
            b"mode" => {
                layout.auto = cur.opt_string()?.is_some_and(|m| m != "none");
                Some(())
            }
            b"gap" => {
                layout.gap = cur.opt_number()?;
                Some(())
            }
            b"padding" if cur.peek()? == b'[' => cur.array(|cur| {
                if let Some(n) = cur.opt_number()? {
                    layout.padding.push(n);
                }
                Some(())
            }),
            _ => cur.skip(),
        })?;
        Some(Some(layout))
    }

    fn fills(&mut self) -> Option<Vec<Fill<'a>>> {
        let mut fills = Vec::new();
        if self.peek()? != b'[' {
            self.skip()?;
            return Some(fills);
        }
        self.array(|cur| {
            if cur.peek()? != b'{' {
                return cur.skip();
            }
            let mut fill = Fill {
                solid: false,
                visible: true,
                color: None,
            };
            cur.object(|cur, key| match key {
                b"type" => {
                    fill.solid = cur.opt_string()?.is_some_and(|t| t == "solid");
                    Some(())
                }
                b"color" => {
                    fill.color = cur.opt_string()?;
                    Some(())
                }
                b"visible" => {
                    fill.visible = cur.peek().is_none_or(|c| c != b'f');
                    cur.skip()
                }
                _ => cur.skip(),
            })?;
            fills.push(fill);
            Some(())
        })?;
        Some(fills)
    }

    /// An object whose key `wanted` is "set" (present and not null).
    fn has_set(&mut self, wanted: &'static [u8]) -> Option<bool> {
        if self.peek()? != b'{' {
            self.skip()?;
            return Some(false);
        }
        let mut set = false;
        self.object(|cur, key| {
            if key == wanted {
                set = !cur.is_null()?;
                Some(())
            } else {
                cur.skip()
            }
        })?;
        Some(set)
    }

    fn child(&mut self) -> Option<Child<'a>> {
        let mut c = Child::default();
        self.object(|cur, key| match key {
            b"id" => {
                c.id = cur.opt_number()?.map_or(0, |n| n as u64);
                Some(())
            }
            b"name" => {
                c.name = cur.opt_string()?.unwrap_or(Cow::Borrowed(""));
                Some(())
            }
            b"type" => {
                c.kind = match cur.opt_string()?.as_deref() {
                    Some("TEXT") => Kind::Text,
                    Some("FRAME") => Kind::Frame,
                    Some("COMPONENT") => Kind::Component,
                    Some("INSTANCE") => Kind::Instance,
                    _ => Kind::Other,
                };
                Some(())
            }
            b"childCount" => {
                c.child_count = cur.opt_number()?.map_or(0, |n| n as u64);
                Some(())
            }
            b"fontSize" => {
                c.font_size = cur.opt_number()?;
                Some(())
            }
            b"layout" => {
                c.layout = cur.layout()?;
                Some(())
            }
            b"fills" => {
                c.fills = cur.fills()?;
                Some(())
            }
            b"boundVariables" => {
                c.bound_fill = cur.has_set(b"fill")?;
                Some(())
            }
            b"styles" => {
                c.text_style = cur.has_set(b"text")?;
                Some(())
            }
            _ => cur.skip(),
        })?;
        Some(c)
    }
}
