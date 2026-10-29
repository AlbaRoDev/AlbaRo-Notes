//! The checklist of a task: the `taskItem` nodes of its document (the «[ ]» list of the editor), shown and
//! changed from a board card or a calendar entry without opening the task. An item is addressed by its position in
//! the document (depth-first), and every change goes through `db::save_page_content`, so the usual validation, the
//! search index and the size limit apply. Rust checks that the page is a task; the page only draws what comes back.

use crate::{db, tasks};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};

const MAX_ITEMS: usize = 200;
const MAX_TEXT: usize = 200;

#[derive(Serialize, Debug, PartialEq, Clone)]
pub struct Item {
    pub text: String,
    pub checked: bool,
}

/// How far a checklist is (shown as «2/5» on a card).
#[derive(Serialize, Debug, PartialEq, Clone, Copy, Default)]
pub struct Progress {
    pub done: usize,
    pub total: usize,
}

/// The text of an item: its own paragraph(s), not the nested list under it.
fn text_of(node: &Value, out: &mut String) {
    if let Some(text) = node.get("text").and_then(Value::as_str) {
        out.push_str(text);
    }
    for child in node.get("content").and_then(Value::as_array).into_iter().flatten() {
        if child.get("type").and_then(Value::as_str) != Some("taskList") {
            text_of(child, out);
        }
    }
}

fn collect(node: &Value, out: &mut Vec<Item>) {
    for child in node.get("content").and_then(Value::as_array).into_iter().flatten() {
        if child.get("type").and_then(Value::as_str) == Some("taskItem") {
            let mut text = String::new();
            text_of(child, &mut text);
            let checked = child.pointer("/attrs/checked").and_then(Value::as_bool).unwrap_or(false);
            out.push(Item { text, checked });
        }
        collect(child, out);
    }
}

enum Op {
    Check(bool),
    Remove,
}

/// Applies `op` to the `target`-th item (same order as `collect`); a list left empty is dropped with it.
fn apply(node: &mut Value, target: usize, seen: &mut usize, op: &Op) -> bool {
    let Some(children) = node.get_mut("content").and_then(Value::as_array_mut) else {
        return false;
    };
    for i in 0..children.len() {
        if children[i].get("type").and_then(Value::as_str) == Some("taskItem") {
            if *seen == target {
                match op {
                    Op::Check(checked) => children[i]["attrs"]["checked"] = json!(checked),
                    Op::Remove => {
                        children.remove(i);
                    }
                }
                return true;
            }
            *seen += 1;
        }
        if apply(&mut children[i], target, seen, op) {
            let emptied = children[i].get("type").and_then(Value::as_str) == Some("taskList") && children[i].get("content").and_then(Value::as_array).is_some_and(Vec::is_empty);
            if emptied {
                children.remove(i);
            }
            return true;
        }
    }
    false
}

fn doc_of(conn: &Connection, task_id: &str) -> Result<Value, String> {
    if !tasks::is_task(conn, task_id)? {
        return Err("Solo una tarea tiene lista de comprobación".to_string());
    }
    Ok(db::get_page_content(conn, task_id)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| json!({ "type": "doc", "content": [] })))
}

fn items_of(doc: &Value) -> Vec<Item> {
    let mut out = Vec::new();
    collect(doc, &mut out);
    out
}

pub fn progress(conn: &Connection, task_id: &str) -> Progress {
    let items = db::get_page_content(conn, task_id).ok().flatten().map(|d| items_of(&d)).unwrap_or_default();
    Progress {
        done: items.iter().filter(|i| i.checked).count(),
        total: items.len(),
    }
}

pub fn get(conn: &Connection, task_id: &str) -> Result<Vec<Item>, String> {
    Ok(items_of(&doc_of(conn, task_id)?))
}

fn change(conn: &Connection, task_id: &str, index: usize, op: Op) -> Result<Vec<Item>, String> {
    let mut doc = doc_of(conn, task_id)?;
    if !apply(&mut doc, index, &mut 0, &op) {
        return Err("Ese elemento de la lista ya no existe".to_string());
    }
    db::save_page_content(conn, task_id, &doc)?;
    Ok(items_of(&doc))
}

pub fn set_checked(conn: &Connection, task_id: &str, index: usize, checked: bool) -> Result<Vec<Item>, String> {
    change(conn, task_id, index, Op::Check(checked))
}

pub fn remove(conn: &Connection, task_id: &str, index: usize) -> Result<Vec<Item>, String> {
    change(conn, task_id, index, Op::Remove)
}

