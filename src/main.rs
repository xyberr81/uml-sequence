// Render a PlantUML-subset sequence diagram to PNG, SVG, or a standalone HTML page.
// Usage: uml-sequence <in.puml> [out.png|out.svg|out.html]   (out defaults to <in>.png)
// Lays the diagram out as black-on-white SVG, then rasterizes PNGs with rsvg-convert. Syntax reference: SKILL.md.
use std::io::Write;
use std::process::{exit, Command, Stdio};

const FONT: f64 = 14.0;
const LINE: f64 = 19.0;
const PAD: f64 = 8.0;
const SELF_W: f64 = 30.0;
const FRAME_PAD: f64 = 14.0;
const FLOW_GAP: f64 = 56.0;
const STEREO: [&str; 5] = ["queue", "boundary", "control", "entity", "collections"];
const KINDS: [&str; 8] = ["participant", "actor", "database", "queue", "boundary", "control", "entity", "collections"];
const FRAG_KINDS: [&str; 7] = ["alt", "opt", "loop", "par", "break", "critical", "group"];

// ---------------------------------------------------------------- helpers

fn f(n: f64) -> String {
    let r = (n * 10.0).round() / 10.0;
    let r = if r == 0.0 { 0.0 } else { r };
    if r.fract() == 0.0 { format!("{}", r as i64) } else { format!("{:.1}", r) }
}
fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}
fn split_lines(s: &str) -> Vec<String> {
    s.split("\\n").map(|t| t.trim().to_string()).collect()
}
fn unq(s: &str) -> String {
    let s = s.trim();
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') { s[1..s.len() - 1].to_string() } else { s.to_string() }
}
fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}
fn has_ws(s: &str) -> bool {
    s.chars().any(char::is_whitespace)
}
/// `word` at the start of `line`, ending on a word boundary; returns the rest.
fn kw<'a>(line: &'a str, word: &str) -> Option<&'a str> {
    let rest = line.strip_prefix(word)?;
    match rest.chars().next() {
        Some(c) if is_word(c) => None,
        _ => Some(rest),
    }
}
/// `word`, whitespace, then a non-empty rest.
fn kw_ws<'a>(line: &'a str, word: &str) -> Option<&'a str> {
    let rest = line.strip_prefix(word)?;
    if !rest.starts_with(char::is_whitespace) {
        return None;
    }
    let r = rest.trim_start();
    if r.is_empty() { None } else { Some(r) }
}

// Conservative width estimate: overshooting only adds whitespace, undershooting overlaps text.
fn char_w(c: char) -> f64 {
    if " il.,:;|!'`".contains(c) {
        0.3
    } else if "IJfjrt()[]{}-/\\\"".contains(c) {
        0.4
    } else if "mwMW@%".contains(c) {
        0.9
    } else if c.is_ascii_uppercase() {
        0.7
    } else {
        0.58
    }
}
fn text_w(s: &str, st: &TextStyle) -> f64 {
    s.chars().map(char_w).sum::<f64>() * st.size * if st.bold { 1.1 } else { 1.0 }
}

// ---------------------------------------------------------------- style

#[derive(Clone, Copy)]
struct TextStyle {
    size: f64,
    bold: bool,
    italic: bool,
}
const PLAIN: TextStyle = TextStyle { size: FONT, bold: false, italic: false };
const BOLD: TextStyle = TextStyle { bold: true, ..PLAIN };
const ITALIC: TextStyle = TextStyle { italic: true, ..PLAIN };
const STEREO_TEXT: TextStyle = TextStyle { size: 12.0, ..ITALIC };
const TITLE: TextStyle = TextStyle { size: 16.0, ..BOLD };
const FONT_FAMILY: &str = "Helvetica, Arial, sans-serif";
const BOX: &str = "fill=\"#fff\" stroke=\"#000\" stroke-width=\"1.2\"";
const OUTLINE: &str = "fill=\"none\" stroke=\"#000\" stroke-width=\"1.2\"";
const DASH: &str = " stroke-dasharray=\"6 4\"";
const BAR_W: f64 = 10.0;
const LABEL_GAP: f64 = 6.0;


struct Part {
    id: String,
    name: String,
    kind: String,
}
struct Msg {
    from: usize,
    to: usize,
    dashed: bool,
    filled: bool,
    md: Option<&'static str>,
    lines: Vec<String>,
    num: Option<i64>,
}
#[derive(Clone, Copy, PartialEq)]
enum Pos {
    Over,
    Left,
    Right,
}
struct Note {
    pos: Pos,
    targets: Vec<usize>,
    lines: Vec<String>,
}
struct Section {
    guard: String,
    events: Vec<Ev>,
}
struct Frag {
    kind: String,
    sections: Vec<Section>,
}
enum Ev {
    Msg(Msg),
    Divider(Vec<String>),
    Delay(Vec<String>),
    Space,
    Note(Note),
    Act(usize),
    Deact(usize),
    Frag(Frag),
}
struct Diagram {
    parts: Vec<Part>,
    events: Vec<Ev>,
    title: Option<Vec<String>>,
    footbox: bool,
}

// ---------------------------------------------------------------- parse

struct Parser {
    parts: Vec<Part>,
    root: Vec<Ev>,
    open: Vec<Frag>,
}
impl Parser {
    fn ensure(&mut self, id: &str) -> usize {
        if let Some(i) = self.parts.iter().position(|p| p.id == id) {
            return i;
        }
        self.parts.push(Part { id: id.into(), name: id.into(), kind: "participant".into() });
        self.parts.len() - 1
    }
    fn push(&mut self, e: Ev) {
        match self.open.last_mut() {
            Some(fr) => fr.sections.last_mut().unwrap().events.push(e),
            None => self.root.push(e),
        }
    }
}

