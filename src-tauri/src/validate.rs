//! Structural validation for the blocks added later (table, tabs,
//! button, synced block) plus equation length (2.6.x). The page JSON reaches Rust untyped, so — like
//! dates and attachment references — their attrs are re-checked here rather
//! than trusted: a malformed node would otherwise be persisted and then
//! crash or mislead the NodeView that renders it.

use crate::db::is_valid_iso_date;
use serde_json::Value;
use uuid::Uuid;

pub const MAX_TABLE_ROWS: usize = 200;
pub const MAX_TABLE_COLS: usize = 30;
pub const MAX_TABS: usize = 8;
pub const MAX_TAB_TITLE: usize = 60;
pub const MAX_BUTTON_LABEL: usize = 80;
/// Mirrors the limits in ImageView.tsx.
const MIN_IMAGE_WIDTH: f64 = 40.0;
const MAX_IMAGE_WIDTH: f64 = 4_000.0;
const MAX_IMAGE_TEXT: usize = 500;
/// Entries a standalone calendar / timeline / map block may hold.
pub const MAX_VIEW_ITEMS: usize = 500;
pub const MAX_ITEM_TITLE: usize = 200;
/// A standalone chart draws every entry it has, so it holds fewer than the other views.
pub const MAX_CHART_ENTRIES: usize = 100;
/// Canvas block: strokes are lists of x,y pairs on a sheet the block is a window onto.
pub const MAX_CANVAS_STROKES: usize = 2_000;
const MAX_STROKE_COORDS: usize = 10_000;
const MAX_CANVAS_COORDS: usize = 200_000;
/// The sheet is «infinite» for any real drawing, but bounded (mirrors `COORD_LIMIT` in canvas-strokes.ts).
const CANVAS_COORD_LIMIT: f64 = 100_000.0;
const CANVAS_COLORS: [&str; 5] = ["ink", "red", "blue", "green", "orange"];
/// Beyond this a number stops being exactly representable and the axis labels stop being readable.
const MAX_CHART_VALUE: f64 = 1e15;
/// Mirrors MAX_LATEX_LEN in EquationBlockView.tsx. KaTeX renders on every
/// mount, so an unbounded string from a pasted doc could freeze the editor.
pub const MAX_LATEX_LEN: usize = 10_000;
/// The only blocks a button may insert — a closed set the frontend maps to
/// hard-coded nodes. Never arbitrary JSON, never code.
pub const BUTTON_INSERT_BLOCKS: [&str; 4] = ["paragraph", "taskList", "callout", "horizontalRule"];

/// Hyphenated lowercase UUID — what `Uuid::new_v4().to_string()` and
/// `crypto.randomUUID()` both produce.
pub fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s == s.to_ascii_lowercase() && Uuid::parse_str(s).is_ok()
}

fn attr<'a>(node: &'a Value, key: &str) -> Option<&'a Value> {
    node.get("attrs")?.get(key).filter(|v| !v.is_null())
}

fn opt_str<'a>(node: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    match attr(node, key) {
        None => Ok(None),
        Some(v) => v.as_str().map(Some).ok_or_else(|| format!("{key} must be a string or null")),
    }
}

fn children(node: &Value) -> &[Value] {
    node.get("content").and_then(|c| c.as_array()).map(|v| v.as_slice()).unwrap_or(&[])
}

fn type_of(node: &Value) -> Option<&str> {
    node.get("type").and_then(Value::as_str)
}

fn check_table(node: &Value) -> Result<(), String> {
    let rows = children(node);
    if rows.is_empty() || rows.len() > MAX_TABLE_ROWS {
        return Err(format!("A table needs between 1 and {MAX_TABLE_ROWS} rows"));
    }
    for row in rows {
        if type_of(row) != Some("tableRow") {
            return Err("A table can only contain rows".to_string());
        }
        if children(row).len() > MAX_TABLE_COLS {
            return Err(format!("A table row can have at most {MAX_TABLE_COLS} cells"));
        }
    }
    Ok(())
}