/// A new unchecked item at the end of the document's last checklist (a new list if it has none).
pub fn add(conn: &Connection, task_id: &str, text: &str) -> Result<Vec<Item>, String> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > MAX_TEXT {
        return Err(format!("El elemento necesita entre 1 y {MAX_TEXT} caracteres"));
    }
    let mut doc = doc_of(conn, task_id)?;
    if items_of(&doc).len() >= MAX_ITEMS {
        return Err(format!("Una lista admite como mucho {MAX_ITEMS} elementos"));
    }
    let item = json!({
        "type": "taskItem",
        "attrs": { "checked": false },
        "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": text }] }]
    });
    if !doc["content"].is_array() {
        doc["content"] = json!([]);
    }
    let blocks = doc["content"].as_array_mut().expect("just ensured this is an array");
    match blocks.iter_mut().rev().find(|b| b.get("type").and_then(Value::as_str) == Some("taskList")) {
        Some(list) => list["content"].as_array_mut().ok_or("La lista está mal formada")?.push(item),
        None => blocks.push(json!({ "type": "taskList", "content": [item] })),
    }
    db::save_page_content(conn, task_id, &doc)?;
    Ok(items_of(&doc))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(text: &str, checked: bool, nested: Option<Value>) -> Value {
        let mut content = vec![json!({ "type": "paragraph", "content": [{ "type": "text", "text": text }] })];
        content.extend(nested);
        json!({ "type": "taskItem", "attrs": { "checked": checked }, "content": content })
    }

    fn task_with(conn: &Connection, blocks: Vec<Value>) -> String {
        let task = tasks::add_task(conn, "Preparar viaje").unwrap();
        let mut doc = db::get_page_content(conn, &task.id).unwrap().unwrap();
        doc["content"].as_array_mut().unwrap().extend(blocks);
        db::save_page_content(conn, &task.id, &doc).unwrap();
        task.id
    }

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        db::run_migrations(&conn).unwrap();
        conn
    }

    fn texts(items: &[Item]) -> Vec<(&str, bool)> {
        items.iter().map(|i| (i.text.as_str(), i.checked)).collect()
    }

    #[test]
    fn items_are_read_checked_removed_and_added_in_document_order() {
        let conn = conn();
        // a nested item counts after its parent, whose own text excludes the nested list
        let nested = json!({ "type": "taskList", "content": [item("hijo", false, None)] });
        let id = task_with(
            &conn,
            vec![json!({ "type": "taskList", "content": [item("pasaporte", false, Some(nested)), item("billetes", true, None)] })],
        );
        assert_eq!(texts(&get(&conn, &id).unwrap()), [("pasaporte", false), ("hijo", false), ("billetes", true)]);
        assert_eq!(progress(&conn, &id), Progress { done: 1, total: 3 });

        assert_eq!(
            texts(&set_checked(&conn, &id, 1, true).unwrap()),
            [("pasaporte", false), ("hijo", true), ("billetes", true)]
        );
        assert_eq!(texts(&set_checked(&conn, &id, 2, false).unwrap())[2], ("billetes", false));
        // what came back is what was stored
        assert_eq!(progress(&conn, &id), Progress { done: 1, total: 3 });

        assert_eq!(texts(&remove(&conn, &id, 0).unwrap()), [("billetes", false)], "its nested item went with it");
        assert_eq!(texts(&add(&conn, &id, "  maleta ").unwrap()), [("billetes", false), ("maleta", false)]);
        remove(&conn, &id, 1).unwrap();
        remove(&conn, &id, 0).unwrap();
        assert!(get(&conn, &id).unwrap().is_empty(), "the empty list was dropped");
        assert_eq!(texts(&add(&conn, &id, "otra").unwrap()), [("otra", false)], "a new list when there is none");
    }

    #[test]
    fn only_tasks_and_real_items_are_accepted() {
        let conn = conn();
        let id = task_with(&conn, vec![]);
        assert!(set_checked(&conn, &id, 0, true).is_err(), "no such item");
        assert!(remove(&conn, &id, 99).is_err());
        assert!(add(&conn, &id, "   ").is_err());
        assert!(add(&conn, &id, &"x".repeat(MAX_TEXT + 1)).is_err());
        assert!(get(&conn, "no-such-page").is_err());
        // a page that is not a task has no checklist to change
        let page = db::create_page(&conn, None).unwrap();
        assert!(add(&conn, &page.id, "x").is_err());
    }
}