fn strip_colors(s: &str) -> String {
    let cs: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < cs.len() {
        if cs[i].is_whitespace() {
            let mut j = i;
            while j < cs.len() && cs[j].is_whitespace() {
                j += 1;
            }
            if j < cs.len() && cs[j] == '#' {
                let mut k = j + 1;
                while k < cs.len() && is_word(cs[k]) {
                    k += 1;
                }
                if k > j + 1 {
                    i = k;
                    continue;
                }
            }
            out.extend(&cs[i..j]);
            i = j;
            continue;
        }
        out.push(cs[i]);
        i += 1;
    }
    out
}
fn strip_order(s: &str) -> String {
    let toks: Vec<&str> = s.split_whitespace().collect();
    for w in 0..toks.len().saturating_sub(1) {
        if w > 0 && toks[w] == "order" && toks[w + 1].chars().all(|c| c.is_ascii_digit()) {
            let mut kept: Vec<&str> = toks[..w].to_vec();
            kept.extend(&toks[w + 2..]);
            return kept.join(" ");
        }
    }
    s.to_string()
}
fn after_as(r: &str) -> Option<&str> {
    if !r.starts_with(char::is_whitespace) {
        return None;
    }
    let t = r.trim_start().strip_prefix("as")?;
    if !t.starts_with(char::is_whitespace) {
        return None;
    }
    Some(t.trim_start())
}
fn quoted_whole(s: &str) -> Option<&str> {
    if s.len() >= 3 && s.starts_with('"') && s.ends_with('"') && !s[1..s.len() - 1].contains('"') {
        Some(&s[1..s.len() - 1])
    } else {
        None
    }
}
/// Returns (display name, id).
fn parse_decl(s: &str) -> Option<(String, String)> {
    if let Some(body) = s.strip_prefix('"') {
        if let Some(j) = body.find('"') {
            if j > 0 {
                if let Some(id) = after_as(&body[j + 1..]) {
                    if !id.is_empty() && !has_ws(id) {
                        return Some((body[..j].into(), id.into()));
                    }
                }
            }
        }
    }
    let tok_end = s.find(char::is_whitespace).unwrap_or(s.len());
    let tok = &s[..tok_end];
    if let Some(r) = after_as(&s[tok_end..]) {
        if let Some(name) = quoted_whole(r) {
            return Some((name.into(), tok.into()));
        }
        if !r.is_empty() && !has_ws(r) {
            return Some((tok.into(), r.into()));
        }
    }
    if let Some(name) = quoted_whole(s) {
        return Some((name.into(), name.into()));
    }
    if !s.is_empty() && !has_ws(s) {
        return Some((s.into(), s.into()));
    }
    None
}
fn take_name(s: &str) -> Option<(&str, &str)> {
    if let Some(body) = s.strip_prefix('"') {
        let j = body.find('"')?;
        if j == 0 {
            return None;
        }
        return Some((&s[..j + 2], &body[j + 1..]));
    }
    let end = s.find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '.')).unwrap_or(s.len());
    if end == 0 { None } else { Some((&s[..end], &s[end..])) }
}
/// Returns (arrow with any `[#color]` removed, rest).
fn take_arrow(s: &str) -> Option<(String, &str)> {
    let b = s.as_bytes();
    let mut i = b.iter().take(2).take_while(|&&c| c == b'<').count();
    let mut arrow = s[..i].to_string();
    let mut d = 0;
    while d < 2 && b.get(i) == Some(&b'-') {
        i += 1;
        d += 1;
        arrow.push('-');
        if d == 1 && b.get(i) == Some(&b'[') {
            i += s[i..].find(']')? + 1;
        }
    }
    if d == 0 {
        return None;
    }
    if !arrow.starts_with('<') {
        if b.get(i) != Some(&b'>') {
            return None;
        }
        i += 1;
        arrow.push('>');
        if b.get(i) == Some(&b'>') {
            i += 1;
            arrow.push('>');
        }
    }
    Some((arrow, &s[i..]))
}
struct RawMsg<'a> {
    a: &'a str,
    arrow: String,
    b: &'a str,
    md: Option<&'static str>,
    label: Option<&'a str>,
}
fn parse_msg(line: &str) -> Option<RawMsg<'_>> {
    let (a, r) = take_name(line)?;
    let (arrow, r) = take_arrow(r.trim_start())?;
    let (b, r) = take_name(r.trim_start())?;
    let r = r.trim_start();
    let (md, r) = if let Some(x) = r.strip_prefix("++") {
        (Some("++"), x)
    } else if let Some(x) = r.strip_prefix("--") {
        (Some("--"), x)
    } else {
        (None, r)
    };
    let r = r.trim_start();
    let label = if r.is_empty() { None } else { Some(r.strip_prefix(':')?.trim_start()) };
    Some(RawMsg { a, arrow, b, md, label })
}
/// Returns (position, targets text, inline text if any).
fn parse_note(line: &str) -> Option<(Pos, &str, Option<&str>)> {
    let low = line.to_ascii_lowercase();
    let skip = if low.starts_with("hnote") || low.starts_with("rnote") {
        5
    } else if low.starts_with("note") {
        4
    } else {
        return None;
    };
    let r = &line[skip..];
    if !r.starts_with(char::is_whitespace) {
        return None;
    }
    let r = r.trim_start();
    let lr = r.to_ascii_lowercase();
    let (pos, plen) = if lr.starts_with("over") {
        (Pos::Over, 4)
    } else if lr.starts_with("left of") {
        (Pos::Left, 7)
    } else if lr.starts_with("right of") {
        (Pos::Right, 8)
    } else {
        return None;
    };
    let r = &r[plen..];
    if !r.starts_with(char::is_whitespace) {
        return None;
    }
    let r = r.trim_start();
    let (targets, text) = match r.find(':') {
        Some(j) => (r[..j].trim_end(), Some(r[j + 1..].trim_start())),
        None => (r, None),
    };
    if targets.is_empty() { None } else { Some((pos, targets, text)) }
}
fn is_end_note(line: &str) -> bool {
    let l = line.to_ascii_lowercase();
    l == "endnote" || (l.len() == 8 && l.starts_with("end") && l.ends_with("note") && l.as_bytes()[3].is_ascii_whitespace())
}

