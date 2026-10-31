//! The trash. Deleting a page does not erase it: the page, everything that hangs from it (sub-pages, the rows of a
//! database) and the rows of other tables that belong to those pages are written into one JSON snapshot, and the
//! pages are deleted as always. Restoring puts the snapshot back; it is erased for good after `KEEP_DAYS` days or
//! when the user empties the trash. Nothing else in the app knows about it, so a trashed page cannot turn up in a
//! search, a list or the calendar: for the rest of the database it is gone. Its attachments are the one thing that
//! stays on disk while a snapshot names them (`attachments::is_referenced`).

use crate::{attachments, db, validate};
use rusqlite::types::{Value as Sql, ValueRef};
use rusqlite::{params_from_iter, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::path::Path;
use uuid::Uuid;

const KEEP_DAYS: i64 = 30;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub id: String,
    pub title: String,
    /// `"page"` or `"database"`, as the deleted page was.
    pub kind: String,
    pub icon: Option<String>,
    /// How many pages went in: the one deleted and what hung from it.
    pub page_count: i64,
    /// `YYYY-MM-DD HH:MM:SS`, UTC.
    pub deleted_at: String,
    /// When it is erased for good, same format.
    pub expires_at: String,
}

/// The page and everything under it (`?1` is the page). Children come after their parents (`depth`).
const TREE: &str = "WITH RECURSIVE tree(id, depth) AS (SELECT ?1, 0 UNION ALL SELECT p.id, t.depth + 1 FROM pages p JOIN tree t ON p.parent_id = t.id) ";

/// What a snapshot holds and, in this order, what is put back: a table and the query for its rows that belong to the tree.
const PARTS: [(&str, &str); 11] = [
    (
        "pages",
        "SELECT * FROM pages WHERE id IN (SELECT id FROM tree) ORDER BY (SELECT depth FROM tree WHERE tree.id = pages.id)",
    ),
    ("databases", "SELECT * FROM databases WHERE page_id IN (SELECT id FROM tree)"),
    (
        "properties",
        "SELECT * FROM properties WHERE database_id IN (SELECT id FROM databases WHERE page_id IN (SELECT id FROM tree))",
    ),
    (
        "views",
        "SELECT * FROM views WHERE database_id IN (SELECT id FROM databases WHERE page_id IN (SELECT id FROM tree))",
    ),
    ("blocks", "SELECT * FROM blocks WHERE page_id IN (SELECT id FROM tree)"),
    ("property_values", "SELECT * FROM property_values WHERE page_id IN (SELECT id FROM tree)"),
    (
        "property_relations",
        "SELECT * FROM property_relations WHERE page_id IN (SELECT id FROM tree) OR target_id IN (SELECT id FROM tree)",
    ),
    (
        "page_links",
        "SELECT * FROM page_links WHERE task_id IN (SELECT id FROM tree) OR page_id IN (SELECT id FROM tree)",
    ),
    ("calendar_entries", "SELECT * FROM calendar_entries WHERE task_id IN (SELECT id FROM tree)"),
    (
        "calendar_exceptions",
        "SELECT * FROM calendar_exceptions WHERE entry_id IN (SELECT id FROM calendar_entries WHERE task_id IN (SELECT id FROM tree))",
    ),
    ("board_cards", "SELECT * FROM board_cards WHERE task_id IN (SELECT id FROM tree)"),
];

/// The synced blocks the pages show are kept too, because the ones nothing else shows are deleted with them.
const SYNCED: &str = "synced_blocks";

fn sql(e: rusqlite::Error) -> String {
    e.to_string()
}

fn damaged() -> String {
    "La copia guardada en la papelera está dañada".to_string()
}

/// The rows a query returns, as JSON objects by column name.
fn dump(conn: &Connection, query: &str, param: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn.prepare(query).map_err(sql)?;
    let names: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
    let rows = stmt
        .query_map([param], |row| {
            let mut object = Map::new();
            for (i, name) in names.iter().enumerate() {
                let value = match row.get_ref(i)? {
                    ValueRef::Null | ValueRef::Blob(_) => Value::Null,
                    ValueRef::Integer(n) => json!(n),
                    ValueRef::Real(x) => json!(x),
                    ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
                };
                object.insert(name.clone(), value);
            }
            Ok(Value::Object(object))
        })
        .map_err(sql)?;
    rows.collect::<rusqlite::Result<_>>().map_err(sql)
}

