//! the Gestor's task database. It is an ordinary database page (its rows are the tasks, ordinary
//! pages with properties and a free body) marked with `databases.role = 'tasks'`: there is only one, the
//! Gestor creates it the first time it opens, and it can't be deleted (the Gestor depends on it).

use crate::databases;
use crate::db;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use serde_json::json;

pub const ROLE: &str = "tasks";
const TITLE: &str = "Tareas";

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskBase {
    /// The database's own page (it shows in the sidebar like any database).
    pub page_id: String,
    pub database_id: String,
}

fn sql<E: ToString>(e: E) -> String {
    e.to_string()
}

pub(crate) fn existing(conn: &Connection) -> Result<Option<TaskBase>, String> {
    conn.query_row("SELECT page_id, id FROM databases WHERE role = ?1", [ROLE], |r| {
        Ok(TaskBase {
            page_id: r.get(0)?,
            database_id: r.get(1)?,
        })
    })
    .optional()
    .map_err(sql)
}

/// The task database, created on first use with the properties every task starts with: *Estado*, *Fecha
/// límite* and *Categorías* (tags, as many as the user wants to add). All or nothing, and idempotent: a
/// second call (React's StrictMode runs effects twice) finds the first one's work.
pub fn ensure_task_base(conn: &Connection) -> Result<TaskBase, String> {
    if let Some(base) = existing(conn)? {
        return Ok(base);
    }
    let tx = conn.unchecked_transaction().map_err(sql)?;
    let page = databases::insert_database_page(&tx, Some(ROLE))?;
    let database_id = page.own_database_id.clone().ok_or("La base de datos no se creó")?;
    // the database's name is its page's title
    tx.execute(
        "UPDATE blocks SET content = ?1 WHERE page_id = ?2 AND type = 'doc' AND parent_id IS NULL",
        [db::database_page_doc(TITLE).to_string(), page.id.clone()],
    )
    .map_err(sql)?;

    let state = databases::add_property(&tx, &database_id, "Estado", "select", &json!({ "options": ["Por hacer", "En curso", "Hecha"] }))?;
    for (option, color) in [("Por hacer", "gray"), ("En curso", "yellow"), ("Hecha", "green")] {
        databases::set_option_color(&tx, &state.id, option, color)?;
    }
    databases::add_property(&tx, &database_id, "Fecha límite", "date", &json!({}))?;
    databases::add_property(&tx, &database_id, "Categorías", "tags", &json!({ "options": [] }))?;
    tx.commit().map_err(sql)?;
    Ok(TaskBase { page_id: page.id, database_id })
}

/// A new task from the quick-add box: a row of the task database with that title, in one step.
pub fn add_task(conn: &Connection, title: &str) -> Result<db::PageSummary, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("La tarea necesita un título".to_string());
    }
    let base = ensure_task_base(conn)?;
    let tx = conn.unchecked_transaction().map_err(sql)?;
    let row = databases::create_row(&tx, &base.database_id)?;
    db::set_row_title(&tx, &row.id, title)?;
    tx.commit().map_err(sql)?;
    Ok(db::PageSummary { title: title.to_string(), ..row })
}

/// Most pages one task can be linked to (a task with more is a task with no focus).
const MAX_LINKS_PER_TASK: i64 = 50;

/// A page or task as the link lists show it.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageRef {
    pub id: String,
    pub title: String,
}

pub(crate) fn is_task(conn: &Connection, id: &str) -> Result<bool, String> {
    conn.prepare("SELECT 1 FROM pages p JOIN databases d ON d.id = p.database_id WHERE p.id = ?1 AND d.role = ?2")
        .and_then(|mut s| s.exists([id, ROLE]))
        .map_err(sql)
}

/// An ordinary page: not a database page, not a row of any database.
fn is_plain_page(conn: &Connection, id: &str) -> Result<bool, String> {
    conn.prepare("SELECT 1 FROM pages WHERE id = ?1 AND kind = 'page' AND database_id IS NULL")
        .and_then(|mut s| s.exists([id]))
        .map_err(sql)
}