fn parse(src: &str, warnings: &mut Vec<String>) -> Diagram {
    let mut p = Parser { parts: vec![], root: vec![], open: vec![] };
    let mut title = None;
    let mut num: Option<i64> = None;
    let mut footbox = true;
    let mut note: Option<Note> = None;
    let mut skip_block = false;

    for (i, raw) in src.lines().enumerate() {
        let line = raw.trim();
        let ln = i + 1;
        if note.is_some() {
            if is_end_note(line) {
                let n = note.take().unwrap();
                p.push(Ev::Note(n));
            } else {
                note.as_mut().unwrap().lines.push(line.to_string());
            }
            continue;
        }
        if skip_block {
            if line == "}" {
                skip_block = false;
            }
            continue;
        }
        if line.is_empty() || line.starts_with('\'') || line.starts_with('!') || line.starts_with("@startuml") || line.starts_with("@enduml") {
            continue;
        }
        if kw(line, "skinparam").is_some() {
            skip_block = line.ends_with('{');
            continue;
        }
        if line.to_ascii_lowercase().split_whitespace().eq(["hide", "footbox"]) {
            footbox = false;
            continue;
        }
        if ["hide", "show", "scale", "autoactivate"].iter().any(|w| kw(line, w).is_some()) {
            continue;
        }
        if let Some(r) = kw_ws(line, "title") {
            title = Some(split_lines(r));
            continue;
        }
        if let Some(r) = line.strip_prefix("autonumber") {
            let tok = if r.starts_with(char::is_whitespace) { r.split_whitespace().next() } else { None };
            num = match tok {
                Some("stop") => None,
                Some(t) => Some(t.parse::<i64>().ok().filter(|&v| v != 0).unwrap_or(1)),
                None => Some(1),
            };
            continue;
        }
        if let Some((kind, rest)) = KINDS.iter().find_map(|k| kw_ws(line, k).map(|r| (*k, r))) {
            let rest = strip_order(&strip_colors(rest));
            match parse_decl(rest.trim()) {
                Some((name, id)) => {
                    let i = p.ensure(&id);
                    p.parts[i].name = name;
                    p.parts[i].kind = kind.into();
                }
                None => warnings.push(format!("line {ln}: bad participant, skipped: {line}")),
            }
            continue;
        }
        if line.len() >= 4 && line.starts_with("==") && line.ends_with("==") {
            p.push(Ev::Divider(split_lines(line[2..line.len() - 2].trim())));
            continue;
        }
        if let Some(r) = line.strip_prefix("...") {
            let r = r.trim_start();
            let text = if r.is_empty() { Some("") } else { r.strip_suffix("...").map(str::trim_end) };
            if let Some(t) = text {
                p.push(Ev::Delay(if t.is_empty() { vec![] } else { split_lines(t) }));
                continue;
            }
        }
        if line.len() >= 3 && line.starts_with("||") && line.ends_with('|') && line[2..line.len() - 1].chars().all(|c| c.is_ascii_digit()) {
            p.push(Ev::Space);
            continue;
        }
        if let Some((k, rest)) = FRAG_KINDS.iter().find_map(|k| kw(line, k).map(|r| (*k, r.trim_start()))) {
            let (kind, guard) = if k == "group" {
                (if rest.is_empty() { "group".to_string() } else { rest.to_string() }, String::new())
            } else {
                (k.to_string(), rest.to_string())
            };
            p.open.push(Frag { kind, sections: vec![Section { guard, events: vec![] }] });
            continue;
        }
        if let Some(rest) = kw(line, "else") {
            match p.open.last_mut() {
                Some(fr) => fr.sections.push(Section { guard: rest.trim_start().into(), events: vec![] }),
                None => warnings.push(format!("line {ln}: else outside a fragment")),
            }
            continue;
        }
        if line == "end" {
            match p.open.pop() {
                Some(fr) => p.push(Ev::Frag(fr)),
                None => warnings.push(format!("line {ln}: end without a fragment")),
            }
            continue;
        }
        if let Some((pos, targets, text)) = parse_note(line) {
            let targets = targets.split(',').map(|s| p.ensure(&unq(s))).collect();
            let mut e = Note { pos, targets, lines: vec![] };
            match text {
                Some(t) => {
                    e.lines = split_lines(t);
                    p.push(Ev::Note(e));
                }
                None => note = Some(e),
            }
            continue;
        }
        if let Some((w, r)) = ["activate", "deactivate", "destroy"].iter().find_map(|w| kw_ws(line, w).map(|r| (*w, r))) {
            let i = p.ensure(&unq(r));
            p.push(if w == "activate" { Ev::Act(i) } else { Ev::Deact(i) });
            continue;
        }
        if let Some(m) = parse_msg(line) {
            let mut from = p.ensure(&unq(m.a));
            let mut to = p.ensure(&unq(m.b));
            if m.arrow.starts_with('<') {
                std::mem::swap(&mut from, &mut to);
            }
            // Sync calls get a filled head; replies (`-->`) are dashed; async (`->>`) and replies get an open head.
            let dashed = m.arrow.contains("--");
            let filled = !(dashed || m.arrow.contains("<<") || m.arrow.contains(">>"));
            let e = Msg { from, to, dashed, filled, md: m.md, lines: split_lines(m.label.unwrap_or("")), num };
            if let Some(n) = num.as_mut() {
                *n += 1;
            }
            p.push(Ev::Msg(e));
            continue;
        }
        warnings.push(format!("line {ln}: unsupported, skipped: {line}"));
    }
    if note.is_some() {
        warnings.push("unclosed note (missing \"end note\")".into());
    }
    if !p.open.is_empty() {
        warnings.push(format!("{} unclosed fragment(s) (missing \"end\")", p.open.len()));
    }
    while let Some(fr) = p.open.pop() {
        p.push(Ev::Frag(fr));
    }
    Diagram { parts: p.parts, events: p.root, title, footbox }
}