fn check_cell(node: &Value) -> Result<(), String> {
    for key in ["colspan", "rowspan"] {
        if let Some(v) = attr(node, key) {
            match v.as_u64() {
                Some(n) if (1..=MAX_TABLE_COLS as u64).contains(&n) => {}
                _ => return Err(format!("{key} must be an integer between 1 and {MAX_TABLE_COLS}")),
            }
        }
    }
    if let Some(w) = attr(node, "colwidth") {
        let ok = w
            .as_array()
            .is_some_and(|a| a.len() <= MAX_TABLE_COLS && a.iter().all(|n| n.as_f64().is_some_and(|f| f >= 0.0)));
        if !ok {
            return Err("colwidth must be null or a list of widths".to_string());
        }
    }
    Ok(())
}

fn check_tabs(node: &Value) -> Result<(), String> {
    let tabs = children(node);
    if tabs.is_empty() || tabs.len() > MAX_TABS {
        return Err(format!("Tabs need between 1 and {MAX_TABS} tabs"));
    }
    if tabs.iter().any(|t| type_of(t) != Some("tab")) {
        return Err("Tabs can only contain tab nodes".to_string());
    }
    if let Some(v) = attr(node, "active") {
        match v.as_u64() {
            Some(n) if (n as usize) < tabs.len() => {}
            _ => return Err("Active tab index is out of range".to_string()),
        }
    }
    Ok(())
}

fn check_tab(node: &Value) -> Result<(), String> {
    if let Some(title) = opt_str(node, "title")? {
        if title.chars().count() > MAX_TAB_TITLE {
            return Err(format!("A tab title can have at most {MAX_TAB_TITLE} characters"));
        }
    }
    Ok(())
}

fn check_button(node: &Value) -> Result<(), String> {
    if let Some(label) = opt_str(node, "label")? {
        if label.chars().count() > MAX_BUTTON_LABEL {
            return Err(format!("A button label can have at most {MAX_BUTTON_LABEL} characters"));
        }
    }
    let page_id = opt_str(node, "pageId")?;
    if let Some(id) = page_id {
        if !is_uuid(id) {
            return Err(format!("Invalid button page reference: {id}"));
        }
    }
    let block = opt_str(node, "block")?;
    if let Some(b) = block {
        if !BUTTON_INSERT_BLOCKS.contains(&b) {
            return Err(format!("Button cannot insert block type: {b}"));
        }
    }
    match opt_str(node, "action")? {
        None => Ok(()),
        Some("openPage") if page_id.is_some() => Ok(()),
        Some("insertBlock") if block.is_some() => Ok(()),
        Some("openPage" | "insertBlock") => Err("Button action is missing its target".to_string()),
        Some(other) => Err(format!("Unknown button action: {other}")),
    }
}

/// Display attrs of an image block (`file` is checked with the other attachment references):
/// width in px (CSS still caps it at the column), alignment from a closed set, caption and alt text.
fn check_image(node: &Value) -> Result<(), String> {
    if let Some(w) = attr(node, "width") {
        if !w.as_f64().is_some_and(|w| (MIN_IMAGE_WIDTH..=MAX_IMAGE_WIDTH).contains(&w)) {
            return Err(format!("An image width must be a number from {MIN_IMAGE_WIDTH} to {MAX_IMAGE_WIDTH}"));
        }
    }
    match opt_str(node, "align")? {
        None | Some("left" | "center" | "right") => {}
        Some(other) => return Err(format!("Unknown image alignment: {other}")),
    }
    for key in ["caption", "alt"] {
        if opt_str(node, key)?.is_some_and(|s| s.chars().count() > MAX_IMAGE_TEXT) {
            return Err(format!("An image {key} can have at most {MAX_IMAGE_TEXT} characters"));
        }
    }
    Ok(())
}

/// A callout's icon: an emoji or an icon of the library (`lucide:Name:colour`), or none; never markup.
fn check_callout(node: &Value) -> Result<(), String> {
    match opt_str(node, "icon")? {
        Some(icon) if crate::databases::check_icon(Some(icon)).is_err() => Err("A callout's icon is not valid".to_string()),
        _ => Ok(()),
    }
}