/// Deletes a page into the trash; returns the id of the entry.
pub fn move_to_trash(conn: &Connection, page_id: &str) -> Result<String, String> {
    let (kind, icon): (String, Option<String>) = conn
        .query_row("SELECT kind, icon FROM pages WHERE id = ?1", [page_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(sql)?
        .ok_or_else(|| "La página no existe".to_string())?;
    let title = db::derive_page_title(conn, page_id).map_err(sql)?;

    let tx = conn.unchecked_transaction().map_err(sql)?;
    let mut tables = Map::new();
    for (name, query) in PARTS {
        tables.insert(name.to_string(), Value::Array(dump(&tx, &format!("{TREE}{query}"), page_id)?));
    }
    let mut synced = HashSet::new();
    for row in tables.get("blocks").and_then(Value::as_array).into_iter().flatten() {
        let doc = row.get("content").and_then(Value::as_str).and_then(|c| serde_json::from_str::<Value>(c).ok());
        if let Some(doc) = doc {
            validate::collect_ids(&doc, "syncedBlock", "syncId", &mut synced);
        }
    }
    let mut held = Vec::new();
    for id in &synced {
        held.extend(dump(&tx, "SELECT * FROM synced_blocks WHERE id = ?1", id)?);
    }
    tables.insert(SYNCED.to_string(), Value::Array(held));

    let page_count = tables.get("pages").and_then(Value::as_array).map_or(0, Vec::len) as i64;
    let id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO trash (id, title, kind, icon, page_count, snapshot) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, title, kind, icon, page_count, json!({ "tables": tables }).to_string()],
    )
    .map_err(sql)?;

    db::delete_page(&tx, page_id).map_err(sql)?;
    for sid in &synced {
        let shown: bool = tx
            .query_row("SELECT EXISTS(SELECT 1 FROM blocks WHERE type = 'doc' AND instr(content, ?1) > 0)", [sid], |r| r.get(0))
            .map_err(sql)?;
        if !shown {
            tx.execute("DELETE FROM synced_blocks WHERE id = ?1", [sid]).map_err(sql)?;
        }
    }
    strip_dead_links(&tx)?;
    tx.commit().map_err(sql)?;
    Ok(id)
}

pub fn list(conn: &Connection) -> Result<Vec<TrashItem>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, title, kind, icon, page_count, deleted_at, datetime(deleted_at, '+{KEEP_DAYS} days') FROM trash ORDER BY deleted_at DESC, rowid DESC"
        ))
        .map_err(sql)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(TrashItem {
                id: r.get(0)?,
                title: r.get(1)?,
                kind: r.get(2)?,
                icon: r.get(3)?,
                page_count: r.get(4)?,
                deleted_at: r.get(5)?,
                expires_at: r.get(6)?,
            })
        })
        .map_err(sql)?;
    rows.collect::<rusqlite::Result<_>>().map_err(sql)
}

/// Puts a trashed page back, with what hung from it; returns its id. It goes under its old parent if that is still
/// there, else at the top. Rows that point at something that was deleted since (a card of a board that is gone, a
/// cell of a column that is gone) are left out; a row page whose database is gone cannot come back.
pub fn restore(conn: &Connection, trash_id: &str) -> Result<String, String> {
    let snapshot: String = conn
        .query_row("SELECT snapshot FROM trash WHERE id = ?1", [trash_id], |r| r.get(0))
        .optional()
        .map_err(sql)?
        .ok_or_else(|| "Ya no está en la papelera".to_string())?;
    let mut snapshot: Value = serde_json::from_str(&snapshot).map_err(|_| damaged())?;
    let tables = snapshot.get_mut("tables").and_then(Value::as_object_mut).ok_or_else(damaged)?;
    let root_row = tables
        .get_mut("pages")
        .and_then(Value::as_array_mut)
        .and_then(|rows| rows.first_mut())
        .and_then(Value::as_object_mut)
        .ok_or_else(damaged)?;
    let root = root_row.get("id").and_then(Value::as_str).ok_or_else(damaged)?.to_string();
    if let Some(parent) = root_row.get("parent_id").and_then(Value::as_str).map(str::to_string) {
        let there: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM pages WHERE id = ?1)", [&parent], |r| r.get(0)).map_err(sql)?;
        if !there {
            root_row.insert("parent_id".to_string(), Value::Null);
        }
    }

    // Foreign keys are off while the rows go in (a row page and its database point at each other); what is left
    // dangling afterwards is found by `put_back_all` and removed.
    conn.pragma_update(None, "foreign_keys", false).map_err(sql)?;
    let done = put_back_all(conn, tables, trash_id);
    let back_on = conn.pragma_update(None, "foreign_keys", true).map_err(sql);
    done?;
    back_on?;
    Ok(root)
}