// ---------------------------------------------------------------- layout + draw

fn msg_lines(m: &Msg) -> &[String] {
    if m.lines.len() == 1 && m.lines[0].is_empty() && m.num.is_none() { &[] } else { &m.lines }
}
fn num_text(m: &Msg) -> String {
    m.num.map(|n| format!("{n}. ")).unwrap_or_default()
}
fn label_w(m: &Msg) -> f64 {
    msg_lines(m)
        .iter()
        .enumerate()
        .map(|(k, l)| text_w(l, &PLAIN) + if k == 0 { text_w(&num_text(m), &BOLD) } else { 0.0 })
        .fold(0.0, f64::max)
}
fn note_w(n: &Note) -> f64 {
    n.lines.iter().map(|l| text_w(l, &PLAIN)).fold(f64::NEG_INFINITY, f64::max) + 2.0 * PAD + 8.0
}
fn head(tip_x: f64, y: f64, dir: f64, filled: bool) -> String {
    let bx = tip_x - dir * 10.0;
    if filled {
        format!("<polygon points=\"{},{} {},{} {},{}\" fill=\"#000\"/>", f(tip_x), f(y), f(bx), f(y - 4.5), f(bx), f(y + 4.5))
    } else {
        format!(
            "<polyline points=\"{},{} {},{} {},{}\" {OUTLINE}/>",
            f(bx), f(y - 5.0), f(tip_x), f(y), f(bx), f(y + 5.0)
        )
    }
}

struct Seg<'a> {
    s: &'a str,
    st: TextStyle,
    dx: f64,
}
#[derive(Clone, Copy)]
struct Opts {
    anchor: &'static str,
    bg: bool,
    st: TextStyle,
}

struct Head {
    w: f64,
    h: f64,
    lines: Vec<String>,
    stereo: Option<String>,
}

struct R<'a> {
    parts: &'a [Part],
    x: Vec<f64>,
    heads: Vec<Head>,
    head_h: f64,
    min_x: f64,
    max_x: f64,
    frames: Vec<String>,
    bars: Vec<String>,
    front: Vec<String>,
    act: Vec<Vec<f64>>,
    dividers: Vec<(f64, Vec<String>)>,
    y: f64,
    rows_top: f64,
    center_x: f64,
    last_arrow: Option<f64>,
    warnings: Vec<String>,
}

