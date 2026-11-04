//! Undo and redo for everything the app writes to the database (Ctrl+Z / Ctrl+Shift+Z): tasks, databases, boards,
//! pages, the calendar…
//!
//! How it works: temporary triggers (they live only on this connection) copy, for every change to a table, the SQL
//! that would revert it into a temporary log. `Db::lock` hands out the connection as a `Guard`; when a command lets it
//! go, whatever it logged becomes **one step** of the undo stack. Undoing runs a step's statements backwards in one
//! transaction, and what *that* logs becomes the step of the redo stack. Cascades are logged like any other change,
//! so deleting a page and undoing it brings back its sub-pages, rows and values.
//!
//! Nothing comes from the page: the statements are made by the triggers out of values the database already held
//! (every value goes through `quote()`), so there is no input to validate and nobody can send SQL.
//!
//! What is not in the history, on purpose:
//! - the text of the pages (`save_page_content`) and synced blocks: the editor has its own undo for them and an
//!   autosave every second would bury everything else (`Guard::untracked`);
//! - the search index and the embeddings, which are derived (the index is kept by its own triggers, so an undo keeps it right);
//! - anything done outside the database (attachments are files; the trash's «delete for ever» is not undoable and
//!   wipes the history, so that text is not kept around: `Guard::forget_history`).
//!
//! Known limit: the history lives in memory and starts empty with each launch. An undo goes back by the exact rows
//! that were changed, so if the page text was edited since (untracked), the rows of that edit are overwritten by the
//! older ones. REAL values are copied with 17 digits.

use rusqlite::Connection;
use std::ops::{Deref, DerefMut};
use std::sync::{Mutex, MutexGuard, PoisonError};

/// How many steps are kept, and how much text they may hold in all.
const MAX_STEPS: usize = 200;
const MAX_BYTES: usize = 64 * 1024 * 1024;

/// The statements that revert one command, in the order the command made its changes.
type Step = Vec<String>;

fn size(step: &Step) -> usize {
    step.iter().map(String::len).sum()
}

#[derive(Default)]
struct Stacks {
    undo: Vec<Step>,
    redo: Vec<Step>,
    /// Text held by `undo`.
    bytes: usize,
}

impl Stacks {
    fn push_undo(&mut self, step: Step) {
        self.bytes += size(&step);
        self.undo.push(step);
        while self.undo.len() > MAX_STEPS || (self.bytes > MAX_BYTES && self.undo.len() > 1) {
            self.bytes -= size(&self.undo.remove(0));
        }
    }

    fn pop_undo(&mut self) -> Option<Step> {
        let step = self.undo.pop()?;
        self.bytes -= size(&step);
        Some(step)
    }
}

/// The database connection and its history.
pub struct Db {
    conn: Mutex<Connection>,
    stacks: Mutex<Stacks>,
}

/// The connection while a command uses it. Letting it go closes the step.
pub struct Guard<'a> {
    conn: MutexGuard<'a, Connection>,
    stacks: &'a Mutex<Stacks>,
    changes_before: u64,
    tracked: bool,
    forget: bool,
}

impl Deref for Guard<'_> {
    type Target = Connection;
    fn deref(&self) -> &Connection {
        &self.conn
    }
}

impl DerefMut for Guard<'_> {
    fn deref_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }
}

impl Guard<'_> {
    /// What this command writes does not go to the history (the text of a page, the search index…).
    pub fn untracked(mut self) -> Self {
        self.tracked = false;
        if let Err(e) = self.conn.execute("UPDATE temp._undo_on SET on_ = 0", []) {
            eprintln!("history: could not pause the log: {e}");
        }
        self
    }

    /// What this command does cannot be undone, and nothing before it can either (an erasure on purpose).
    pub fn forget_history(mut self) -> Self {
        self.forget = true;
        self
    }
}

impl Drop for Guard<'_> {
    fn drop(&mut self) {
        if !self.tracked {
            let _ = self.conn.execute("UPDATE temp._undo_on SET on_ = 1", []);
            if !self.forget {
                return;
            }
        }
        // nothing was written (a read): no step
        if self.conn.total_changes() == self.changes_before && !self.forget {
            return;
        }
        let step = take_log(&self.conn);
        let Ok(mut stacks) = self.stacks.lock() else { return };
        if self.forget {
            *stacks = Stacks::default();
        } else if !step.is_empty() {
            stacks.redo.clear();
            stacks.push_undo(step);
        }
    }
}

/// Empties the log and returns it in the order it was written.
fn take_log(conn: &Connection) -> Step {
    let read = || -> rusqlite::Result<Step> {
        let mut stmt = conn.prepare_cached("SELECT sql FROM temp._undo ORDER BY seq")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect()
    };
    let step = read().unwrap_or_else(|e| {
        eprintln!("history: could not read the log: {e}");
        Vec::new()
    });
    if let Err(e) = conn.execute("DELETE FROM temp._undo", []) {
        eprintln!("history: could not empty the log: {e}");
    }
    step
}