fn check_equation(node: &Value) -> Result<(), String> {
    match opt_str(node, "latex")? {
        Some(s) if s.chars().count() > MAX_LATEX_LEN => Err(format!("An equation can have at most {MAX_LATEX_LEN} characters")),
        _ => Ok(()),
    }
}

/// A database page's document is only its title heading: the table is drawn by
/// the app below it, so nothing else (and in particular no block that could
/// hide or duplicate the table) may be saved there.
pub fn check_database_page_doc(doc: &Value) -> Result<(), String> {
    match children(doc) {
        [title] if type_of(title) == Some("heading") => Ok(()),
        _ => Err("A database page can only hold its title".to_string()),
    }
}

/// The entries of a standalone calendar / timeline block: `{ id, title, start, end? }`,
/// real calendar days, end not before start, unique ids, nothing else in the object.
fn check_events(node: &Value) -> Result<(), String> {
    check_items(node, "events", &["id", "title", "start", "end"], |item| {
        let start = item
            .get("start")
            .and_then(Value::as_str)
            .filter(|s| is_valid_iso_date(s))
            .ok_or("An event needs a valid start date")?;
        match item.get("end").filter(|v| !v.is_null()) {
            None => Ok(()),
            Some(end) => match end.as_str() {
                Some(e) if is_valid_iso_date(e) && e >= start => Ok(()),
                _ => Err("An event's end must be a valid date, not before its start".to_string()),
            },
        }
    })
}

/// The pins of a standalone map block: `{ id, title, lat, lng }`.
fn check_pins(node: &Value) -> Result<(), String> {
    check_items(node, "pins", &["id", "title", "lat", "lng"], |item| {
        let in_range = |key: &str, limit: f64| item.get(key).and_then(Value::as_f64).is_some_and(|n| n.is_finite() && n.abs() <= limit);
        if in_range("lat", 90.0) && in_range("lng", 180.0) {
            Ok(())
        } else {
            Err("A pin needs a latitude within ±90 and a longitude within ±180".to_string())
        }
    })
}

/// A standalone chart block: a type and its own entries `{ id, title, value }` (value a finite number, or null while empty).
fn check_chart(node: &Value) -> Result<(), String> {
    match attr(node, "chartType") {
        None | Some(Value::Null) => {}
        Some(Value::String(t)) if matches!(t.as_str(), "number" | "donut" | "bar" | "hbar" | "line") => {}
        Some(_) => return Err("Unknown chart type".to_string()),
    }
    check_items(node, "entries", &["id", "title", "value"], |item| match item.get("value") {
        None | Some(Value::Null) => Ok(()),
        Some(v) if v.as_f64().is_some_and(|n| n.is_finite() && n.abs() <= MAX_CHART_VALUE) => Ok(()),
        Some(_) => Err("A chart value must be a number".to_string()),
    })?;
    match attr(node, "entries") {
        Some(Value::Array(entries)) if entries.len() > MAX_CHART_ENTRIES => Err(format!("A chart holds at most {MAX_CHART_ENTRIES} entries")),
        _ => Ok(()),
    }
}