impl R<'_> {
    fn track(&mut self, a: f64, b: f64) {
        self.min_x = self.min_x.min(a);
        self.max_x = self.max_x.max(b);
    }

    // Text with an optional paper backing so lines passing behind it never cut through glyphs.
    // Attributes are written only where they differ from the <svg> root (or, on a tspan, from the <text>).
    fn text(&mut self, x0: f64, y: f64, segs: &[Seg], o: Opts) -> String {
        let w = segs.iter().fold(0.0, |acc, sg| acc + text_w(sg.s, &sg.st) + sg.dx);
        let left = match o.anchor {
            "middle" => x0 - w / 2.0,
            "end" => x0 - w,
            _ => x0,
        };
        self.track(left, left + w);
        let st = o.st;
        let mut out = String::new();
        if o.bg {
            out += &format!(
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"#fff\"/>",
                f(left - 3.0), f(y - st.size * 0.85), f(w + 6.0), f(st.size * 1.1)
            );
        }
        let mut attrs = format!("x=\"{}\" y=\"{}\"", f(x0), f(y));
        if o.anchor != "start" {
            attrs += &format!(" text-anchor=\"{}\"", o.anchor);
        }
        if st.size != FONT {
            attrs += &format!(" font-size=\"{}\"", f(st.size));
        }
        if st.italic {
            attrs += " font-style=\"italic\"";
        }
        let body: String = segs
            .iter()
            .map(|sg| {
                let s = &sg.st;
                let mut a = String::new();
                if s.bold {
                    a += " font-weight=\"bold\"";
                }
                if s.size != st.size {
                    a += &format!(" font-size=\"{}\"", f(s.size));
                }
                if sg.dx != 0.0 {
                    a += &format!(" dx=\"{}\"", f(sg.dx));
                }
                let body = esc(sg.s);
                if a.is_empty() { body } else { format!("<tspan{a}>{body}</tspan>") }
            })
            .collect();
        out += &format!("<text {attrs}>{body}</text>");
        out
    }
    fn text1(&mut self, x: f64, y: f64, s: &str, anchor: &'static str, bg: bool, st: TextStyle) -> String {
        self.text(x, y, &[Seg { s, st, dx: 0.0 }], Opts { anchor, bg, st })
    }

    fn note_box(&self, n: &Note) -> (f64, f64) {
        let xs: Vec<f64> = n.targets.iter().map(|&i| self.x[i]).collect();
        let w = note_w(n);
        match n.pos {
            Pos::Over => {
                let lo = xs.iter().cloned().fold(f64::INFINITY, f64::min);
                let hi = xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
                let w = w.max(hi - lo + if xs.len() > 1 { 40.0 } else { 0.0 });
                ((lo + hi) / 2.0 - w / 2.0, w)
            }
            Pos::Right => (xs[0] + 12.0, w),
            Pos::Left => (xs[0] - 12.0 - w, w),
        }
    }

    fn extent(&self, evs: &[Ev]) -> (f64, f64) {
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        let mut inc = |a: f64, b: f64| {
            lo = lo.min(a);
            hi = hi.max(b);
        };
        for e in evs {
            match e {
                Ev::Msg(m) => {
                    let (a, b) = (self.x[m.from], self.x[m.to]);
                    if m.from == m.to { inc(a, a + SELF_W + 12.0 + label_w(m)) } else { inc(a.min(b), a.max(b)) }
                }
                Ev::Note(n) => {
                    let (x0, w) = self.note_box(n);
                    inc(x0, x0 + w);
                }
                Ev::Act(p) | Ev::Deact(p) => inc(self.x[*p] - BAR_W / 2.0, self.x[*p] + BAR_W / 2.0),
                Ev::Frag(fr) => {
                    let (l, r, _) = self.frag_rect(fr);
                    inc(l, r);
                }
                _ => {}
            }
        }
        (lo, hi)
    }

    /// (left, right, tab width)
    fn frag_rect(&self, fr: &Frag) -> (f64, f64, f64) {
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for s in &fr.sections {
            let (a, b) = self.extent(&s.events);
            lo = lo.min(a);
            hi = hi.max(b);
        }
        if !lo.is_finite() {
            lo = self.x[0];
            hi = self.x[self.x.len() - 1];
        }
        let l = lo - FRAME_PAD;
        let tab_w = text_w(&fr.kind, &BOLD) + 20.0;
        let guard_w = |s: &Section| if s.guard.is_empty() { 0.0 } else { text_w(&format!("[{}]", s.guard), &PLAIN) };
        let mut r = (hi + FRAME_PAD).max(l + tab_w + 8.0 + guard_w(&fr.sections[0]) + 12.0);
        for s in &fr.sections[1..] {
            r = r.max(l + 8.0 + guard_w(s) + 12.0);
        }
        (l, r, tab_w)
    }

    fn draw_part(&mut self, i: usize, top: f64, is_foot: bool) -> String {
        let cx = self.x[i];
        let (w, h) = (self.heads[i].w, self.heads[i].h);
        let lines = self.heads[i].lines.clone();
        let stereo = self.heads[i].stereo.clone();
        let kind = self.parts[i].kind.as_str();
        let by = if is_foot { top } else { top + self.head_h - h };
        let l = cx - w / 2.0;
        self.track(l, l + w);
        let mut out = String::new();
        if kind == "actor" {
            out += &format!(
                "<g {OUTLINE}><circle cx=\"{}\" cy=\"{}\" r=\"7\" fill=\"#fff\"/><path d=\"M{} {}V{}M{} {}H{}M{} {}L{} {}L{} {}\"/></g>",
                f(cx), f(by + 8.0),
                f(cx), f(by + 15.0), f(by + 28.0),
                f(cx - 11.0), f(by + 19.0), f(cx + 11.0),
                f(cx - 9.0), f(by + 40.0), f(cx), f(by + 28.0), f(cx + 9.0), f(by + 40.0)
            );
            for (k, t) in lines.iter().enumerate() {
                out += &self.text1(cx, by + 44.0 + FONT - 1.0 + k as f64 * LINE, t, "middle", false, PLAIN);
            }
            return out;
        }
        let mut ty = by + PAD + FONT;
        if kind == "database" {
            let r = w / 2.0;
            out += &format!(
                "<path d=\"M{} {}A{} 6 0 0 1 {} {}V{}A{} 6 0 0 1 {} {}Z\" {BOX}/><path d=\"M{} {}A{} 6 0 0 0 {} {}\" {OUTLINE}/>",
                f(l), f(by + 6.0), f(r), f(l + w), f(by + 6.0), f(by + h - 6.0), f(r), f(l), f(by + h - 6.0),
                f(l), f(by + 6.0), f(r), f(l + w), f(by + 6.0)
            );
            ty += 12.0;
        } else {
            out += &format!(
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" {BOX}/>",
                f(l), f(by), f(w), f(h)
            );
        }
        if let Some(st) = &stereo {
            out += &self.text1(cx, ty - 2.0, st, "middle", false, STEREO_TEXT);
            ty += LINE - 4.0;
        }
        for (k, t) in lines.iter().enumerate() {
            out += &self.text1(cx, ty + k as f64 * LINE, t, "middle", false, PLAIN);
        }
        out
    }

    fn edge(&self, p: usize, side: f64) -> f64 {
        let d = self.act[p].len() as f64;
        self.x[p] + if d > 0.0 { side * BAR_W / 2.0 + (d - 1.0) * 5.0 } else { 0.0 }
    }

    fn close_bar(&mut self, p: usize, end: f64) {
        let depth = self.act[p].len() as f64;
        let Some(start) = self.act[p].pop() else {
            self.warnings.push(format!("deactivate {} without an active bar", self.parts[p].id));
            return;
        };
        let bx = self.x[p] - BAR_W / 2.0 + (depth - 1.0) * 5.0;
        self.bars.push(format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" {BOX}/>",
            f(bx), f(start), f(BAR_W), f((end - start).max(10.0))
        ));
    }

    fn rows(&mut self, evs: &[Ev]) {
        for e in evs {
            let prev = self.last_arrow.take();
            match e {
                Ev::Msg(m) => self.msg(m),
                Ev::Act(p) => {
                    let start = prev.unwrap_or(self.y);
                    self.act[*p].push(start);
                    if prev.is_none() {
                        self.y += 6.0;
                    }
                    self.last_arrow = prev;
                }
                Ev::Deact(p) => {
                    self.close_bar(*p, prev.unwrap_or(self.y));
                    if prev.is_none() {
                        self.y += 6.0;
                    }
                    self.last_arrow = prev;
                }
                Ev::Divider(lines) => {
                    // A divider starts a separate flow: leave a wide gap so the flows read apart.
                    self.y += if self.y == self.rows_top { 8.0 } else { FLOW_GAP };
                    self.dividers.push((self.y, lines.clone()));
                    self.y += lines.len() as f64 * LINE + 30.0;
                }
                Ev::Delay(lines) => {
                    self.y += 6.0;
                    for (k, l) in lines.iter().enumerate() {
                        let t = self.text1(self.center_x, self.y + FONT + k as f64 * LINE, l, "middle", true, ITALIC);
                        self.front.push(t);
                    }
                    self.y += lines.len().max(1) as f64 * LINE + 12.0;
                }
                Ev::Space => self.y += 24.0,
                Ev::Note(n) => {
                    let (x0, w) = self.note_box(n);
                    let top = self.y + 4.0;
                    let h = n.lines.len() as f64 * LINE + 2.0 * PAD - 2.0;
                    self.front.push(format!(
                        "<path d=\"M{} {}H{}L{} {}V{}H{}Z\" {BOX}/><path d=\"M{} {}V{}H{}\" fill=\"none\" stroke=\"#000\" stroke-width=\"1\"/>",
                        f(x0), f(top), f(x0 + w - 8.0), f(x0 + w), f(top + 8.0), f(top + h), f(x0),
                        f(x0 + w - 8.0), f(top), f(top + 8.0), f(x0 + w)
                    ));
                    for (k, l) in n.lines.iter().enumerate() {
                        let t = self.text1(x0 + PAD, top + PAD + FONT - 3.0 + k as f64 * LINE, l, "start", false, PLAIN);
                        self.front.push(t);
                    }
                    self.track(x0, x0 + w);
                    self.y = top + h + 12.0;
                }
                Ev::Frag(fr) => self.frag(fr),
            }
        }
    }

    fn msg(&mut self, m: &Msg) {
        let lines = msg_lines(m);
        let n = lines.len() as f64;
        let num = m.num.map(|v| format!("{v}."));
        let line_dash = if m.dashed { DASH } else { "" };
        let (st, num_st) = (PLAIN, BOLD);
        let draw = |me: &mut Self, x: f64, y: f64, k: usize, l: &str, anchor: &'static str| {
            let segs = match (&num, k) {
                (Some(nt), 0) => vec![Seg { s: nt, st: num_st, dx: 0.0 }, Seg { s: l, st, dx: 5.0 }],
                _ => vec![Seg { s: l, st, dx: 0.0 }],
            };
            let t = me.text(x, y, &segs, Opts { anchor, bg: true, st });
            me.front.push(t);
        };
        if m.from == m.to {
            let cx = self.edge(m.from, 1.0);
            let top = self.y + 4.0;
            let h = (n * LINE - 2.0).max(16.0);
            self.front.push(format!(
                "<polyline points=\"{},{} {},{} {},{} {},{}\" {OUTLINE}{}/>",
                f(cx), f(top), f(cx + SELF_W), f(top), f(cx + SELF_W), f(top + h), f(cx), f(top + h), line_dash
            ));
            self.front.push(head(cx, top + h, -1.0, m.filled));
            for (k, l) in lines.iter().enumerate() {
                draw(self, cx + SELF_W + 8.0, top + FONT - 3.0 + k as f64 * LINE, k, l, "start");
            }
            self.last_arrow = Some(top);
            self.y = top + h + 14.0;
        } else {
            self.y += n * LINE + 2.0;
            let ay = self.y;
            if m.md == Some("++") {
                self.act[m.to].push(ay);
            }
            let right = m.to > m.from;
            let side = if right { 1.0 } else { -1.0 };
            let (x1, x2) = (self.edge(m.from, side), self.edge(m.to, -side));
            self.front.push(format!(
                "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#000\" stroke-width=\"1.2\"{}/>",
                f(x1), f(ay), f(x2), f(ay), line_dash
            ));
            self.front.push(head(x2, ay, side, m.filled));
            let mid = (self.x[m.from] + self.x[m.to]) / 2.0;
            for (k, l) in lines.iter().enumerate() {
                draw(self, mid, ay - LABEL_GAP - (n - 1.0 - k as f64) * LINE, k, l, "middle");
            }
            if m.md == Some("--") {
                self.close_bar(m.from, ay);
            }
            self.last_arrow = Some(ay);
            self.y = ay + 14.0;
        }
    }

    fn frag(&mut self, fr: &Frag) {
        let (l, r, tab_w) = self.frag_rect(fr);
        self.track(l, r);
        self.y += 6.0;
        let top = self.y;
        let tab_h = LINE + 4.0;
        self.front.push(format!(
            "<path d=\"M{} {}H{}V{}L{} {}H{}Z\" {BOX}/>",
            f(l), f(top), f(l + tab_w), f(top + tab_h - 7.0), f(l + tab_w - 7.0), f(top + tab_h), f(l)
        ));
        let t = self.text1(l + 8.0, top + FONT + 1.0, &fr.kind, "start", false, BOLD);
        self.front.push(t);
        if !fr.sections[0].guard.is_empty() {
            let g = format!("[{}]", fr.sections[0].guard);
            let t = self.text1(l + tab_w + 8.0, top + FONT + 1.0, &g, "start", true, PLAIN);
            self.front.push(t);
        }
        self.y = top + tab_h + 10.0;
        for (i, s) in fr.sections.iter().enumerate() {
            if i > 0 {
                self.y += 2.0;
                self.frames.push(format!(
                    "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#000\" stroke-width=\"1\" stroke-dasharray=\"4 3\"/>",
                    f(l), f(self.y), f(r), f(self.y)
                ));
                if !s.guard.is_empty() {
                    let g = format!("[{}]", s.guard);
                    let t = self.text1(l + 8.0, self.y + FONT + 2.0, &g, "start", true, PLAIN);
                    self.front.push(t);
                }
                self.y += LINE + 10.0;
            }
            self.rows(&s.events);
        }
        self.y += 4.0;
        self.frames.push(format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" {OUTLINE}/>",
            f(l), f(top), f(r - l), f(self.y - top)
        ));
        self.y += 8.0;
    }
}