/// Links a task to an ordinary page (idempotent). Both ends are checked here, whoever asks.
pub fn link_page(conn: &Connection, task_id: &str, page_id: &str) -> Result<(), String> {
    if !is_task(conn, task_id)? {
        return Err("Solo se pueden enlazar páginas a una tarea".to_string());
    }
    if !is_plain_page(conn, page_id)? {
        return Err("Solo se pueden enlazar páginas normales (no bases de datos ni filas)".to_string());
    }
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM page_links WHERE task_id = ?1", [task_id], |r| r.get(0)).map_err(sql)?;
    let already = conn
        .prepare("SELECT 1 FROM page_links WHERE task_id = ?1 AND page_id = ?2")
        .and_then(|mut s| s.exists([task_id, page_id]))
        .map_err(sql)?;
    if !already && count >= MAX_LINKS_PER_TASK {
        return Err(format!("Una tarea admite como mucho {MAX_LINKS_PER_TASK} páginas enlazadas"));
    }
    conn.execute("INSERT OR IGNORE INTO page_links (task_id, page_id) VALUES (?1, ?2)", [task_id, page_id])
        .map_err(sql)?;
    Ok(())
}

pub fn unlink_page(conn: &Connection, task_id: &str, page_id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM page_links WHERE task_id = ?1 AND page_id = ?2", [task_id, page_id])
        .map_err(sql)?;
    Ok(())
}

fn refs(conn: &Connection, query: &str, id: &str) -> Result<Vec<PageRef>, String> {
    let ids: Vec<String> = {
        let mut stmt = conn.prepare(query).map_err(sql)?;
        let rows = stmt.query_map([id], |r| r.get(0)).map_err(sql)?;
        rows.collect::<rusqlite::Result<_>>().map_err(sql)?
    };
    ids.into_iter()
        .map(|id| {
            Ok(PageRef {
                title: db::derive_page_title(conn, &id).map_err(sql)?,
                id,
            })
        })
        .collect()
}

/// The pages linked to a task, oldest link first.
pub fn pages_of_task(conn: &Connection, task_id: &str) -> Result<Vec<PageRef>, String> {
    refs(conn, "SELECT page_id FROM page_links WHERE task_id = ?1 ORDER BY created_at, rowid", task_id)
}

/// The tasks a page is linked from (its backlinks).
pub fn tasks_of_page(conn: &Connection, page_id: &str) -> Result<Vec<PageRef>, String> {
    refs(conn, "SELECT task_id FROM page_links WHERE page_id = ?1 ORDER BY created_at, rowid", page_id)
}