/// A canvas block: a height and its strokes `{ color, width, points }` — `points` a flat list of
/// x,y numbers. Only drawing data, nothing else.
fn check_canvas(node: &Value) -> Result<(), String> {
    match attr(node, "height") {
        None => {}
        Some(h) if h.as_f64().is_some_and(|h| (160.0..=2000.0).contains(&h)) => {}
        Some(_) => return Err("A canvas height must be a number between 160 and 2000".to_string()),
    }
    let strokes = match attr(node, "strokes") {
        None => return Ok(()),
        Some(Value::Array(s)) => s,
        Some(_) => return Err("strokes must be a list".to_string()),
    };
    if strokes.len() > MAX_CANVAS_STROKES {
        return Err(format!("A canvas holds at most {MAX_CANVAS_STROKES} strokes"));
    }
    let mut total = 0;
    for stroke in strokes {
        let obj = stroke.as_object().ok_or("Every stroke must be an object")?;
        if let Some(extra) = obj.keys().find(|k| !matches!(k.as_str(), "color" | "width" | "points")) {
            return Err(format!("Unknown field in a stroke: {extra}"));
        }
        if !obj.get("color").and_then(Value::as_str).is_some_and(|c| CANVAS_COLORS.contains(&c)) {
            return Err("A stroke needs one of the canvas colours".to_string());
        }
        if !obj.get("width").and_then(Value::as_f64).is_some_and(|w| (0.5..=40.0).contains(&w)) {
            return Err("A stroke width must be between 0.5 and 40".to_string());
        }
        let points = obj.get("points").and_then(Value::as_array).ok_or("A stroke needs its points")?;
        if points.len() < 2 || points.len() % 2 != 0 || points.len() > MAX_STROKE_COORDS {
            return Err(format!("A stroke has between 1 and {} points", MAX_STROKE_COORDS / 2));
        }
        if !points.iter().all(|n| n.as_f64().is_some_and(|n| n.is_finite() && n.abs() <= CANVAS_COORD_LIMIT)) {
            return Err("Stroke coordinates must be numbers within ±100000".to_string());
        }
        total += points.len();
        if total > MAX_CANVAS_COORDS {
            return Err("The canvas holds too many points".to_string());
        }
    }
    Ok(())
}

fn check_items(node: &Value, key: &str, allowed: &[&str], check_rest: impl Fn(&Value) -> Result<(), String>) -> Result<(), String> {
    let items = match attr(node, key) {
        None => return Ok(()),
        Some(Value::Array(items)) => items,
        Some(_) => return Err(format!("{key} must be a list")),
    };
    if items.len() > MAX_VIEW_ITEMS {
        return Err(format!("At most {MAX_VIEW_ITEMS} entries per block"));
    }
    let mut ids = std::collections::HashSet::new();
    for item in items {
        let obj = item.as_object().ok_or("Every entry must be an object")?;
        if let Some(extra) = obj.keys().find(|k| !allowed.contains(&k.as_str())) {
            return Err(format!("Unknown field in an entry: {extra}"));
        }
        let id = item.get("id").and_then(Value::as_str).filter(|id| is_uuid(id)).ok_or("Every entry needs a valid id")?;
        if !ids.insert(id) {
            return Err("Entry ids must be unique".to_string());
        }
        let title = item.get("title").and_then(Value::as_str).ok_or("Every entry needs a title (it may be empty)")?;
        if title.chars().count() > MAX_ITEM_TITLE {
            return Err(format!("An entry title can have at most {MAX_ITEM_TITLE} characters"));
        }
        check_rest(item)?;
    }
    Ok(())
}

fn check_synced(node: &Value) -> Result<(), String> {
    match opt_str(node, "syncId")? {
        Some(id) if is_uuid(id) => {}
        _ => return Err("A synced block needs a valid syncId".to_string()),
    }
    if !children(node).is_empty() {
        return Err("A synced block reference cannot hold content".to_string());
    }
    Ok(())
}

/// The root of anything saved as a document. `validate_blocks` checks each node it knows, but
/// nothing required the root to be a document at all: `save_page_content` stored `true`, `["a"]`
/// and `{"options": ["a"]}` as pages (the fuzz of the commands found it).
pub fn validate_doc(doc: &Value) -> Result<(), String> {
    if type_of(doc) != Some("doc") {
        return Err("A document must be a node of type \"doc\"".to_string());
    }
    if doc.get("content").is_some_and(|c| !c.is_array()) {
        return Err("A document's content must be a list".to_string());
    }
    Ok(())
}