fn put_back_all(conn: &Connection, tables: &Map<String, Value>, trash_id: &str) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(sql)?;
    let mut inserted: HashSet<(String, i64)> = HashSet::new();
    for name in PARTS.iter().map(|p| p.0).chain([SYNCED]) {
        let Some(rows) = tables.get(name).and_then(Value::as_array) else { continue };
        // only columns the table really has are written, whatever the snapshot says
        let columns: Vec<String> = {
            let mut stmt = tx.prepare("SELECT name FROM pragma_table_info(?1)").map_err(sql)?;
            let names = stmt.query_map([name], |r| r.get(0)).map_err(sql)?;
            names.collect::<rusqlite::Result<_>>().map_err(sql)?
        };
        for row in rows.iter().filter_map(Value::as_object) {
            let keys: Vec<&str> = row.keys().map(String::as_str).filter(|k| columns.iter().any(|c| c == k)).collect();
            if keys.is_empty() {
                continue;
            }
            // a page that is already there is an error; any other row already there is left as it is
            let verb = if name == "pages" { "INSERT" } else { "INSERT OR IGNORE" };
            let query = format!("{verb} INTO {name} ({}) VALUES ({})", keys.join(", "), vec!["?"; keys.len()].join(", "));
            let values = keys.iter().map(|k| to_sql(row.get(*k)));
            if tx.execute(&query, params_from_iter(values)).map_err(sql)? == 1 {
                inserted.insert((name.to_string(), tx.last_insert_rowid()));
            }
        }
    }

    let dangling: Vec<(String, Option<i64>)> = {
        let mut stmt = tx.prepare("PRAGMA foreign_key_check").map_err(sql)?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(sql)?;
        rows.collect::<rusqlite::Result<_>>().map_err(sql)?
    };
    for (table, rowid) in dangling {
        // only rows this restore wrote: anything else is not its business
        let Some(rowid) = rowid.filter(|id| inserted.contains(&(table.clone(), *id))) else {
            continue;
        };
        if table == "pages" {
            return Err("No se puede restaurar: la base de datos a la que pertenecía ya no existe".to_string());
        }
        tx.execute(&format!("DELETE FROM \"{}\" WHERE rowid = ?1", table.replace('"', "\"\"")), [rowid])
            .map_err(sql)?;
    }

    tx.execute("DELETE FROM trash WHERE id = ?1", [trash_id]).map_err(sql)?;
    tx.commit().map_err(sql)
}

fn to_sql(value: Option<&Value>) -> Sql {
    match value {
        Some(Value::Number(n)) => n.as_i64().map(Sql::Integer).unwrap_or_else(|| Sql::Real(n.as_f64().unwrap_or(0.0))),
        Some(Value::String(s)) => Sql::Text(s.clone()),
        Some(Value::Bool(b)) => Sql::Integer(i64::from(*b)),
        _ => Sql::Null,
    }
}

fn ids(conn: &Connection, filter: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn.prepare(&format!("SELECT id FROM trash {filter}")).map_err(sql)?;
    let rows = stmt.query_map([], |r| r.get(0)).map_err(sql)?;
    rows.collect::<rusqlite::Result<_>>().map_err(sql)
}