fn walk(evs: &[Ev], fun: &mut dyn FnMut(&Ev)) {
    for e in evs {
        fun(e);
        if let Ev::Frag(fr) = e {
            for s in &fr.sections {
                walk(&s.events, fun);
            }
        }
    }
}

fn render(d: &Diagram, warnings: &mut Vec<String>) -> String {
    let n = d.parts.len();
    if n == 0 {
        eprintln!("error: no participants or messages found");
        exit(1);
    }
    let heads: Vec<Head> = d
        .parts
        .iter()
        .map(|p| {
            let lines = split_lines(&p.name);
            let name_w = lines.iter().map(|l| text_w(l, &PLAIN)).fold(f64::NEG_INFINITY, f64::max);
            if p.kind == "actor" {
                return Head { w: name_w.max(40.0) + 2.0 * PAD, h: 44.0 + lines.len() as f64 * LINE, lines, stereo: None };
            }
            let stereo = STEREO.contains(&p.kind.as_str()).then(|| format!("«{}»", p.kind));
            let st_w = stereo.as_deref().map_or(0.0, |s| text_w(s, &STEREO_TEXT));
            let w = (name_w.max(st_w) + 2.0 * PAD + 8.0).max(70.0);
            let h = lines.len() as f64 * LINE
                + 2.0 * PAD
                + if stereo.is_some() { LINE - 4.0 } else { 0.0 }
                + if p.kind == "database" { 12.0 } else { 0.0 };
            Head { w, h, lines, stereo }
        })
        .collect();
    let head_h = heads.iter().map(|h| h.h).fold(f64::NEG_INFINITY, f64::max);

    // Column gaps: start from header widths, then widen until every label fits its span.
    let mut g: Vec<f64> = (0..n - 1).map(|i| (heads[i].w + heads[i + 1].w) / 2.0 + 24.0).collect();
    let mut cons: Vec<(usize, usize, f64)> = vec![];
    walk(&d.events, &mut |e| match e {
        Ev::Msg(m) => {
            let (a, b) = (m.from, m.to);
            if a == b {
                if a < n - 1 {
                    cons.push((a, a + 1, SELF_W + 12.0 + label_w(m) + 16.0));
                }
            } else {
                cons.push((a.min(b), a.max(b), label_w(m) + 40.0));
            }
        }
        Ev::Note(nt) => {
            let i = nt.targets[0];
            if nt.pos == Pos::Right && i < n - 1 {
                cons.push((i, i + 1, note_w(nt) + 24.0));
            }
            if nt.pos == Pos::Left && i > 0 {
                cons.push((i - 1, i, note_w(nt) + 24.0));
            }
        }
        _ => {}
    });
    cons.sort_by_key(|c| c.1 - c.0);
    for (a, b, need) in cons {
        let cur: f64 = g[a..b].iter().sum();
        if cur < need {
            let add = (need - cur) / (b - a) as f64;
            for gi in &mut g[a..b] {
                *gi += add;
            }
        }
    }
    let mut x = vec![0.0];
    for (i, gap) in g.iter().enumerate() {
        x.push(x[i] + gap);
    }

    let title_lh = TITLE.size * 1.375;
    let title_h = d.title.as_ref().map_or(0.0, |l| l.len() as f64 * title_lh + 16.0);
    let top0 = 16.0 + title_h;
    let rows_top = top0 + head_h + 18.0;
    let center_x = (x[0] + x[n - 1]) / 2.0;
    let mut r = R {
        parts: &d.parts,
        x,
        heads,
        head_h,
        min_x: f64::INFINITY,
        max_x: f64::NEG_INFINITY,
        frames: vec![],
        bars: vec![],
        front: vec![],
        act: vec![vec![]; n],
        dividers: vec![],
        y: rows_top,
        rows_top,
        center_x,
        last_arrow: None,
        warnings: vec![],
    };

    let head_svgs: Vec<String> = (0..n).map(|i| r.draw_part(i, top0, false)).collect();
    r.rows(&d.events);
    r.y += 6.0;
    for p in 0..n {
        while !r.act[p].is_empty() {
            let y = r.y;
            r.close_bar(p, y);
        }
    }
    r.y += 8.0;
    let life_top = top0 + head_h;
    let lifelines: Vec<String> = (0..n)
        .map(|p| format!("<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#000\" stroke-width=\"1\"{DASH}/>", f(r.x[p]), f(life_top), f(r.x[p]), f(r.y)))
        .collect();
    let foot_top = r.y;
    let foot_svgs: Vec<String> = if d.footbox { (0..n).map(|i| r.draw_part(i, foot_top, true)).collect() } else { vec![] };
    let max_h = r.heads.iter().map(|h| h.h).fold(f64::NEG_INFINITY, f64::max);
    let bottom = (if d.footbox { r.y + max_h } else { r.y }) + 16.0;

    for (dy, lines) in std::mem::take(&mut r.dividers) {
        let mid = dy + (lines.len() as f64 * LINE) / 2.0 + 4.0;
        r.frames.push(
            [-2.0, 2.0]
                .iter()
                .map(|o| {
                    format!(
                        "<line x1=\"{a}\" y1=\"{y}\" x2=\"{b}\" y2=\"{y}\" stroke=\"#000\" stroke-width=\"1\"/>",
                        a = f(r.min_x), b = f(r.max_x), y = f(mid + o)
                    )
                })
                .collect(),
        );
        if lines.iter().any(|l| !l.is_empty()) {
            let w = lines.iter().map(|l| text_w(l, &BOLD)).fold(f64::NEG_INFINITY, f64::max) + 2.0 * PAD + 8.0;
            let h = lines.len() as f64 * LINE + 8.0;
            r.front.push(format!(
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" {BOX}/>",
                f(center_x - w / 2.0), f(mid - h / 2.0), f(w), f(h)
            ));
            for (k, l) in lines.iter().enumerate() {
                let tx = r.text1(center_x, mid - h / 2.0 + 4.0 + FONT - 1.0 + k as f64 * LINE, l, "middle", false, BOLD);
                r.front.push(tx);
            }
        }
    }
    if let Some(title) = &d.title {
        let x = (r.min_x + r.max_x) / 2.0;
        for (k, l) in title.iter().enumerate() {
            let tx = r.text1(x, 16.0 + TITLE.size + k as f64 * title_lh, l, "middle", false, TITLE);
            r.front.push(tx);
        }
    }

    let margin = 20.0;
    let w = (r.max_x - r.min_x + 2.0 * margin).ceil();
    let ht = bottom.ceil();
    warnings.append(&mut r.warnings);
    let mut out = vec![
        format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{ht}\" viewBox=\"0 0 {w} {ht}\" font-family=\"{FONT_FAMILY}\" font-size=\"{FONT}\" fill=\"#000\">"),
        format!("<rect width=\"{w}\" height=\"{ht}\" fill=\"#fff\"/>"),
    ];
    out.push(format!("<g transform=\"translate({} 0)\">", f(margin - r.min_x)));
    out.extend(lifelines);
    out.append(&mut r.frames);
    out.append(&mut r.bars);
    out.extend(head_svgs);
    out.extend(foot_svgs);
    out.append(&mut r.front);
    out.push("</g>".into());
    out.push("</svg>".into());
    out.push(String::new());
    out.join("\n")
}