fn ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// The SQL expression that writes `row.column` back as a literal. A REAL keeps its 17 digits (and its decimal
/// point, so it does not come back as an INTEGER).
fn literal(row: &str, column: &str) -> String {
    let value = format!("{row}.{}", ident(column));
    format!("CASE typeof({value}) WHEN 'real' THEN printf('%!.17g', {value}) ELSE quote({value}) END")
}

/// Creates the log and a trigger per table. The tables are the ones that exist: a table added by a later version is
/// covered without touching this.
fn install(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TEMP TABLE _undo (seq INTEGER PRIMARY KEY AUTOINCREMENT, sql TEXT NOT NULL);
         CREATE TEMP TABLE _undo_on (on_ INTEGER NOT NULL);
         INSERT INTO _undo_on VALUES (1);",
    )?;
    let tables: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT name FROM main.sqlite_master
             WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE 'page\\_search%' ESCAPE '\\'
               AND name <> 'page_embeddings'",
        )?;
        let names = stmt.query_map([], |r| r.get(0))?;
        names.collect::<rusqlite::Result<_>>()?
    };
    for table in tables {
        let columns: Vec<String> = {
            let mut stmt = conn.prepare("SELECT name FROM pragma_table_info(?1)")?;
            let names = stmt.query_map([&table], |r| r.get(0))?;
            names.collect::<rusqlite::Result<_>>()?
        };
        let t = ident(&table);
        let list = columns.iter().map(|c| ident(c)).collect::<Vec<_>>().join(", ");
        let old_values = columns.iter().map(|c| literal("old", c)).collect::<Vec<_>>().join(" || ',' || ");
        let assignments = columns
            .iter()
            .map(|c| format!("'{}=' || {}", ident(c).replace('\'', "''"), literal("old", c)))
            .collect::<Vec<_>>()
            .join(" || ',' || ");
        let when = "WHEN (SELECT on_ FROM temp._undo_on) = 1";
        conn.execute_batch(&format!(
            "CREATE TEMP TRIGGER {ti} AFTER INSERT ON main.{t} {when} BEGIN
                 INSERT INTO _undo (sql) VALUES ('DELETE FROM ' || '{tq}' || ' WHERE rowid=' || new.rowid);
             END;
             CREATE TEMP TRIGGER {td} AFTER DELETE ON main.{t} {when} BEGIN
                 INSERT INTO _undo (sql) VALUES ('INSERT INTO {tq}(rowid, {lq}) VALUES (' || old.rowid || ',' || {old_values} || ')');
             END;
             CREATE TEMP TRIGGER {tu} AFTER UPDATE ON main.{t} {when} BEGIN
                 INSERT INTO _undo (sql) VALUES ('UPDATE {tq} SET rowid=' || old.rowid || ',' || {assignments} || ' WHERE rowid=' || new.rowid);
             END;",
            ti = ident(&format!("_undo_{table}_i")),
            td = ident(&format!("_undo_{table}_d")),
            tu = ident(&format!("_undo_{table}_u")),
            tq = t.replace('\'', "''"),
            lq = list.replace('\'', "''"),
        ))?;
    }
    Ok(())
}

impl Db {
    pub fn new(conn: Connection) -> rusqlite::Result<Self> {
        install(&conn)?;
        Ok(Db {
            conn: Mutex::new(conn),
            stacks: Mutex::new(Stacks::default()),
        })
    }

    /// Takes the connection. The error is only ever shown as text.
    pub fn lock(&self) -> Result<Guard<'_>, PoisonError<()>> {
        let conn = self.conn.lock().map_err(|_| PoisonError::new(()))?;
        let changes_before = conn.total_changes();
        Ok(Guard {
            conn,
            stacks: &self.stacks,
            changes_before,
            tracked: true,
            forget: false,
        })
    }

    /// Ctrl+Z: false when there is nothing to undo.
    pub fn undo(&self) -> Result<bool, String> {
        self.travel(true)
    }

    /// Ctrl+Shift+Z: false when there is nothing to redo.
    pub fn redo(&self) -> Result<bool, String> {
        self.travel(false)
    }

    fn travel(&self, back: bool) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stacks = self.stacks.lock().map_err(|e| e.to_string())?;
        let step = if back { stacks.pop_undo() } else { stacks.redo.pop() };
        let Some(step) = step else { return Ok(false) };
        take_log(&conn); // nothing is pending, but what is must not end up in the opposite step
        let done = run(&conn, &step);
        // what the run logged reverts it: that is the step of the opposite stack (nothing, if it was rolled back)
        let opposite = take_log(&conn);
        done.map_err(|e| format!("No se pudo deshacer: {e}"))?;
        if back {
            stacks.redo.push(opposite);
        } else {
            stacks.push_undo(opposite);
        }
        Ok(true)
    }
}