/// Walks the doc depth-first. `in_synced` is true for the document stored in a
/// synced block: it may not contain another `syncedBlock`, which rules out
/// reference cycles by construction (A → B → A needs a synced block inside one).
pub fn validate_blocks(node: &Value, in_synced: bool) -> Result<(), String> {
    match type_of(node) {
        Some("table") => check_table(node)?,
        Some("tableCell" | "tableHeader") => check_cell(node)?,
        Some("tabs") => check_tabs(node)?,
        Some("tab") => check_tab(node)?,
        Some("buttonBlock") => check_button(node)?,
        Some("image") => check_image(node)?,
        Some("equationBlock" | "equationInline") => check_equation(node)?,
        Some("callout") => check_callout(node)?,
        Some("calendarView" | "timelineView") => check_events(node)?,
        Some("mapView") => check_pins(node)?,
        Some("chartView") => check_chart(node)?,
        Some("canvasBlock") => check_canvas(node)?,
        Some("database") => {
            // A view of a database: only in page docs (not synced blocks). A null id
            // is the "choose a database" picker state, like `pageLink.pageId`.
            if in_synced {
                return Err("A database view cannot live inside a synced block".to_string());
            }
            for key in ["databaseId", "viewId"] {
                if let Some(id) = opt_str(node, key)? {
                    if !is_uuid(id) {
                        return Err(format!("A database view needs a valid {key}"));
                    }
                }
            }
        }
        Some("syncedBlock") => {
            if in_synced {
                return Err("A synced block cannot contain another synced block".to_string());
            }
            check_synced(node)?;
        }
        _ => {}
    }
    for child in children(node) {
        validate_blocks(child, in_synced)?;
    }
    Ok(())
}