/// Erases entries for good, and with them the attachments nothing else uses.
pub fn purge(conn: &Connection, dir: &Path, ids: &[String]) -> Result<(), String> {
    let mut texts = Vec::new();
    for id in ids {
        let snapshot: Option<String> = conn.query_row("SELECT snapshot FROM trash WHERE id = ?1", [id], |r| r.get(0)).optional().map_err(sql)?;
        texts.extend(snapshot);
        conn.execute("DELETE FROM trash WHERE id = ?1", [id]).map_err(sql)?;
    }
    attachments::remove_unreferenced(conn, dir, &texts)
}

pub fn empty(conn: &Connection, dir: &Path) -> Result<(), String> {
    purge(conn, dir, &ids(conn, "")?)
}

/// What has been in the trash longer than `KEEP_DAYS` goes. Runs at startup.
pub fn purge_expired(conn: &Connection, dir: &Path) -> Result<usize, String> {
    let old = ids(conn, &format!("WHERE deleted_at < datetime('now', '-{KEEP_DAYS} days')"))?;
    purge(conn, dir, &old)?;
    Ok(old.len())
}

fn is_dead_link(node: &Value, alive: &HashSet<String>) -> bool {
    matches!(node.get("type").and_then(Value::as_str), Some("pageLink" | "pageMention"))
        && node
            .get("attrs")
            .and_then(|a| a.get("pageId"))
            .and_then(Value::as_str)
            .is_some_and(|id| !alive.contains(id))
}

/// Removes the links and mentions of dead pages from a document; whether it changed anything. A block link that
/// was the only thing in its container (a column, a toggle) leaves an empty paragraph, which the container needs.
fn strip(node: &mut Value, alive: &HashSet<String>) -> bool {
    let Some(children) = node.get_mut("content").and_then(Value::as_array_mut) else {
        return false;
    };
    let block_gone = children.iter().any(|c| is_dead_link(c, alive) && c.get("type").and_then(Value::as_str) == Some("pageLink"));
    let before = children.len();
    children.retain(|c| !is_dead_link(c, alive));
    let mut changed = children.len() != before;
    if block_gone && children.is_empty() {
        children.push(json!({ "type": "paragraph" }));
    }
    for child in children.iter_mut() {
        changed |= strip(child, alive);
    }
    changed
}