/// The task database page is not deletable; its tasks (rows) are.
pub fn check_deletable(conn: &Connection, page_id: &str) -> Result<(), String> {
    let is_task_base = conn
        .query_row("SELECT 1 FROM databases WHERE page_id = ?1 AND role = ?2", [page_id, ROLE], |_| Ok(()))
        .optional()
        .map_err(sql)?
        .is_some();
    if is_task_base {
        Err("La base de tareas no se puede borrar: el Gestor la necesita (sí puedes borrar sus tareas)".to_string())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        db::run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn the_task_base_is_created_once_with_its_starting_properties() {
        let conn = conn();
        let first = ensure_task_base(&conn).unwrap();
        assert_eq!(ensure_task_base(&conn).unwrap(), first, "a second call finds the first");
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM databases WHERE role = 'tasks'", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);

        let data = databases::get_database(&conn, &first.database_id).unwrap().unwrap();
        assert_eq!(data.name, "Tareas");
        let columns: Vec<(&str, &str)> = data.properties.iter().map(|p| (p.name.as_str(), p.kind.as_str())).collect();
        assert_eq!(columns, [("Estado", "select"), ("Fecha límite", "date"), ("Categorías", "tags")]);
        assert_eq!(data.properties[0].config["options"], json!(["Por hacer", "En curso", "Hecha"]));
        assert_eq!(data.properties[0].config["colors"]["Hecha"], "green");
        assert_eq!(data.views.len(), 1);

        // it is a root database page listed with its role
        let page = db::list_pages(&conn).unwrap().into_iter().find(|p| p.id == first.page_id).unwrap();
        assert_eq!((page.kind.as_str(), page.parent_id, page.role.as_deref()), ("database", None, Some("tasks")));
    }

    #[test]
    fn only_one_database_can_have_a_role() {
        let conn = conn();
        databases::insert_database_page(&conn, Some(ROLE)).unwrap();
        assert!(databases::insert_database_page(&conn, Some(ROLE)).is_err());
        // plain databases are unlimited
        databases::insert_database_page(&conn, None).unwrap();
        databases::insert_database_page(&conn, None).unwrap();
    }

    #[test]
    fn quick_add_makes_a_titled_task_in_one_step() {
        let conn = conn();
        let task = add_task(&conn, "  Escribir ideas ").unwrap();
        assert_eq!(task.title, "Escribir ideas");
        let base = ensure_task_base(&conn).unwrap();
        let data = databases::get_database(&conn, &base.database_id).unwrap().unwrap();
        assert_eq!(data.rows.len(), 1);
        assert_eq!((data.rows[0].page_id.as_str(), data.rows[0].title.as_str()), (task.id.as_str(), "Escribir ideas"));
        // nothing half made on a bad title
        assert!(add_task(&conn, "   ").is_err());
        assert!(add_task(&conn, &"x".repeat(201)).is_err());
        assert_eq!(databases::get_database(&conn, &base.database_id).unwrap().unwrap().rows.len(), 1);
    }

    #[test]
    fn migration_13_adds_roles_and_refills_the_search_index() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        db::run_migrations_up_to(&conn, 12).unwrap();
        // a database from before roles existed, with a row whose cell is searchable
        let page = db::insert_page(&conn, None, None, "database").unwrap();
        let database_id = uuid::Uuid::new_v4().to_string();
        conn.execute("INSERT INTO databases (id, page_id) VALUES (?1, ?2)", [&database_id, &page.id]).unwrap();
        crate::views::create_default_view(&conn, &database_id).unwrap();
        let note = databases::add_property(&conn, &database_id, "Nota", "text", &json!({})).unwrap().id;
        let row = databases::create_row(&conn, &database_id).unwrap().id;
        databases::set_value(&conn, &row, &note, &json!("llamar al fontanero")).unwrap();
        let found = |q: &str| crate::search::search_pages(&conn, q).unwrap().into_iter().map(|r| r.id).collect::<Vec<_>>();
        assert_eq!(found("fontanero"), [row.as_str()]);

        db::run_migrations(&conn).unwrap();
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, 23);
        assert_eq!(found("fontanero"), [row.as_str()], "the index was rebuilt, not lost");
        let role: Option<String> = conn.query_row("SELECT role FROM databases WHERE id = ?1", [&database_id], |r| r.get(0)).unwrap();
        assert_eq!(role, None);
        // the old database is untouched and the task base gets made next to it
        let base = ensure_task_base(&conn).unwrap();
        assert_ne!(base.database_id, database_id);
        let tags = databases::get_database(&conn, &base.database_id).unwrap().unwrap().properties[2].id.clone();
        let task = add_task(&conn, "Escribir ideas").unwrap();
        databases::set_value(&conn, &task.id, &tags, &json!([])).unwrap();
    }

    #[test]
    fn tasks_link_to_ordinary_pages_and_both_ends_are_checked() {
        let conn = conn();
        let task = add_task(&conn, "Escribir ideas").unwrap();
        let other = add_task(&conn, "Otra").unwrap();
        let idea = db::create_page(&conn, None).unwrap();
        let note = db::create_page(&conn, None).unwrap();
        let base = ensure_task_base(&conn).unwrap();
        let loose_db = databases::create_database_page(&conn).unwrap();
        let loose_row = databases::create_row(&conn, loose_db.own_database_id.as_deref().unwrap()).unwrap();

        link_page(&conn, &task.id, &idea.id).unwrap();
        link_page(&conn, &task.id, &idea.id).unwrap(); // idempotent
        link_page(&conn, &task.id, &note.id).unwrap();
        link_page(&conn, &other.id, &idea.id).unwrap();
        assert_eq!(pages_of_task(&conn, &task.id).unwrap().len(), 2);
        let back: Vec<String> = tasks_of_page(&conn, &idea.id).unwrap().into_iter().map(|r| r.id).collect();
        assert_eq!(back, [task.id.clone(), other.id.clone()]);

        // only task ← ordinary page: not a page as task, not a database page, not a row, not a missing id
        assert!(link_page(&conn, &idea.id, &note.id).is_err());
        assert!(link_page(&conn, &task.id, &base.page_id).is_err());
        assert!(link_page(&conn, &task.id, &other.id).is_err(), "a task is a row, not an ordinary page");
        assert!(link_page(&conn, &task.id, &loose_row.id).is_err());
        assert!(link_page(&conn, &task.id, &loose_db.id).is_err());
        assert!(link_page(&conn, &task.id, "no-existe").is_err());
        assert!(link_page(&conn, &loose_row.id, &idea.id).is_err(), "a row of another database is not a task");

        unlink_page(&conn, &task.id, &note.id).unwrap();
        assert_eq!(pages_of_task(&conn, &task.id).unwrap().len(), 1);
        // either end going away takes the link with it
        db::delete_page(&conn, &idea.id).unwrap();
        assert!(pages_of_task(&conn, &task.id).unwrap().is_empty());
        link_page(&conn, &task.id, &note.id).unwrap();
        db::delete_page(&conn, &task.id).unwrap();
        assert!(tasks_of_page(&conn, &note.id).unwrap().is_empty());
    }

    #[test]
    fn a_task_takes_a_limited_number_of_pages() {
        let conn = conn();
        let task = add_task(&conn, "Mucho").unwrap();
        for _ in 0..MAX_LINKS_PER_TASK {
            let page = db::create_page(&conn, None).unwrap();
            link_page(&conn, &task.id, &page.id).unwrap();
        }
        let one_more = db::create_page(&conn, None).unwrap();
        assert!(link_page(&conn, &task.id, &one_more.id).is_err());
        let first = pages_of_task(&conn, &task.id).unwrap().remove(0);
        link_page(&conn, &task.id, &first.id).unwrap(); // re-linking one already there is not «one more»
    }

    #[test]
    fn the_base_cannot_be_deleted_but_its_tasks_can() {
        let conn = conn();
        let task = add_task(&conn, "Una tarea").unwrap();
        let base = ensure_task_base(&conn).unwrap();
        assert!(check_deletable(&conn, &base.page_id).is_err());
        assert!(check_deletable(&conn, &task.id).is_ok());
        let other = databases::create_database_page(&conn).unwrap();
        assert!(check_deletable(&conn, &other.id).is_ok());
    }

    #[test]
    fn a_page_can_have_an_icon_and_a_cover_and_only_valid_ones() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        db::run_migrations(&conn).unwrap();
        let page = db::create_page(&conn, None).unwrap();
        let find = |conn: &Connection| db::list_pages(conn).unwrap().into_iter().find(|p| p.id == page.id).unwrap();
        assert_eq!((find(&conn).icon, find(&conn).cover), (None, None));

        db::set_page_icon(&conn, &page.id, Some(" 🚀 ")).unwrap();
        assert_eq!(find(&conn).icon.as_deref(), Some("🚀"));
        // an icon of the library, with its colour, is long but plain
        db::set_page_icon(&conn, &page.id, Some("lucide:TrianglesCenterlineDashedHorizontal:purple")).unwrap();
        for bad in ["a b", "<b>", "x\"y", &"é".repeat(65)] {
            assert!(db::set_page_icon(&conn, &page.id, Some(bad)).is_err(), "{bad}");
        }
        db::set_page_icon(&conn, &page.id, Some("")).unwrap();
        assert_eq!(find(&conn).icon, None, "an empty icon clears it");
        assert!(db::set_page_icon(&conn, "nope", Some("🚀")).is_err());

        let image = format!("image:{}.png", uuid::Uuid::new_v4());
        for good in ["color:green", "season:halloween", "season:summerSun", image.as_str()] {
            db::set_page_cover(&conn, &page.id, Some(good)).unwrap();
            assert_eq!(find(&conn).cover.as_deref(), Some(good));
        }
        for bad in [
            "color:default",
            "color:magenta",
            "season:monsoon",
            "image:../x.png",
            "image:nope.png",
            "gradient:red",
            "green",
            "javascript:alert(1)",
            "image:",
        ] {
            assert!(db::set_page_cover(&conn, &page.id, Some(bad)).is_err(), "{bad}");
        }
        assert_eq!(find(&conn).cover.as_deref(), Some(image.as_str()), "a refused cover leaves the old one");
        db::set_page_cover(&conn, &page.id, None).unwrap();
        assert_eq!(find(&conn).cover, None);
        assert!(db::set_page_cover(&conn, "nope", Some("color:red")).is_err());
    }
}