/// Runs the statements of a step backwards in one transaction (the foreign keys are checked at its end).
fn run(conn: &Connection, step: &Step) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch("PRAGMA defer_foreign_keys = ON")?;
    for sql in step.iter().rev() {
        tx.execute(sql, [])?;
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{boards, databases, db, trash};
    use rusqlite::params;

    fn history() -> Db {
        let conn = Connection::open_in_memory().unwrap();
        db::harden(&conn).unwrap();
        db::run_migrations(&conn).unwrap();
        Db::new(conn).unwrap()
    }

    fn count(db: &Db, sql: &str) -> i64 {
        db.lock().unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn a_command_is_one_step_and_undo_and_redo_walk_it() {
        let h = history();
        assert!(!h.undo().unwrap() && !h.redo().unwrap(), "nothing yet");
        db::create_page(&h.lock().unwrap(), None).unwrap();
        assert_eq!(count(&h, "SELECT COUNT(*) FROM pages"), 1);
        assert!(h.undo().unwrap());
        assert_eq!(count(&h, "SELECT COUNT(*) FROM pages"), 0, "the page is gone");
        assert_eq!(count(&h, "SELECT COUNT(*) FROM blocks"), 0, "and its first block with it");
        assert!(h.redo().unwrap());
        assert_eq!(count(&h, "SELECT COUNT(*) FROM pages"), 1);
        assert!(!h.redo().unwrap(), "nothing more to redo");
        // a read is no step, and a new write ends the redo
        let _ = db::list_pages(&h.lock().unwrap());
        db::create_page(&h.lock().unwrap(), None).unwrap();
        assert!(!h.redo().unwrap());
        assert!(h.undo().unwrap() && h.undo().unwrap(), "both creations were steps, the read was not");
        assert!(!h.undo().unwrap());
    }

    #[test]
    fn deleting_a_board_and_undoing_it_brings_back_its_lists() {
        let h = history();
        let board = boards::create_board(&h.lock().unwrap(), "Semana").unwrap();
        let lists = count(&h, "SELECT COUNT(*) FROM board_lists");
        assert!(lists > 0, "a new board comes with lists");
        boards::delete_board(&h.lock().unwrap(), &board.id).unwrap();
        assert_eq!(count(&h, "SELECT COUNT(*) FROM board_lists"), 0, "the cascade took them");
        assert!(h.undo().unwrap());
        assert_eq!(count(&h, "SELECT COUNT(*) FROM board_lists"), lists);
        assert_eq!(count(&h, "SELECT COUNT(*) FROM boards"), 1);
    }

    #[test]
    fn untracked_writes_leave_no_step_and_forgetting_wipes_all() {
        let h = history();
        let page = db::create_page(&h.lock().unwrap(), None).unwrap();
        // the text of a page is not in the history
        {
            let conn = h.lock().unwrap().untracked();
            let doc = serde_json::json!({"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "hola"}]}]});
            db::save_page_content(&conn, &page.id, &doc).unwrap();
        }
        assert!(h.undo().unwrap(), "only the creation was a step");
        assert!(!h.undo().unwrap());
        db::create_page(&h.lock().unwrap(), None).unwrap();
        drop(h.lock().unwrap().forget_history());
        assert!(!h.undo().unwrap(), "erased on purpose: nothing comes back");
    }

    #[test]
    fn values_come_back_exactly_reals_stay_reals() {
        let h = history();
        let database = databases::create_database_page(&h.lock().unwrap()).unwrap();
        let database_id = database.own_database_id.clone().unwrap();
        let prop = databases::add_property(&h.lock().unwrap(), &database_id, "N", "number", &serde_json::json!({})).unwrap();
        let row = databases::create_row(&h.lock().unwrap(), &database_id).unwrap();
        let value = |h: &Db| -> (String, f64) {
            h.lock()
                .unwrap()
                .query_row("SELECT typeof(value), value FROM property_values WHERE property_id = ?1", params![prop.id], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .unwrap()
        };
        databases::set_value(&h.lock().unwrap(), &row.id, &prop.id, &serde_json::json!(5.0)).unwrap();
        databases::set_value(&h.lock().unwrap(), &row.id, &prop.id, &serde_json::json!(0.1 + 0.2)).unwrap();
        assert!(h.undo().unwrap());
        assert_eq!(value(&h), ("real".to_string(), 5.0), "5.0 comes back as a REAL, not as the integer 5");
        assert!(h.redo().unwrap());
        assert_eq!(value(&h).1, 0.1 + 0.2, "all 17 digits");
        // deleting the whole database (page, rows, values) and undoing it
        trash::move_to_trash(&h.lock().unwrap(), &database.id).unwrap();
        assert_eq!(count(&h, "SELECT COUNT(*) FROM property_values"), 0);
        assert!(h.undo().unwrap());
        assert_eq!(count(&h, "SELECT COUNT(*) FROM property_values"), 1);
        assert_eq!(count(&h, "SELECT COUNT(*) FROM trash"), 0);
        assert_eq!(value(&h).1, 0.1 + 0.2);
    }
}