/// A page's links and mentions point at pages; when one is deleted they would only read «Página eliminada». This
/// removes, from every document and synced block, those that point at a page that does not exist (the picker state,
/// `pageId: null`, is left alone). It runs when a page goes to the trash, and at startup for the ones older
/// versions left. Returns how many documents changed.
pub fn strip_dead_links(conn: &Connection) -> Result<usize, String> {
    let alive: HashSet<String> = {
        let mut stmt = conn.prepare("SELECT id FROM pages").map_err(sql)?;
        let rows = stmt.query_map([], |r| r.get(0)).map_err(sql)?;
        rows.collect::<rusqlite::Result<_>>().map_err(sql)?
    };
    let mut changed = 0;
    for (table, only) in [("blocks", "type = 'doc'"), ("synced_blocks", "1")] {
        let docs: Vec<(i64, String)> = {
            let mut stmt = conn
                .prepare(&format!("SELECT rowid, content FROM {table} WHERE {only} AND instr(content, '\"pageId\"') > 0"))
                .map_err(sql)?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(sql)?;
            rows.collect::<rusqlite::Result<_>>().map_err(sql)?
        };
        for (rowid, content) in docs {
            let Ok(mut doc) = serde_json::from_str::<Value>(&content) else { continue };
            if strip(&mut doc, &alive) {
                conn.execute(&format!("UPDATE {table} SET content = ?1 WHERE rowid = ?2"), (doc.to_string(), rowid))
                    .map_err(sql)?;
                changed += 1;
            }
        }
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        db::run_migrations(&conn).unwrap();
        conn
    }

    fn doc(blocks: Vec<Value>) -> Value {
        json!({ "type": "doc", "content": blocks })
    }

    fn title(text: &str) -> Value {
        json!({ "type": "heading", "attrs": { "level": 1 }, "content": [{ "type": "text", "text": text }] })
    }

    fn image(file: &str) -> Value {
        json!({ "type": "image", "attrs": { "file": file, "name": "x", "size": 1 } })
    }

    fn page_link(id: &str) -> Value {
        json!({ "type": "pageLink", "attrs": { "pageId": id } })
    }

    fn mention(id: &str) -> Value {
        json!({ "type": "paragraph", "content": [{ "type": "text", "text": "ver " }, { "type": "pageMention", "attrs": { "pageId": id } }] })
    }

    fn scratch() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("albaro-trash-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn exists(conn: &Connection, page_id: &str) -> bool {
        conn.query_row("SELECT EXISTS(SELECT 1 FROM pages WHERE id = ?1)", [page_id], |r| r.get(0)).unwrap()
    }

    fn count(conn: &Connection, query: &str) -> i64 {
        conn.query_row(query, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn a_page_comes_back_whole_with_its_subpages_and_synced_blocks() {
        let conn = conn();
        let page = db::create_page(&conn, None).unwrap();
        let child = db::create_page(&conn, Some(&page.id)).unwrap();
        let synced = Uuid::new_v4().to_string();
        db::save_synced_block(
            &conn,
            &synced,
            &doc(vec![json!({ "type": "paragraph", "content": [{ "type": "text", "text": "compartido" }] })]),
        )
        .unwrap();
        let content = doc(vec![
            title("Mi página"),
            json!({ "type": "paragraph", "content": [{ "type": "text", "text": "texto raro zzyzx" }] }),
            json!({ "type": "syncedBlock", "attrs": { "syncId": synced } }),
        ]);
        db::save_page_content(&conn, &page.id, &content).unwrap();
        db::save_page_content(&conn, &child.id, &doc(vec![title("Hija")])).unwrap();
        db::set_page_icon(&conn, &page.id, Some("🌱")).unwrap();

        let entry = move_to_trash(&conn, &page.id).unwrap();
        assert!(!exists(&conn, &page.id) && !exists(&conn, &child.id), "the page and its sub-page are gone");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM synced_blocks"), 0, "a synced block nothing else shows goes with it");
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM page_search WHERE page_search MATCH 'zzyzx'"),
            0,
            "it is not found while it is in the trash"
        );
        let items = list(&conn).unwrap();
        assert_eq!(
            (items.len(), items[0].title.as_str(), items[0].page_count, items[0].icon.as_deref()),
            (1, "Mi página", 2, Some("🌱"))
        );

        assert_eq!(restore(&conn, &entry).unwrap(), page.id);
        assert!(list(&conn).unwrap().is_empty());
        let pages = db::list_pages(&conn).unwrap();
        let back = pages.iter().find(|p| p.id == child.id).unwrap();
        assert_eq!(back.parent_id.as_deref(), Some(page.id.as_str()), "the sub-page is under its page again");
        assert_eq!(pages.iter().find(|p| p.id == page.id).unwrap().icon.as_deref(), Some("🌱"));
        assert_eq!(db::get_page_content(&conn, &page.id).unwrap().unwrap(), content);
        assert!(db::get_synced_block(&conn, &synced).unwrap().is_some(), "the synced block is back");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM page_search WHERE page_search MATCH 'zzyzx'"), 1, "and found again");
        assert!(restore(&conn, &entry).is_err(), "an entry can be restored once");
    }

    #[test]
    fn a_database_and_a_task_come_back_with_their_cells_links_and_schedule() {
        let conn = conn();
        let database = crate::databases::create_database_page(&conn).unwrap();
        let database_id = database.own_database_id.clone().unwrap();
        let prop = crate::databases::add_property(&conn, &database_id, "Nota", "text", &json!({})).unwrap();
        let row = crate::databases::create_row(&conn, &database_id).unwrap();
        crate::databases::set_value(&conn, &row.id, &prop.id, &json!("hola")).unwrap();

        let entry = move_to_trash(&conn, &database.id).unwrap();
        assert!(crate::databases::get_database(&conn, &database_id).unwrap().is_none());
        assert_eq!(list(&conn).unwrap()[0].page_count, 2, "the database and its row");
        restore(&conn, &entry).unwrap();
        let data = crate::databases::get_database(&conn, &database_id).unwrap().unwrap();
        assert_eq!((data.properties.len(), data.rows.len(), data.views.len()), (1, 1, 1));
        assert_eq!(data.rows[0].values.get(&prop.id), Some(&json!("hola")));

        // a task: linked to a page, scheduled, with a card on a board
        let task = crate::tasks::add_task(&conn, "Pagar").unwrap();
        let note = db::create_page(&conn, None).unwrap();
        crate::tasks::link_page(&conn, &task.id, &note.id).unwrap();
        conn.execute(
            "INSERT INTO calendar_entries (id, task_id, starts_at, ends_at) VALUES ('e1', ?1, '2026-10-21T10:00', '2026-10-21T11:00')",
            [&task.id],
        )
        .unwrap();
        let board = crate::boards::create_board(&conn, "Semana").unwrap();
        crate::boards::add_cards(&conn, &board.id, std::slice::from_ref(&task.id)).unwrap();

        let entry = move_to_trash(&conn, &task.id).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM calendar_entries"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM board_cards"), 0);
        assert!(crate::tasks::tasks_of_page(&conn, &note.id).unwrap().is_empty());
        restore(&conn, &entry).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM calendar_entries"), 1, "its schedule is back");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM board_cards"), 1, "and its card");
        assert_eq!(crate::tasks::tasks_of_page(&conn, &note.id).unwrap().len(), 1, "and its link to the note");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM pragma_foreign_key_check"), 0, "nothing is left pointing at nothing");
    }

    #[test]
    fn what_was_deleted_since_stays_out_when_a_page_comes_back() {
        let conn = conn();
        let task = crate::tasks::add_task(&conn, "Pagar").unwrap();
        let board = crate::boards::create_board(&conn, "Semana").unwrap();
        crate::boards::add_cards(&conn, &board.id, std::slice::from_ref(&task.id)).unwrap();
        let parent = db::create_page(&conn, None).unwrap();
        let child = db::create_page(&conn, Some(&parent.id)).unwrap();

        let task_entry = move_to_trash(&conn, &task.id).unwrap();
        conn.execute("DELETE FROM boards", []).unwrap(); // the board is gone while the task is in the trash
        restore(&conn, &task_entry).unwrap();
        assert!(exists(&conn, &task.id));
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM board_cards"),
            0,
            "a card of a board that no longer exists is not brought back"
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM pragma_foreign_key_check"), 0);

        let child_entry = move_to_trash(&conn, &child.id).unwrap();
        move_to_trash(&conn, &parent.id).unwrap();
        restore(&conn, &child_entry).unwrap();
        let back = db::list_pages(&conn).unwrap().into_iter().find(|p| p.id == child.id).unwrap();
        assert_eq!(back.parent_id, None, "with its parent in the trash it returns to the top");

        // a row whose database was erased cannot come back, and the refusal changes nothing
        let database = crate::databases::create_database_page(&conn).unwrap();
        let row = crate::databases::create_row(&conn, database.own_database_id.as_deref().unwrap()).unwrap();
        let row_entry = move_to_trash(&conn, &row.id).unwrap();
        move_to_trash(&conn, &database.id).unwrap();
        assert!(restore(&conn, &row_entry).is_err());
        assert!(!exists(&conn, &row.id));
        assert!(list(&conn).unwrap().iter().any(|t| t.id == row_entry), "and it stays in the trash");
        let enabled: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(enabled, 1, "foreign keys are on again after a refusal");
    }

    #[test]
    fn links_to_a_deleted_page_go_with_it_and_the_ones_left_by_old_versions_are_swept() {
        let conn = conn();
        let gone = db::create_page(&conn, None).unwrap();
        let other = db::create_page(&conn, None).unwrap();
        let kept = db::create_page(&conn, None).unwrap();
        let picker = json!({ "type": "pageLink", "attrs": { "pageId": null } });
        let column = |blocks: Vec<Value>| json!({ "type": "column", "content": blocks });
        let content = doc(vec![
            title("Otra"),
            page_link(&gone.id),
            mention(&gone.id),
            page_link(&kept.id),
            picker.clone(),
            json!({ "type": "columnList", "content": [column(vec![page_link(&gone.id)]), column(vec![mention(&gone.id), page_link(&kept.id)])] }),
        ]);
        db::save_page_content(&conn, &other.id, &content).unwrap();

        move_to_trash(&conn, &gone.id).unwrap();
        let after = db::get_page_content(&conn, &other.id).unwrap().unwrap();
        let text = after.to_string();
        assert!(!text.contains(&gone.id), "no link or mention of the deleted page is left: {text}");
        assert_eq!(text.matches(&kept.id).count(), 2, "links to pages that exist stay");
        assert!(text.contains("\"pageId\":null"), "the picker stays");
        let columns = &after["content"][4]["content"];
        assert_eq!(columns[0]["content"], json!([{ "type": "paragraph" }]), "a column left empty gets the paragraph it needs");
        assert_eq!(columns[1]["content"].as_array().unwrap().len(), 2, "the mention goes, the text before it and the link stay");
        assert_eq!(after["content"].as_array().unwrap().len(), 5, "the block links of the page are gone from the document");

        // a link an older version left behind: its page is simply not there
        let stale = doc(vec![title("Vieja"), page_link("00000000-0000-4000-8000-000000000000")]);
        db::save_page_content(&conn, &kept.id, &stale).unwrap();
        assert_eq!(strip_dead_links(&conn).unwrap(), 1);
        assert_eq!(db::get_page_content(&conn, &kept.id).unwrap().unwrap(), doc(vec![title("Vieja")]));
        assert_eq!(strip_dead_links(&conn).unwrap(), 0, "a second sweep finds nothing");
    }

    #[test]
    fn erasing_an_entry_removes_what_only_it_used_and_old_entries_expire() {
        let conn = conn();
        let dir = scratch();
        let make = |tag: &str| -> String {
            let name = format!("{}.png", Uuid::new_v4());
            fs::write(dir.join(&name), tag).unwrap();
            name
        };
        let (own, shared, in_child, in_cover, loose) = (make("a"), make("s"), make("c"), make("v"), make("l")); // `loose` is in no page
        let doomed = db::create_page(&conn, None).unwrap();
        let child = db::create_page(&conn, Some(&doomed.id)).unwrap();
        let other = db::create_page(&conn, None).unwrap();
        db::save_page_content(&conn, &doomed.id, &doc(vec![title("Borrada"), image(&own), image(&shared)])).unwrap();
        db::save_page_content(&conn, &child.id, &doc(vec![title("Hija"), image(&in_child)])).unwrap();
        db::set_page_cover(&conn, &doomed.id, Some(&format!("image:{in_cover}"))).unwrap();
        db::save_page_content(&conn, &other.id, &doc(vec![title("Otra"), image(&shared)])).unwrap();

        let entry = move_to_trash(&conn, &doomed.id).unwrap();
        for file in [&own, &shared, &in_child, &in_cover] {
            assert!(dir.join(file).exists(), "the files wait in the trash with the page");
        }
        assert_eq!(attachments::sweep_orphans(&conn, &dir).unwrap(), 1, "the start-up sweep takes only the file nothing names");
        assert!(dir.join(&own).exists() && !dir.join(&loose).exists());

        purge(&conn, &dir, std::slice::from_ref(&entry)).unwrap();
        assert!(list(&conn).unwrap().is_empty());
        assert!(
            !dir.join(&own).exists() && !dir.join(&in_child).exists() && !dir.join(&in_cover).exists(),
            "what only the page used is erased with it"
        );
        assert!(dir.join(&shared).exists(), "a file another page still shows stays");

        // old entries expire at startup, recent ones do not
        let old = db::create_page(&conn, None).unwrap();
        let recent = db::create_page(&conn, None).unwrap();
        let old_entry = move_to_trash(&conn, &old.id).unwrap();
        move_to_trash(&conn, &recent.id).unwrap();
        conn.execute("UPDATE trash SET deleted_at = datetime('now', '-31 days') WHERE id = ?1", [&old_entry])
            .unwrap();
        assert_eq!(purge_expired(&conn, &dir).unwrap(), 1);
        assert_eq!(list(&conn).unwrap().len(), 1);
        empty(&conn, &dir).unwrap();
        assert!(list(&conn).unwrap().is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }
}