/// Collects every `<node_type>.<attr>` id in a doc (for the startup orphan sweeps).
pub fn collect_ids(node: &Value, node_type: &str, attr: &str, out: &mut std::collections::HashSet<String>) {
    if type_of(node) == Some(node_type) {
        if let Some(id) = node.get("attrs").and_then(|a| a.get(attr)).and_then(Value::as_str) {
            out.insert(id.to_string());
        }
    }
    for child in children(node) {
        collect_ids(child, node_type, attr, out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ID: &str = "3f0c2a9e-6b1d-4c1a-9d7e-2b8f5a1c4e60";

    #[test]
    fn a_callout_icon_is_plain() {
        let callout = |icon: Value| json!({ "type": "callout", "attrs": { "icon": icon }, "content": [{ "type": "paragraph" }] });
        for good in [json!("💡"), json!("⚠️"), json!("lucide:Rocket:blue"), Value::Null] {
            assert!(validate_blocks(&callout(good.clone()), false).is_ok(), "{good}");
        }
        for bad in [json!("<b>"), json!("a b"), json!(5), json!("x".repeat(65))] {
            assert!(validate_blocks(&callout(bad.clone()), false).is_err(), "{bad}");
        }
    }

    fn ok(v: Value) -> bool {
        validate_blocks(&v, false).is_ok()
    }

    #[test]
    fn table_limits() {
        let row = |n: usize| json!({ "type": "tableRow", "content": vec![json!({ "type": "tableCell" }); n] });
        assert!(ok(json!({ "type": "table", "content": [row(3)] })));
        assert!(!ok(json!({ "type": "table", "content": [] })));
        assert!(!ok(json!({ "type": "table", "content": [row(MAX_TABLE_COLS + 1)] })));
        assert!(!ok(json!({ "type": "table", "content": [{ "type": "paragraph" }] })));
        assert!(!ok(json!({ "type": "tableCell", "attrs": { "colspan": 0 } })));
        assert!(!ok(json!({ "type": "tableCell", "attrs": { "colspan": "2" } })));
        assert!(ok(json!({ "type": "tableCell", "attrs": { "colspan": 2, "rowspan": 1, "colwidth": null } })));
    }

    #[test]
    fn tabs_limits() {
        let tab = json!({ "type": "tab", "attrs": { "title": "A" } });
        assert!(ok(json!({ "type": "tabs", "attrs": { "active": 1 }, "content": [tab.clone(), tab.clone()] })));
        assert!(!ok(json!({ "type": "tabs", "attrs": { "active": 2 }, "content": [tab.clone(), tab.clone()] })));
        assert!(!ok(json!({ "type": "tabs", "content": [] })));
        assert!(!ok(json!({ "type": "tabs", "content": vec![tab; MAX_TABS + 1] })));
        assert!(!ok(json!({ "type": "tab", "attrs": { "title": "x".repeat(MAX_TAB_TITLE + 1) } })));
    }

    #[test]
    fn button_is_a_closed_set() {
        let b = |attrs: Value| json!({ "type": "buttonBlock", "attrs": attrs });
        assert!(ok(b(json!({ "label": "Go", "action": null, "pageId": null, "block": null }))));
        assert!(ok(b(json!({ "action": "openPage", "pageId": ID }))));
        assert!(ok(b(json!({ "action": "insertBlock", "block": "callout" }))));
        assert!(!ok(b(json!({ "action": "openPage", "pageId": null })))); // no target
        assert!(!ok(b(json!({ "action": "openPage", "pageId": "../../etc/passwd" }))));
        assert!(!ok(b(json!({ "action": "insertBlock", "block": "image" })))); // not in the set
        assert!(!ok(b(json!({ "action": "runScript", "block": "paragraph" }))));
        assert!(!ok(b(json!({ "label": "x".repeat(MAX_BUTTON_LABEL + 1) }))));
    }

    #[test]
    fn equation_latex_is_bounded() {
        let eq = |t: &str, latex: Value| json!({ "type": t, "attrs": { "latex": latex } });
        for t in ["equationBlock", "equationInline"] {
            assert!(ok(eq(t, json!("x^2 \\\\ y"))));
            assert!(ok(eq(t, Value::Null)));
            assert!(!ok(eq(t, json!(5))));
            assert!(!ok(eq(t, json!("x".repeat(MAX_LATEX_LEN + 1)))));
        }
    }

    #[test]
    fn database_view_id_and_database_page_doc() {
        let db = |id: Value| json!({ "type": "database", "attrs": { "databaseId": id } });
        assert!(ok(db(json!(ID))));
        assert!(ok(db(Value::Null))); // picking a source
        assert!(!ok(db(json!("nope"))));
        assert!(!ok(db(json!(5))));
        assert!(ok(json!({ "type": "database", "attrs": { "databaseId": ID, "viewId": ID } })));
        assert!(!ok(json!({ "type": "database", "attrs": { "databaseId": ID, "viewId": "nope" } })));
        assert!(validate_blocks(&json!({ "type": "doc", "content": [db(json!(ID))] }), true).is_err());

        let title = json!({ "type": "heading", "attrs": { "level": 1 } });
        assert!(check_database_page_doc(&json!({ "type": "doc", "content": [title.clone()] })).is_ok());
        assert!(check_database_page_doc(&json!({ "type": "doc", "content": [] })).is_err());
        assert!(check_database_page_doc(&json!({ "type": "doc", "content": [title.clone(), { "type": "paragraph" }] })).is_err());
        assert!(check_database_page_doc(&json!({ "type": "doc", "content": [db(json!(ID))] })).is_err());
    }

    #[test]
    fn synced_blocks_cannot_nest() {
        let sync = json!({ "type": "syncedBlock", "attrs": { "syncId": ID } });
        assert!(ok(sync.clone()));
        assert!(!ok(json!({ "type": "syncedBlock", "attrs": { "syncId": "nope" } })));
        assert!(!ok(json!({ "type": "syncedBlock", "attrs": { "syncId": null } })));
        // inside a synced block's own document, any syncedBlock is a cycle risk
        assert!(validate_blocks(&json!({ "type": "doc", "content": [sync] }), true).is_err());
        // ...even deep inside other containers
        let deep = json!({ "type": "doc", "content": [{ "type": "columnList", "content": [{ "type": "column", "content": [
            { "type": "syncedBlock", "attrs": { "syncId": ID } }] }] }] });
        assert!(validate_blocks(&deep, true).is_err());
        assert!(validate_blocks(&deep, false).is_ok());
    }
    #[test]
    fn standalone_chart_blocks_are_checked() {
        let id = |n: u8| format!("3f0c2a9e-6b1d-4c1a-9d7e-2b8f5a1c4e{n:02}");
        let chart = |attrs: Value| json!({ "type": "chartView", "attrs": attrs });
        assert!(ok(json!({ "type": "chartView" })));
        assert!(ok(chart(
            json!({ "chartType": "donut", "entries": [{ "id": id(1), "title": "A", "value": 3.5 }, { "id": id(2), "title": "", "value": null }] })
        )));
        for bad in [
            json!({ "chartType": "pie", "entries": [] }), // unknown type
            json!({ "chartType": 3 }),
            json!({ "entries": [{ "id": id(1), "title": "x", "value": "12" }] }), // a string is not a number
            json!({ "entries": [{ "id": id(1), "title": "x", "value": 1e16 }] }), // out of range
            json!({ "entries": [{ "id": id(1), "title": "x", "value": 1, "colour": "red" }] }), // unknown field
            json!({ "entries": [{ "id": id(1), "title": "x" }, { "id": id(1), "title": "y" }] }), // duplicate id
        ] {
            assert!(!ok(chart(bad.clone())), "{bad}");
        }
        let many: Vec<Value> = (0..=MAX_CHART_ENTRIES)
            .map(|n| json!({ "id": format!("3f0c2a9e-6b1d-4c1a-9d7e-{n:012}"), "title": "", "value": 1 }))
            .collect();
        assert!(!ok(chart(json!({ "entries": many }))));
    }

    #[test]
    fn image_display_attrs_are_validated() {
        let image = |attrs: Value| json!({ "type": "image", "attrs": attrs });
        assert!(ok(image(json!({ "file": null }))));
        assert!(ok(image(json!({ "width": null, "align": null, "caption": null, "alt": null }))));
        assert!(ok(image(json!({ "width": 320.5, "align": "right", "caption": "Pie", "alt": "Texto" }))));
        for bad in [
            json!({ "width": 10 }),
            json!({ "width": 99999 }),
            json!({ "width": "300" }),
            json!({ "align": "justify" }),
            json!({ "align": 1 }),
            json!({ "caption": "x".repeat(501) }),
            json!({ "alt": 5 }),
        ] {
            assert!(!ok(image(bad.clone())), "{bad}");
        }
    }

    #[test]
    fn canvas_blocks_hold_only_valid_drawing_data() {
        let stroke = |color: &str, width: f64, points: Value| json!({ "color": color, "width": width, "points": points });
        let canvas = |attrs: Value| json!({ "type": "canvasBlock", "attrs": attrs });
        assert!(ok(json!({ "type": "canvasBlock" }))); // just inserted
        assert!(ok(canvas(json!({ "strokes": [], "height": 360 }))));
        assert!(ok(canvas(
            json!({ "height": 360, "strokes": [stroke("ink", 2.5, json!([1, 2, 3.5, 4])), stroke("red", 10.0, json!([5, 5]))] })
        )));
        // the sheet has no page edges: negative and far-away coordinates are fine, up to the limit
        assert!(ok(canvas(json!({ "strokes": [stroke("ink", 2.5, json!([-4500, 12000.5, 99999, -100000]))] }))));
        for bad in [
            json!({ "height": 50 }), // below the minimum
            json!({ "height": 99999 }),
            json!({ "height": "360" }),
            json!({ "strokes": "x" }),
            json!({ "strokes": [stroke("pink", 2.0, json!([1, 2]))] }),   // unknown colour
            json!({ "strokes": [stroke("ink", 0.0, json!([1, 2]))] }),    // width out of range
            json!({ "strokes": [stroke("ink", 2.0, json!([1, 2, 3]))] }), // odd number of coordinates
            json!({ "strokes": [stroke("ink", 2.0, json!([]))] }),
            json!({ "strokes": [stroke("ink", 2.0, json!(["1", 2]))] }),    // a string is not a coordinate
            json!({ "strokes": [stroke("ink", 2.0, json!([100001, 2]))] }), // out of range
            json!({ "strokes": [{ "color": "ink", "width": 2, "points": [1, 2], "id": 1 }] }), // unknown field
        ] {
            assert!(!ok(canvas(bad.clone())), "{bad}");
        }
        let many: Vec<Value> = (0..=MAX_CANVAS_STROKES).map(|_| stroke("ink", 2.0, json!([1, 2]))).collect();
        assert!(!ok(canvas(json!({ "strokes": many }))));
        // a stroke too long, and a canvas whose strokes together are too big
        assert!(!ok(canvas(json!({ "strokes": [stroke("ink", 2.0, json!(vec![1; MAX_STROKE_COORDS + 2]))] }))));
        let long: Vec<Value> = (0..=MAX_CANVAS_COORDS / MAX_STROKE_COORDS)
            .map(|_| stroke("ink", 2.0, json!(vec![1; MAX_STROKE_COORDS])))
            .collect();
        assert!(!ok(canvas(json!({ "strokes": long }))));
    }

    #[test]
    fn standalone_calendar_timeline_and_map_blocks_are_checked() {
        let id = |n: u8| format!("3f0c2a9e-6b1d-4c1a-9d7e-2b8f5a1c4e{n:02}");
        let ev = |attrs: Value| json!({ "type": "calendarView", "attrs": { "events": [attrs] } });
        assert!(ok(json!({ "type": "calendarView", "attrs": { "events": [] } })));
        assert!(ok(json!({ "type": "calendarView" }))); // no attrs yet
        assert!(ok(ev(json!({ "id": id(1), "title": "", "start": "2026-10-15" }))));
        assert!(ok(ev(json!({ "id": id(1), "title": "Viaje", "start": "2026-10-15", "end": "2026-10-20" }))));
        assert!(ok(
            json!({ "type": "timelineView", "attrs": { "events": [{ "id": id(1), "title": "x", "start": "2026-10-15", "end": null }] } })
        ));
        for bad in [
            json!({ "id": id(1), "title": "x", "start": "2026-02-30" }),                      // not a real day
            json!({ "id": id(1), "title": "x", "start": "2026-10-15", "end": "2026-10-14" }), // end before start
            json!({ "id": id(1), "title": "x", "start": "2026-10-15", "end": "tomorrow" }),
            json!({ "id": "nope", "title": "x", "start": "2026-10-15" }), // not a uuid
            json!({ "id": id(1), "start": "2026-10-15" }),                // no title
            json!({ "id": id(1), "title": "x".repeat(MAX_ITEM_TITLE + 1), "start": "2026-10-15" }),
            json!({ "id": id(1), "title": "x", "start": "2026-10-15", "colour": "red" }), // unknown field
        ] {
            assert!(!ok(ev(bad.clone())), "{bad}");
        }
        let dup = json!({ "type": "calendarView", "attrs": { "events": [
            { "id": id(1), "title": "a", "start": "2026-10-15" }, { "id": id(1), "title": "b", "start": "2026-10-16" }] } });
        assert!(!ok(dup)); // ids are unique
        assert!(!ok(json!({ "type": "calendarView", "attrs": { "events": "x" } })));
        let many: Vec<Value> = (0..=MAX_VIEW_ITEMS)
            .map(|n| json!({ "id": format!("3f0c2a9e-6b1d-4c1a-9d7e-{n:012}"), "title": "", "start": "2026-10-15" }))
            .collect();
        assert!(!ok(json!({ "type": "calendarView", "attrs": { "events": many } })));

        let pin = |attrs: Value| json!({ "type": "mapView", "attrs": { "pins": [attrs] } });
        assert!(ok(json!({ "type": "mapView", "attrs": { "pins": [] } })));
        assert!(ok(pin(json!({ "id": id(1), "title": "Casa", "lat": 40.4, "lng": -3.7 }))));
        for bad in [
            json!({ "id": id(1), "title": "x", "lat": 91.0, "lng": 0.0 }),
            json!({ "id": id(1), "title": "x", "lat": 0.0, "lng": 181.0 }),
            json!({ "id": id(1), "title": "x", "lat": "40", "lng": "-3" }),
            json!({ "id": id(1), "title": "x", "lat": 40.0 }),
            json!({ "id": id(1), "title": "x", "lat": 40.0, "lng": 0.0, "url": "http://x" }),
        ] {
            assert!(!ok(pin(bad.clone())), "{bad}");
        }
        // these blocks hold no references to anything, so they are fine inside a synced block
        assert!(validate_blocks(&json!({ "type": "doc", "content": [{ "type": "mapView", "attrs": { "pins": [] } }] }), true).is_ok());
    }
}