// ---------------------------------------------------------------- main

fn html_page(title: &str, svg: &str) -> String {
    format!(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>{}</title>\n<style>body{{margin:0;padding:24px;background:#fff}}svg{{display:block;max-width:100%;height:auto}}</style>\n</head>\n<body>\n<div style=\"overflow-x:auto\">\n{svg}</div>\n</body>\n</html>\n",
        esc(title)
    )
}
fn usage() -> ! {
    eprintln!("usage: uml-sequence <in.puml> [out.png|out.svg|out.html]");
    exit(2);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() > 2 || args.iter().any(|a| a.starts_with('-')) {
        usage();
    }
    let Some(input) = args.first() else { usage() };
    let output = args.get(1).cloned().unwrap_or_else(|| {
        let low = input.to_ascii_lowercase();
        let stem = [".puml", ".plantuml", ".txt"].iter().find(|e| low.ends_with(*e)).map_or(input.as_str(), |e| &input[..input.len() - e.len()]);
        format!("{stem}.png")
    });
    let src = std::fs::read_to_string(input).unwrap_or_else(|e| {
        eprintln!("error: cannot read {input}: {e}");
        exit(1);
    });
    let mut warnings = vec![];
    let diagram = parse(&src, &mut warnings);
    let svg = render(&diagram, &mut warnings);
    let page = if output.ends_with(".svg") {
        Some(svg.clone())
    } else if output.ends_with(".html") {
        let title = diagram.title.as_ref().map_or_else(|| input.clone(), |l| l.join(" "));
        Some(html_page(&title, &svg))
    } else {
        None
    };
    if let Some(page) = page {
        std::fs::write(&output, page).unwrap_or_else(|e| {
            eprintln!("error: cannot write {output}: {e}");
            exit(1);
        });
    } else {
        let mut child = Command::new("rsvg-convert")
            .args(["--zoom", "2", "--format", "png", "-o", &output])
            .stdin(Stdio::piped())
            .spawn()
            .unwrap_or_else(|e| {
                eprintln!("error: cannot run rsvg-convert: {e}");
                exit(1);
            });
        child.stdin.take().unwrap().write_all(svg.as_bytes()).unwrap();
        if !child.wait().map(|s| s.success()).unwrap_or(false) {
            eprintln!("error: rsvg-convert failed");
            exit(1);
        }
    }
    for w in &warnings {
        eprintln!("warning: {w}");
    }
    let n = warnings.len();
    println!("{output}{}", if n > 0 { format!(" ({n} warning{})", if n > 1 { "s" } else { "" }) } else { String::new() });
}
