use crate::validate;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PageSummary {
    pub id: String,
    pub title: String,
    pub parent_id: Option<String>,
    /// Set when the page is a row of a database.
    pub database_id: Option<String>,
    /// `"page"` or `"database"`: a database page *is* a database.
    pub kind: String,
    /// The database a `"database"` page owns (None for ordinary pages and rows).
    pub own_database_id: Option<String>,
    /// `"tasks"` on the page of the Gestor's task database; None on every other page.
    pub role: Option<String>,
    /// Pinned by the user: such pages also appear in the «Favoritos» group.
    pub favorite: bool,
    /// The page's icon: an emoji, shown before its title; None = the kind's own icon.
    pub icon: Option<String>,
    /// The page's cover: `color:<name>`, `season:<name>` or `image:<attachment>`; None = no cover.
    pub cover: Option<String>,
}

/// What the page menu shows at its foot: when the page was last edited and how long it is.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    /// `YYYY-MM-DD HH:MM:SS`, UTC (SQLite's `datetime('now')`).
    pub updated_at: String,
    pub words: usize,
}

pub struct DbState(pub Mutex<Connection>);

const V1_SCHEMA: &str = r#"
    CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        parent_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '{}',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_blocks_page_id ON blocks(page_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_parent_id ON blocks(parent_id);
    CREATE INDEX IF NOT EXISTS idx_pages_parent_id ON pages(parent_id);
    "#;

/// A `database` block in a page doc only holds its id; schema and
/// data live here. Rows are ordinary pages tagged with `pages.database_id`.
/// `property_values.value` has no declared type on purpose (NONE affinity):
/// numbers stay REAL and everything else TEXT, so 2.8/2.9 can ORDER BY and
/// aggregate numerically. Relations get their own table so the FKs (cascade on
/// both ends) keep them from dangling when a row page is deleted — a JSON
/// array in `property_values` could not.
const V5_SCHEMA: &str = r#"
    CREATE TABLE databases (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE properties (
        id TEXT PRIMARY KEY,
        database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('text', 'number', 'date', 'select', 'relation')),
        config TEXT NOT NULL DEFAULT '{}',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_properties_database_id ON properties(database_id);

    CREATE TABLE property_values (
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        value,
        PRIMARY KEY (page_id, property_id)
    );

    CREATE TABLE property_relations (
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        PRIMARY KEY (property_id, page_id, target_id)
    );

    ALTER TABLE pages ADD COLUMN database_id TEXT REFERENCES databases(id) ON DELETE CASCADE;
    CREATE INDEX idx_pages_database_id ON pages(database_id);
    "#;

pub(crate) fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    run_migrations_up_to(conn, i64::MAX)
}

/// `target` lets a test stop at an old schema version, load data, then migrate on.
pub(crate) fn run_migrations_up_to(conn: &Connection, target: i64) -> rusqlite::Result<()> {
    let current_version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    if current_version < 1 && target >= 1 {
        conn.execute_batch(V1_SCHEMA)?;
        conn.pragma_update(None, "user_version", 1)?;
    }

    if current_version < 2 && target >= 2 {
        // The page title is no longer a standalone column — it's derived from
        // the text of the page's first block (a heading), Notion-style.
        migrate_titles_into_first_block(conn)?;
        conn.execute_batch("ALTER TABLE pages DROP COLUMN title;")?;
        conn.pragma_update(None, "user_version", 2)?;
    }

    if current_version < 4 && target >= 4 {
        // Synced blocks: content shared by id. Page docs only hold
        // a `syncedBlock { syncId }` reference to a row here. Version 4, not 3:
        // existing dev databases are already at 3 from the discarded original
        // Old schema (a leftover `properties` table), so a `< 3` guard
        // would silently skip creating this table.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS synced_blocks (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )?;
        conn.pragma_update(None, "user_version", 4)?;
    }

    if current_version < 5 && target >= 5 {
        // Dev databases may still hold the `properties` table of the discarded
        // Old schema (hung off `pages` via `page_id`, test rows only).
        // Drop it only if it has that old shape — V5_SCHEMA creates the real one.
        let legacy = conn.prepare("SELECT 1 FROM pragma_table_info('properties') WHERE name = 'page_id'")?.exists([])?;
        if legacy {
            conn.execute_batch("DROP TABLE properties;")?;
        }
        conn.execute_batch(V5_SCHEMA)?;
        conn.pragma_update(None, "user_version", 5)?;
    }

    if current_version < 6 && target >= 6 {
        // a database is a page of its own kind, no longer a block's
        // private data. Its name is now the page title.
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch("ALTER TABLE pages ADD COLUMN kind TEXT NOT NULL DEFAULT 'page' CHECK (kind IN ('page', 'database'));")?;
        migrate_databases_to_pages(&tx)?;
        tx.execute_batch(
            "ALTER TABLE databases DROP COLUMN name;
             CREATE UNIQUE INDEX idx_databases_page_id ON databases(page_id);",
        )?;
        tx.commit()?;
        conn.pragma_update(None, "user_version", 6)?;
    }

    if current_version < 7 && target >= 7 {
        // saved views. `type` has no CHECK on purpose (more kinds come with 2.8.2+).
        conn.execute_batch(
            "CREATE TABLE views (
                id TEXT PRIMARY KEY,
                database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                config TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX idx_views_database_id ON views(database_id);",
        )?;
        // every existing database gets the table view it was already showing
        let ids: Vec<String> = {
            let mut stmt = conn.prepare("SELECT id FROM databases")?;
            let rows = stmt.query_map([], |row| row.get(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        for id in ids {
            crate::views::create_default_view(conn, &id).map_err(rusqlite::Error::InvalidParameterName)?;
        }
        conn.pragma_update(None, "user_version", 7)?;
    }

    if current_version < 8 && target >= 8 {
        // the `place` property kind. `properties.type` carried a CHECK
        // that can't be widened in place, and new kinds keep coming (Rust validates
        // them now, as it does for views), so rebuild the table without it. Other
        // tables reference `properties(id)` with ON DELETE CASCADE: foreign keys must
        // be off while it is dropped or every value and relation would go with it.
        conn.pragma_update(None, "foreign_keys", false)?;
        let rebuilt = (|| -> rusqlite::Result<()> {
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(
                "CREATE TABLE properties_new (
                    id TEXT PRIMARY KEY,
                    database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    config TEXT NOT NULL DEFAULT '{}',
                    position INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                INSERT INTO properties_new SELECT id, database_id, name, type, config, position, created_at FROM properties;
                DROP TABLE properties;
                ALTER TABLE properties_new RENAME TO properties;
                CREATE INDEX idx_properties_database_id ON properties(database_id);",
            )?;
            tx.commit()
        })();
        conn.pragma_update(None, "foreign_keys", true)?;
        rebuilt?;
        conn.pragma_update(None, "user_version", 8)?;
    }

    if current_version < 9 && target >= 9 {
        // full-text search over every page's title and text.
        conn.execute_batch(V9_SEARCH)?;
        conn.pragma_update(None, "user_version", 9)?;
    }

    if current_version < 10 && target >= 10 {
        // database rows are also found by their cell values.
        conn.execute_batch(V10_SEARCH_PROPS)?;
        conn.execute_batch(SEARCH_SOURCE_VIEW)?;
        conn.execute_batch(V10_SEARCH_TRIGGERS)?;
        conn.pragma_update(None, "user_version", 10)?;
    }

    if current_version < 11 && target >= 11 {
        // cell values in column order, « · » between them, whole numbers without «.0».
        conn.execute_batch("DROP VIEW page_search_source;")?;
        conn.execute_batch(SEARCH_SOURCE_VIEW)?;
        conn.execute_batch(
            "DELETE FROM page_search;
             INSERT INTO page_search (rowid, page_id, title, body, props)
             SELECT block_rowid, page_id, title, body, props FROM page_search_source;",
        )?;
        conn.pragma_update(None, "user_version", 11)?;
    }

    if current_version < 12 && target >= 12 {
        // one embedding per page for semantic search (ai.rs). `text_hash` says whether
        // the page changed since it was embedded; a page's vector goes with it (cascade).
        conn.execute_batch(
            "CREATE TABLE page_embeddings (
                page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
                model TEXT NOT NULL,
                text_hash TEXT NOT NULL,
                vector BLOB NOT NULL
            );",
        )?;
        conn.pragma_update(None, "user_version", 12)?;
    }

    if current_version < 13 && target >= 13 {
        // a database can have a role (`tasks` = the Gestor's task database, only one), and
        // the `tags` property kind joins the search index (the view is rebuilt, the index refilled).
        conn.execute_batch(
            "ALTER TABLE databases ADD COLUMN role TEXT;
             CREATE UNIQUE INDEX idx_databases_role ON databases(role) WHERE role IS NOT NULL;
             DROP VIEW page_search_source;",
        )?;
        conn.execute_batch(SEARCH_SOURCE_VIEW)?;
        conn.execute_batch(
            "DELETE FROM page_search;
             INSERT INTO page_search (rowid, page_id, title, body, props)
             SELECT block_rowid, page_id, title, body, props FROM page_search_source;",
        )?;
        conn.pragma_update(None, "user_version", 13)?;
    }

    if current_version < 14 && target >= 14 {
        // a property can carry an icon of the user's choosing (a lucide name or an emoji).
        conn.execute_batch("ALTER TABLE properties ADD COLUMN icon TEXT;")?;
        conn.pragma_update(None, "user_version", 14)?;
    }

    if current_version < 15 && target >= 15 {
        // favourite pages.
        conn.execute_batch("ALTER TABLE pages ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;")?;
        conn.pragma_update(None, "user_version", 15)?;
    }

    if current_version < 16 && target >= 16 {
        // a task can be linked to ordinary pages (and a page shows its tasks). Gone with either end.
        conn.execute_batch(
            "CREATE TABLE page_links (
                 task_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
                 page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 PRIMARY KEY (task_id, page_id)
             );
             CREATE INDEX idx_page_links_page ON page_links(page_id);",
        )?;
        conn.pragma_update(None, "user_version", 16)?;
    }

    if current_version < 17 && target >= 17 {
        // the calendar. An entry schedules a task (`task_id`, gone with it) or is an appointment with a title
        // of its own; times are floating local times (`YYYY-MM-DDTHH:MM`, or a bare date for an all-day entry).
        conn.execute_batch(
            "CREATE TABLE calendar_entries (
                 id TEXT PRIMARY KEY,
                 task_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
                 title TEXT,
                 starts_at TEXT NOT NULL,
                 ends_at TEXT NOT NULL,
                 all_day INTEGER NOT NULL DEFAULT 0,
                 color TEXT,
                 location TEXT,
                 note TEXT,
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 CHECK (task_id IS NOT NULL OR (title IS NOT NULL AND title <> ''))
             );
             CREATE INDEX idx_calendar_entries_start ON calendar_entries(starts_at);
             CREATE INDEX idx_calendar_entries_task ON calendar_entries(task_id);",
        )?;
        conn.pragma_update(None, "user_version", 17)?;
    }

    if current_version < 18 && target >= 18 {
        // an entry can repeat. `recurrence` holds the rule (JSON, see calendar.rs); an occurrence that was
        // deleted or edited on its own is listed in `calendar_exceptions` (the edited one lives on as an entry of its own).
        conn.execute_batch(
            "ALTER TABLE calendar_entries ADD COLUMN recurrence TEXT;
             CREATE TABLE calendar_exceptions (
                 entry_id TEXT NOT NULL REFERENCES calendar_entries(id) ON DELETE CASCADE,
                 day TEXT NOT NULL,
                 PRIMARY KEY (entry_id, day)
             );",
        )?;
        conn.pragma_update(None, "user_version", 18)?;
    }

    if current_version < 19 && target >= 19 {
        // boards (like Trello's). A card is a *reference* to a task, never a copy: the same task can sit on
        // several boards (once per board: `UNIQUE (board_id, task_id)`), removing a card leaves the task alone and
        // deleting the task (or a list, or the board) takes its cards with it. The lists of a board are free, not the
        // task's Estado. `position` is the order inside the board or the list.
        conn.execute_batch(
            "CREATE TABLE boards (
                 id TEXT PRIMARY KEY,
                 name TEXT NOT NULL CHECK (name <> ''),
                 created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE TABLE board_lists (
                 id TEXT PRIMARY KEY,
                 board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
                 name TEXT NOT NULL CHECK (name <> ''),
                 position INTEGER NOT NULL
             );
             CREATE INDEX idx_board_lists_board ON board_lists(board_id);
             CREATE TABLE board_cards (
                 id TEXT PRIMARY KEY,
                 board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
                 list_id TEXT NOT NULL REFERENCES board_lists(id) ON DELETE CASCADE,
                 task_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
                 position INTEGER NOT NULL,
                 UNIQUE (board_id, task_id)
             );
             CREATE INDEX idx_board_cards_list ON board_cards(list_id);
             CREATE INDEX idx_board_cards_task ON board_cards(task_id);",
        )?;
        conn.pragma_update(None, "user_version", 19)?;
    }

    if current_version < 20 && target >= 20 {
        // a page can have an icon (an emoji) and a cover (a colour, a season's palette or an uploaded image).
        conn.execute_batch("ALTER TABLE pages ADD COLUMN icon TEXT; ALTER TABLE pages ADD COLUMN cover TEXT;")?;
        conn.pragma_update(None, "user_version", 20)?;
    }

    if current_version < 21 && target >= 21 {
        // no schema change. Version 21 marks the databases that `init` has cleaned once
        // (VACUUM) after turning `secure_delete` on, so the text deleted or replaced before that
        // does not stay in the file's free space.
        conn.pragma_update(None, "user_version", 21)?;
    }

    if current_version < 22 && target >= 22 {
        // the order of a database's rows, once someone drags one: NULL = never placed (creation order,
        // after every placed row), so new rows still go last and nothing existing has to be renumbered.
        conn.execute_batch("ALTER TABLE pages ADD COLUMN row_position INTEGER;")?;
        conn.pragma_update(None, "user_version", 22)?;
    }

    if current_version < 23 && target >= 23 {
        // the trash: a deleted page leaves as a snapshot (trash.rs), kept 30 days, instead of vanishing for good.
        conn.execute_batch(
            "CREATE TABLE trash (
                 id TEXT PRIMARY KEY,
                 title TEXT NOT NULL,
                 kind TEXT NOT NULL,
                 icon TEXT,
                 page_count INTEGER NOT NULL,
                 deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
                 snapshot TEXT NOT NULL
             );",
        )?;
        conn.pragma_update(None, "user_version", 23)?;
    }

    Ok(())
}

/// `page_search` is an FTS5 index of each page's title (its first heading) and body
/// (the rest of its text), kept in step by triggers on the page's `doc` block — so every write
/// path (editor save, renaming a row from its table, new pages, cascading deletes) updates it
/// without each having to remember. The text comes out of the Tiptap JSON with SQLite's own JSON
/// functions (`page_search_source`); the FTS rowid is the doc block's rowid, so the triggers find
/// their row directly. `remove_diacritics 2`: «revision» finds «revisión».
const V9_SEARCH: &str = r#"
    CREATE VIRTUAL TABLE page_search USING fts5(
        page_id UNINDEXED, title, body,
        tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE VIEW page_search_source AS
    SELECT
        b.rowid AS block_rowid,
        b.page_id AS page_id,
        CASE WHEN json_extract(b.content, '$.content[0].type') = 'heading'
            THEN coalesce((SELECT group_concat(t.value, ' ') FROM json_tree(b.content, '$.content[0]') t
                           WHERE t.key = 'text' AND t.type = 'text'), '')
            ELSE '' END AS title,
        coalesce((SELECT group_concat(t.value, ' ') FROM json_tree(b.content, '$.content') t
                  WHERE t.key = 'text' AND t.type = 'text'
                    AND (json_extract(b.content, '$.content[0].type') IS NOT 'heading'
                         OR t.fullkey NOT LIKE '$.content[0].%')), '') AS body
    FROM blocks b
    WHERE b.type = 'doc' AND b.parent_id IS NULL AND json_valid(b.content);

    CREATE TRIGGER page_search_insert AFTER INSERT ON blocks
    WHEN NEW.type = 'doc' AND NEW.parent_id IS NULL BEGIN
        INSERT INTO page_search (rowid, page_id, title, body)
        SELECT block_rowid, page_id, title, body FROM page_search_source WHERE block_rowid = NEW.rowid;
    END;

    CREATE TRIGGER page_search_update AFTER UPDATE OF content ON blocks
    WHEN NEW.type = 'doc' AND NEW.parent_id IS NULL BEGIN
        DELETE FROM page_search WHERE rowid = OLD.rowid;
        INSERT INTO page_search (rowid, page_id, title, body)
        SELECT block_rowid, page_id, title, body FROM page_search_source WHERE block_rowid = NEW.rowid;
    END;

    CREATE TRIGGER page_search_delete AFTER DELETE ON blocks
    WHEN OLD.type = 'doc' AND OLD.parent_id IS NULL BEGIN
        DELETE FROM page_search WHERE rowid = OLD.rowid;
    END;

    INSERT INTO page_search (rowid, page_id, title, body)
    SELECT block_rowid, page_id, title, body FROM page_search_source;
"#;

/// The index gains a `props` column: a row's cell values as text (text, select,
/// number, date, a place's label — relations are other pages, found on their own). An FTS5
/// table can't take a new column, so index, view and triggers are rebuilt; the same triggers
/// plus three on `property_values` keep it current, which covers every cell write, a property
/// changing type, an option renamed and a property deleted (its values go by cascade).
const V10_SEARCH_PROPS: &str = r#"
    DROP TRIGGER page_search_insert;
    DROP TRIGGER page_search_update;
    DROP TRIGGER page_search_delete;
    DROP VIEW page_search_source;
    DROP TABLE page_search;

    CREATE VIRTUAL TABLE page_search USING fts5(
        page_id UNINDEXED, title, body, props,
        tokenize = 'unicode61 remove_diacritics 2'
    );

"#;

/// The text the search index holds for each page (title, body, cell values). Shared by the
/// migrations that (re)build it.
const SEARCH_SOURCE_VIEW: &str = r#"
    CREATE VIEW page_search_source AS
    SELECT
        b.rowid AS block_rowid,
        b.page_id AS page_id,
        CASE WHEN json_extract(b.content, '$.content[0].type') = 'heading'
            THEN coalesce((SELECT group_concat(t.value, ' ') FROM json_tree(b.content, '$.content[0]') t
                           WHERE t.key = 'text' AND t.type = 'text'), '')
            ELSE '' END AS title,
        coalesce((SELECT group_concat(t.value, ' ') FROM json_tree(b.content, '$.content') t
                  WHERE t.key = 'text' AND t.type = 'text'
                    AND (json_extract(b.content, '$.content[0].type') IS NOT 'heading'
                         OR t.fullkey NOT LIKE '$.content[0].%')), '') AS body,
        coalesce((SELECT group_concat(
                      CASE
                          WHEN p.type = 'place' THEN json_extract(v.value, '$.name')
                          WHEN p.type = 'tags' THEN (SELECT group_concat(j.value, ', ') FROM json_each(v.value) j)
                          WHEN p.type = 'number' AND v.value = CAST(v.value AS INTEGER) THEN CAST(CAST(v.value AS INTEGER) AS TEXT)
                          ELSE v.value
                      END, ' · ' ORDER BY p.position, p.rowid)
                  FROM property_values v JOIN properties p ON p.id = v.property_id
                  WHERE v.page_id = b.page_id
                    AND p.type IN ('text', 'select', 'number', 'date', 'place', 'tags')
                    AND (p.type NOT IN ('place', 'tags') OR json_valid(v.value))), '') AS props
    FROM blocks b
    WHERE b.type = 'doc' AND b.parent_id IS NULL AND json_valid(b.content);
"#;

/// Triggers (after the view exists): the page's doc block and its cell values.
const V10_SEARCH_TRIGGERS: &str = r#"
    CREATE TRIGGER page_search_insert AFTER INSERT ON blocks
    WHEN NEW.type = 'doc' AND NEW.parent_id IS NULL BEGIN
        INSERT INTO page_search (rowid, page_id, title, body, props)
        SELECT block_rowid, page_id, title, body, props FROM page_search_source WHERE block_rowid = NEW.rowid;
    END;

    CREATE TRIGGER page_search_update AFTER UPDATE OF content ON blocks
    WHEN NEW.type = 'doc' AND NEW.parent_id IS NULL BEGIN
        DELETE FROM page_search WHERE rowid = OLD.rowid;
        INSERT INTO page_search (rowid, page_id, title, body, props)
        SELECT block_rowid, page_id, title, body, props FROM page_search_source WHERE block_rowid = NEW.rowid;
    END;

    CREATE TRIGGER page_search_delete AFTER DELETE ON blocks
    WHEN OLD.type = 'doc' AND OLD.parent_id IS NULL BEGIN
        DELETE FROM page_search WHERE rowid = OLD.rowid;
    END;

    CREATE TRIGGER page_search_value_insert AFTER INSERT ON property_values BEGIN
        DELETE FROM page_search WHERE rowid =
            (SELECT rowid FROM blocks WHERE page_id = NEW.page_id AND type = 'doc' AND parent_id IS NULL);
        INSERT INTO page_search (rowid, page_id, title, body, props)
        SELECT block_rowid, page_id, title, body, props FROM page_search_source WHERE page_id = NEW.page_id;
    END;

    CREATE TRIGGER page_search_value_update AFTER UPDATE ON property_values BEGIN
        DELETE FROM page_search WHERE rowid =
            (SELECT rowid FROM blocks WHERE page_id = NEW.page_id AND type = 'doc' AND parent_id IS NULL);
        INSERT INTO page_search (rowid, page_id, title, body, props)
        SELECT block_rowid, page_id, title, body, props FROM page_search_source WHERE page_id = NEW.page_id;
    END;

    CREATE TRIGGER page_search_value_delete AFTER DELETE ON property_values BEGIN
        DELETE FROM page_search WHERE rowid =
            (SELECT rowid FROM blocks WHERE page_id = OLD.page_id AND type = 'doc' AND parent_id IS NULL);
        INSERT INTO page_search (rowid, page_id, title, body, props)
        SELECT block_rowid, page_id, title, body, props FROM page_search_source WHERE page_id = OLD.page_id;
    END;

    INSERT INTO page_search (rowid, page_id, title, body, props)
    SELECT block_rowid, page_id, title, body, props FROM page_search_source;
"#;

/// v5 -> v6 data migration. Each database (which hung off its host page, with
/// a name column) becomes a root-level `database` page titled with that name;
/// its rows move under it. Page docs keep their `database` blocks untouched —
/// the blocks reference the database by id, so they simply become views.
fn migrate_databases_to_pages(conn: &Connection) -> rusqlite::Result<()> {
    let dbs: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT id, name FROM databases ORDER BY created_at, rowid")?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (db_id, name) in dbs {
        let page_id = Uuid::new_v4().to_string();
        conn.execute("INSERT INTO pages (id, parent_id, kind) VALUES (?1, NULL, 'database')", [&page_id])?;
        let doc = database_page_doc(&name);
        conn.execute(
            "INSERT INTO blocks (id, page_id, type, content) VALUES (?1, ?2, 'doc', ?3)",
            (Uuid::new_v4().to_string(), &page_id, doc.to_string()),
        )?;
        conn.execute("UPDATE databases SET page_id = ?1 WHERE id = ?2", (&page_id, &db_id))?;
        conn.execute("UPDATE pages SET parent_id = ?1 WHERE database_id = ?2", (&page_id, &db_id))?;
    }
    Ok(())
}

/// A database page's document is just its title: the table is rendered by the
/// app, not stored as a block (so it can't be deleted from the page).
pub(crate) fn database_page_doc(title: &str) -> Value {
    json!({ "type": "doc", "content": [heading_node(title)] })
}

/// A stored document, ready to be edited in place: an object whose `content` is a list. Anything
/// else that may be stored (damaged text; a value that is not a document, which older versions
/// accepted as a page: `true`, a list…) becomes an empty document. Writing `doc["content"] = …` into
/// a `Value` that is not an object panics, and a panic aborts the whole app.
fn editable_doc(stored: &str) -> Value {
    match serde_json::from_str::<Value>(stored) {
        Ok(mut doc) if doc.is_object() => {
            if !doc.get("content").is_some_and(Value::is_array) {
                doc["content"] = json!([]);
            }
            doc
        }
        _ => json!({ "type": "doc", "content": [] }),
    }
}

fn heading_node(text: &str) -> Value {
    if text.is_empty() {
        json!({ "type": "heading", "attrs": { "level": 1 } })
    } else {
        json!({
            "type": "heading",
            "attrs": { "level": 1 },
            "content": [{ "type": "text", "text": text }]
        })
    }
}

/// One-time data migration for the v1 -> v2 schema change: moves each page's
/// `title` column value into the text of its first (heading) block.
fn migrate_titles_into_first_block(conn: &Connection) -> rusqlite::Result<()> {
    let pages: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT id, title FROM pages")?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    for (page_id, title) in pages {
        let existing: Option<(String, String)> = conn
            .query_row(
                "SELECT id, content FROM blocks WHERE page_id = ?1 AND parent_id IS NULL AND type = 'doc' LIMIT 1",
                [&page_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;

        match existing {
            Some((block_id, content_str)) => {
                let mut doc = editable_doc(&content_str);
                let arr = doc["content"].as_array_mut().expect("just ensured this is an array");

                let starts_with_heading = arr.first().and_then(|n| n.get("type")).and_then(|t| t.as_str()) == Some("heading");

                if starts_with_heading {
                    arr[0] = heading_node(&title);
                } else {
                    arr.insert(0, heading_node(&title));
                }

                let new_content_str = serde_json::to_string(&doc).expect("Value serialization cannot fail");
                conn.execute("UPDATE blocks SET content = ?1 WHERE id = ?2", (&new_content_str, &block_id))?;
            }
            None => {
                let doc = json!({ "type": "doc", "content": [heading_node(&title), { "type": "paragraph" }] });
                let content_str = serde_json::to_string(&doc).expect("Value serialization cannot fail");
                let block_id = Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO blocks (id, page_id, type, content) VALUES (?1, ?2, 'doc', ?3)",
                    (&block_id, &page_id, &content_str),
                )?;
            }
        }
    }

    Ok(())
}

/// What every connection to the notes database gets.
///
/// `secure_delete`: SQLite normally leaves the bytes of a deleted or replaced row in the file
/// (in the page, or in a freed page) until something else is written over them. Every autosave
/// replaces the whole document, so text the user deleted, from a page or from the middle of one,
/// stayed readable in `albaro-notes.sqlite` (and in what the search index and the embeddings hold).
/// With it on, SQLite overwrites that space with zeros at the moment it frees it.
pub(crate) fn harden(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.pragma_update(None, "secure_delete", true)
}

/// The files SQLite keeps next to the database while it works.
const DATA_FILES: [&str; 4] = ["albaro-notes.sqlite", "albaro-notes.sqlite-journal", "albaro-notes.sqlite-wal", "albaro-notes.sqlite-shm"];

pub fn init(app_data_dir: &Path) -> rusqlite::Result<Connection> {
    fs::create_dir_all(app_data_dir).expect("failed to create app data directory");

    let db_path: PathBuf = app_data_dir.join("albaro-notes.sqlite");
    let conn = Connection::open(db_path)?;

    harden(&conn)?;
    let before: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    run_migrations(&conn)?;
    // A database that already existed has the text deleted before `secure_delete` was on sitting in
    // its free pages: rewrite the file once. (A new database, version 0, has nothing to clean.)
    if (1..21).contains(&before) {
        conn.execute_batch("VACUUM")?;
    }
    crate::fsprivate::keep_data_private(app_data_dir, &DATA_FILES);

    Ok(conn)
}

/// Walks a JSONContent node's text and its children's, depth-first.
fn collect_text(node: &Value, out: &mut String) {
    if let Some(text) = node.get("text").and_then(|t| t.as_str()) {
        out.push_str(text);
    }
    if let Some(children) = node.get("content").and_then(|c| c.as_array()) {
        for child in children {
            collect_text(child, out);
        }
    }
}

fn extract_first_heading_text(doc: &Value) -> Option<String> {
    let first = doc.get("content")?.as_array()?.first()?;
    if first.get("type")?.as_str()? != "heading" {
        return None;
    }
    let mut text = String::new();
    collect_text(first, &mut text);
    Some(text)
}

pub(crate) fn derive_page_title(conn: &Connection, page_id: &str) -> rusqlite::Result<String> {
    let content: Option<String> = conn
        .query_row(
            "SELECT content FROM blocks WHERE page_id = ?1 AND parent_id IS NULL AND type = 'doc' LIMIT 1",
            [page_id],
            |row| row.get(0),
        )
        .optional()?;

    let title = content
        .and_then(|c| serde_json::from_str::<Value>(&c).ok())
        .and_then(|doc| extract_first_heading_text(&doc))
        .unwrap_or_default();

    Ok(if title.is_empty() { "Sin título".to_string() } else { title })
}

pub fn list_pages(conn: &Connection) -> rusqlite::Result<Vec<PageSummary>> {
    type Row = (
        String,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        bool,
        Option<String>,
        Option<String>,
    );
    let rows: Vec<Row> = {
        let mut stmt = conn.prepare(
            "SELECT p.id, p.parent_id, p.database_id, p.kind, d.id, d.role, p.favorite, p.icon, p.cover
             FROM pages p LEFT JOIN databases d ON d.page_id = p.id
             ORDER BY p.created_at, p.rowid",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    rows.into_iter()
        .map(|(id, parent_id, database_id, kind, own_database_id, role, favorite, icon, cover)| {
            let title = derive_page_title(conn, &id)?;
            Ok(PageSummary {
                id,
                title,
                parent_id,
                database_id,
                kind,
                own_database_id,
                role,
                favorite,
                icon,
                cover,
            })
        })
        .collect()
}

/// The covers a page can have: one of Notion's colours, the palette of a season, or an uploaded image.
const COVER_SEASONS: [&str; 9] = ["spring", "summer", "summerSun", "autumn", "winter", "christmas", "halloween", "easter", "anniversary"];

fn valid_cover(cover: &str) -> bool {
    match cover.split_once(':') {
        Some(("color", name)) => crate::databases::COLORS.contains(&name) && name != "default",
        Some(("season", name)) => COVER_SEASONS.contains(&name),
        Some(("image", file)) => crate::attachments::valid_attachment_name(file),
        _ => false,
    }
}

/// Sets (or, with `None`, clears) the icon of a page. The same rules as a column's icon.
pub fn set_page_icon(conn: &Connection, page_id: &str, icon: Option<&str>) -> Result<(), String> {
    let icon = crate::databases::check_icon(icon)?;
    let changed = conn
        .execute("UPDATE pages SET icon = ?1 WHERE id = ?2", rusqlite::params![icon, page_id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("La página no existe".to_string());
    }
    Ok(())
}

/// Sets (or clears) the cover of a page; an image must be a well-formed attachment name (the file is the one the
/// editor stored, and the start-up sweep keeps it while a page uses it).
pub fn set_page_cover(conn: &Connection, page_id: &str, cover: Option<&str>) -> Result<(), String> {
    let cover = cover.map(str::trim).filter(|c| !c.is_empty());
    if let Some(c) = cover {
        if !valid_cover(c) {
            return Err("Portada no válida".to_string());
        }
    }
    let changed = conn
        .execute("UPDATE pages SET cover = ?1 WHERE id = ?2", rusqlite::params![cover, page_id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("La página no existe".to_string());
    }
    Ok(())
}

pub fn set_page_favorite(conn: &Connection, page_id: &str, favorite: bool) -> Result<(), String> {
    let changed = conn
        .execute("UPDATE pages SET favorite = ?1 WHERE id = ?2", (favorite, page_id))
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("La página no existe".to_string());
    }
    Ok(())
}

/// The words of a doc: text nodes joined inside a block, blocks apart.
fn collect_words_text(node: &Value, out: &mut String) {
    if let Some(text) = node.get("text").and_then(|t| t.as_str()) {
        out.push_str(text);
        return;
    }
    if let Some(children) = node.get("content").and_then(|c| c.as_array()) {
        for child in children {
            collect_words_text(child, out);
        }
    }
    out.push(' ');
}

pub fn page_info(conn: &Connection, page_id: &str) -> Result<PageInfo, String> {
    let (updated_at, content): (String, String) = conn
        .query_row(
            "SELECT updated_at, content FROM blocks WHERE page_id = ?1 AND parent_id IS NULL AND type = 'doc' LIMIT 1",
            [page_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("La página no existe")?;
    let mut text = String::new();
    if let Ok(doc) = serde_json::from_str::<Value>(&content) {
        collect_words_text(&doc, &mut text);
    }
    Ok(PageInfo {
        updated_at,
        words: text.split_whitespace().count(),
    })
}

/// Creates a page whose first block is an empty heading acting as its title.
/// `parent_id` nests it under another page (the "Página" block); `None` is a top-level page.
pub fn create_page(conn: &Connection, parent_id: Option<&str>) -> rusqlite::Result<PageSummary> {
    // A database page's children are its rows (`create_row`), never plain pages, and its editor is
    // title-only so the interface cannot ask for this. A direct call used to be accepted.
    if let Some(parent) = parent_id {
        let kind: Option<String> = conn.query_row("SELECT kind FROM pages WHERE id = ?1", [parent], |r| r.get(0)).optional()?;
        if kind.as_deref() == Some("database") {
            return Err(rusqlite::Error::ToSqlConversionFailure("A database page cannot hold plain pages".into()));
        }
    }
    insert_page(conn, parent_id, None, "page")
}

/// Shared by `create_page`, database rows (`database_id` set) and database
/// pages (`kind` = "database", titled doc only).
pub(crate) fn insert_page(conn: &Connection, parent_id: Option<&str>, database_id: Option<&str>, kind: &str) -> rusqlite::Result<PageSummary> {
    let page_id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO pages (id, parent_id, database_id, kind) VALUES (?1, ?2, ?3, ?4)",
        (&page_id, parent_id, database_id, kind),
    )?;

    let doc = if kind == "database" {
        database_page_doc("")
    } else {
        json!({ "type": "doc", "content": [heading_node(""), { "type": "paragraph" }] })
    };
    let content_str = serde_json::to_string(&doc).expect("Value serialization cannot fail");
    let block_id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO blocks (id, page_id, type, content) VALUES (?1, ?2, 'doc', ?3)",
        (&block_id, &page_id, &content_str),
    )?;

    Ok(PageSummary {
        id: page_id,
        title: "Sin título".to_string(),
        parent_id: parent_id.map(str::to_string),
        database_id: database_id.map(str::to_string),
        kind: kind.to_string(),
        own_database_id: None,
        role: None,
        favorite: false,
        icon: None,
        cover: None,
    })
}

const MAX_TITLE: usize = 200;

/// Renames a database *row* from the table: rewrites the first heading of its
/// document (the title is derived from it, nowhere else). Only rows — any other
/// page's title is edited in its own editor. A pending autosave of that row's
/// open editor would overwrite this, so the table is meant for rows whose own
/// page is not open.
pub fn set_row_title(conn: &Connection, page_id: &str, title: &str) -> Result<(), String> {
    let is_row: Option<bool> = conn
        .query_row("SELECT database_id IS NOT NULL FROM pages WHERE id = ?1", [page_id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if is_row != Some(true) {
        return Err("La página no es una fila de una base de datos".to_string());
    }
    rename_page(conn, page_id, title)
}

/// Renames any page that is not open in an editor (the sidebar's rename goes through the open editor
/// instead, whose autosave would otherwise overwrite this): rewrites the first heading of its document.
pub fn rename_page(conn: &Connection, page_id: &str, title: &str) -> Result<(), String> {
    let title = title.trim();
    if title.chars().count() > MAX_TITLE {
        return Err(format!("El título no puede pasar de {MAX_TITLE} caracteres"));
    }
    let (block_id, content): (String, String) = conn
        .query_row(
            "SELECT id, content FROM blocks WHERE page_id = ?1 AND parent_id IS NULL AND type = 'doc' LIMIT 1",
            [page_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let mut doc = editable_doc(&content);
    let blocks = doc["content"].as_array_mut().expect("just ensured this is an array");
    let first_is_heading = blocks.first().and_then(|n| n.get("type")).and_then(Value::as_str) == Some("heading");
    if first_is_heading {
        blocks[0] = heading_node(title);
    } else {
        blocks.insert(0, heading_node(title));
    }
    conn.execute("UPDATE blocks SET content = ?1, updated_at = datetime('now') WHERE id = ?2", (doc.to_string(), &block_id))
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_page(conn: &Connection, page_id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM pages WHERE id = ?1", [page_id])?;
    Ok(())
}

pub fn get_page_content(conn: &Connection, page_id: &str) -> rusqlite::Result<Option<Value>> {
    let content: Option<String> = conn
        .query_row(
            "SELECT content FROM blocks WHERE page_id = ?1 AND parent_id IS NULL AND type = 'doc' LIMIT 1",
            [page_id],
            |row| row.get(0),
        )
        .optional()?;

    Ok(content.and_then(|c| serde_json::from_str(&c).ok()))
}

/// Recognizes real calendar dates only (rejects e.g. 2026-02-30) — the
/// `date` input widget already keeps the UI from producing anything else,
/// but the JSON reaches this command as a plain string, so it's re-checked
/// here rather than trusted.
pub(crate) fn is_valid_iso_date(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    let [y_str, m_str, d_str] = parts[..] else { return false };
    if y_str.len() != 4 || m_str.len() != 2 || d_str.len() != 2 {
        return false;
    }
    let (Ok(y), Ok(m), Ok(d)) = (y_str.parse::<u32>(), m_str.parse::<u32>(), d_str.parse::<u32>()) else {
        return false;
    };
    if !(1..=12).contains(&m) || d < 1 {
        return false;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days_in_month = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        _ => unreachable!("m is already checked to be 1..=12"),
    };
    d <= days_in_month
}

/// Walks the doc depth-first rejecting any `dateMention` node whose `date`
/// attr isn't null or a valid ISO 8601 calendar date.
fn validate_dates(node: &Value) -> Result<(), String> {
    if node.get("type").and_then(|t| t.as_str()) == Some("dateMention") {
        if let Some(date) = node.get("attrs").and_then(|a| a.get("date")) {
            if !date.is_null() {
                let s = date.as_str().ok_or("dateMention.date must be a string or null")?;
                if !is_valid_iso_date(s) {
                    return Err(format!("Invalid dateMention date: {}", s));
                }
            }
        }
    }
    if let Some(children) = node.get("content").and_then(|c| c.as_array()) {
        for child in children {
            validate_dates(child)?;
        }
    }
    Ok(())
}

/// A page's whole document. Generous (a page of drawings holds up to ~1.2 MB per canvas, and the
/// importer already refuses 4 MB of text), but bounded: every save also reindexes the page, so an
/// unbounded document would make each autosave slower and the database grow without limit.
const MAX_PAGE_BYTES: usize = 16 * 1024 * 1024;

pub fn save_page_content(conn: &Connection, page_id: &str, content: &Value) -> Result<(), String> {
    let content_str = serde_json::to_string(content).expect("Value serialization cannot fail");
    if content_str.len() > MAX_PAGE_BYTES {
        return Err("La página es demasiado grande".to_string());
    }
    validate::validate_doc(content)?;
    validate_dates(content)?;
    crate::attachments::validate_refs(content)?;
    validate::validate_blocks(content, false)?;

    let kind: Option<String> = conn
        .query_row("SELECT kind FROM pages WHERE id = ?1", [page_id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if kind.as_deref() == Some("database") {
        validate::check_database_page_doc(content)?;
    }

    let existing_block_id: Option<String> = conn
        .query_row(
            "SELECT id FROM blocks WHERE page_id = ?1 AND parent_id IS NULL AND type = 'doc' LIMIT 1",
            [page_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    match existing_block_id {
        Some(block_id) => {
            conn.execute("UPDATE blocks SET content = ?1, updated_at = datetime('now') WHERE id = ?2", (&content_str, &block_id))
                .map_err(|e| e.to_string())?;
        }
        None => {
            let id = Uuid::new_v4().to_string();
            conn.execute("INSERT INTO blocks (id, page_id, type, content) VALUES (?1, ?2, 'doc', ?3)", (&id, page_id, &content_str))
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// A synced block's document is stored once and referenced by id from any
/// number of pages, so cap it like a page rather than trusting the client.
const MAX_SYNCED_BYTES: usize = 1_000_000;

pub fn get_synced_block(conn: &Connection, id: &str) -> Result<Option<Value>, String> {
    if !validate::is_uuid(id) {
        return Err("Invalid synced block id".to_string());
    }
    let content: Option<String> = conn
        .query_row("SELECT content FROM synced_blocks WHERE id = ?1", [id], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(content.and_then(|c| serde_json::from_str(&c).ok()))
}

/// Upserts: a reference whose row doesn't exist yet (just inserted, or pasted
/// from elsewhere) is created on its first edit, so no reference can dangle.
pub fn save_synced_block(conn: &Connection, id: &str, content: &Value) -> Result<(), String> {
    if !validate::is_uuid(id) {
        return Err("Invalid synced block id".to_string());
    }
    if content.get("type").and_then(Value::as_str) != Some("doc") {
        return Err("A synced block must be saved as a doc".to_string());
    }
    validate_dates(content)?;
    validate::validate_doc(content)?;
    crate::attachments::validate_refs(content)?;
    validate::validate_blocks(content, true)?;

    let content_str = serde_json::to_string(content).expect("Value serialization cannot fail");
    if content_str.len() > MAX_SYNCED_BYTES {
        return Err("El bloque sincronizado es demasiado grande".to_string());
    }
    conn.execute(
        "INSERT INTO synced_blocks (id, content) VALUES (?1, ?2)
         ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = datetime('now')",
        (id, &content_str),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Deletes the blocks whose page no longer exists. An old phase deleted pages with foreign keys off
/// and left their content behind: text of notes the user had deleted, with nothing in the app to
/// show it or remove it. It runs first at startup: those blocks would otherwise keep the attachments
/// and synced blocks they name "in use" for ever.
pub fn sweep_orphan_blocks(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM blocks WHERE NOT EXISTS (SELECT 1 FROM pages WHERE pages.id = blocks.page_id)", [])
}

/// Deletes synced-block rows no page references any more (every instance
/// removed, or its pages deleted). Startup-only for the same reason as the
/// attachment sweep: Undo can bring an instance back, and a just-inserted one
/// isn't saved into its page yet. Bails out without deleting anything if a
/// page doc can't be parsed — an unreadable doc might be hiding a reference.
pub fn sweep_synced_blocks(conn: &Connection) -> rusqlite::Result<usize> {
    let docs: Vec<String> = {
        let mut stmt = conn.prepare("SELECT content FROM blocks WHERE type = 'doc'")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut referenced = HashSet::new();
    for doc in &docs {
        let Ok(doc) = serde_json::from_str::<Value>(doc) else { return Ok(0) };
        validate::collect_ids(&doc, "syncedBlock", "syncId", &mut referenced);
    }

    let ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM synced_blocks")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut removed = 0;
    for id in ids.iter().filter(|id| !referenced.contains(*id)) {
        removed += conn.execute("DELETE FROM synced_blocks WHERE id = ?1", [id])?;
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    fn doc_of(bytes: usize) -> Value {
        json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "x".repeat(bytes) }] }] })
    }

    #[test]
    fn only_documents_are_saved_as_pages_and_plain_pages_do_not_hang_from_databases() {
        let conn = conn();
        let page = create_page(&conn, None).unwrap();
        for bad in [
            json!(true),
            json!(["a", "b"]),
            json!({ "options": ["a"] }),
            json!(null),
            json!({ "type": "paragraph" }),
            json!({ "type": "doc", "content": "x" }),
        ] {
            assert!(save_page_content(&conn, &page.id, &bad).is_err(), "{bad}");
            assert!(save_synced_block(&conn, &Uuid::new_v4().to_string(), &bad).is_err(), "{bad}");
        }
        save_page_content(&conn, &page.id, &json!({ "type": "doc" })).unwrap();
        save_page_content(&conn, &page.id, &json!({ "type": "doc", "content": [] })).unwrap();

        let database = crate::databases::create_database_page(&conn).unwrap();
        assert!(create_page(&conn, Some(&database.id)).is_err());
        assert!(create_page(&conn, Some(&page.id)).is_ok(), "sub-pages of a plain page stay possible");
    }

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("albaro-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn file_contains(path: &Path, needle: &str) -> bool {
        fs::read(path).unwrap().windows(needle.len()).any(|window| window == needle.as_bytes())
    }

    fn doc_with(text: &str) -> Value {
        json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": text }] }] })
    }

    const SECRET: &str = "ZEBRA-SECRETO-7731";

    /// The negative control matters: without the setting the text IS still in the file, so this
    /// test would notice if the file stopped being the place to look.
    #[test]
    fn deleted_and_replaced_text_does_not_stay_in_the_file() {
        for hardened in [false, true] {
            let dir = scratch_dir("delete");
            let path = dir.join("albaro-notes.sqlite");
            let conn = Connection::open(&path).unwrap();
            if hardened {
                harden(&conn).unwrap();
            } else {
                conn.pragma_update(None, "foreign_keys", true).unwrap();
            }
            run_migrations(&conn).unwrap();
            let kept = create_page(&conn, None).unwrap();
            let doomed = create_page(&conn, None).unwrap();
            save_page_content(&conn, &doomed.id, &doc_with(&format!("{SECRET} de una página borrada"))).unwrap();
            save_page_content(&conn, &kept.id, &doc_with(&format!("{SECRET} de un texto editado"))).unwrap();
            save_page_content(&conn, &kept.id, &doc_with("otra cosa")).unwrap(); // the text goes away with an edit...
            delete_page(&conn, &doomed.id).unwrap(); // ...and the other with its page
            drop(conn);
            assert_eq!(file_contains(&path, SECRET), !hardened, "hardened = {hardened}");
            fs::remove_dir_all(&dir).unwrap();
        }
    }

    #[test]
    fn databases_from_before_the_hardening_are_cleaned_once() {
        let dir = scratch_dir("vacuum");
        let path = dir.join("albaro-notes.sqlite");
        {
            // a database as the previous version left it: schema 20, no secure_delete
            let conn = Connection::open(&path).unwrap();
            conn.pragma_update(None, "foreign_keys", true).unwrap();
            run_migrations_up_to(&conn, 20).unwrap();
            let kept = create_page(&conn, None).unwrap();
            let doomed = create_page(&conn, None).unwrap();
            save_page_content(&conn, &doomed.id, &doc_with(&format!("{SECRET} de una página borrada"))).unwrap();
            save_page_content(&conn, &kept.id, &doc_with("lo que queda")).unwrap();
            delete_page(&conn, &doomed.id).unwrap();
        }
        assert!(file_contains(&path, SECRET), "the old settings left it behind");

        let conn = init(&dir).unwrap();
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, 23);
        let secure: i64 = conn.query_row("PRAGMA secure_delete", [], |r| r.get(0)).unwrap();
        assert_eq!(secure, 1, "secure_delete is on for the app's own connection");
        drop(conn);
        assert!(!file_contains(&path, SECRET), "the first start with the new version cleans the free space");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn migration_23_adds_the_trash_and_leaves_the_pages_as_they_were() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        run_migrations_up_to(&conn, 22).unwrap();
        let page = create_page(&conn, None).unwrap();
        save_page_content(&conn, &page.id, &doc_with("lo que había")).unwrap();
        let state = |conn: &Connection| -> (i64, String) {
            let pages = conn.query_row("SELECT COUNT(*) FROM pages", [], |r| r.get(0)).unwrap();
            (pages, conn.query_row("SELECT content FROM blocks WHERE page_id = ?1", [&page.id], |r| r.get(0)).unwrap())
        };
        let before = state(&conn);

        run_migrations(&conn).unwrap();
        assert_eq!(state(&conn), before, "nothing of the pages changed");
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, 23);
        let trashed: i64 = conn.query_row("SELECT COUNT(*) FROM trash", [], |r| r.get(0)).unwrap();
        assert_eq!(trashed, 0);
        run_migrations(&conn).unwrap(); // a second run does nothing
    }

    #[test]
    fn the_content_of_pages_that_no_longer_exist_is_swept() {
        let dir = scratch_dir("orphans");
        let path = dir.join("albaro-notes.sqlite");
        let conn = init(&dir).unwrap();
        let page = create_page(&conn, None).unwrap();
        save_page_content(&conn, &page.id, &doc_with("lo que se queda")).unwrap();
        // what an old phase left: a block whose page was deleted with foreign keys off
        conn.pragma_update(None, "foreign_keys", false).unwrap();
        conn.execute(
            "INSERT INTO blocks (id, page_id, type, content) VALUES ('ghost-block', 'page-that-is-gone', 'doc', ?1)",
            [doc_with(&format!("{SECRET} de una página borrada hace tiempo")).to_string()],
        )
        .unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        let count = |conn: &Connection| conn.query_row("SELECT COUNT(*) FROM blocks", [], |r| r.get::<_, i64>(0)).unwrap();
        let before = count(&conn);

        assert_eq!(sweep_orphan_blocks(&conn).unwrap(), 1);
        assert_eq!(count(&conn), before - 1);
        assert_eq!(sweep_orphan_blocks(&conn).unwrap(), 0, "a second time finds nothing");
        assert!(get_page_content(&conn, &page.id).unwrap().is_some(), "the page that exists keeps its content");
        drop(conn);
        assert!(!file_contains(&path, SECRET), "the text of the deleted page is still in the file");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_row_title_can_be_set_whatever_is_stored_as_its_document() {
        let conn = conn();
        let task = crate::tasks::add_task(&conn, "Tarea").unwrap();
        // what older versions accepted as a page, and damaged text: none of it may panic (a panic aborts the app)
        for stored in [
            "true",
            "false",
            "null",
            "\"texto\"",
            "[1, 2]",
            "42",
            "{\"type\":\"doc\",\"content\":\"x\"}",
            "{\"options\":[\"a\"]}",
            "no es json",
            "",
        ] {
            conn.execute("UPDATE blocks SET content = ?1 WHERE page_id = ?2", (stored, &task.id)).unwrap();
            set_row_title(&conn, &task.id, "Nuevo título").unwrap_or_else(|e| panic!("{stored:?}: {e}"));
            assert_eq!(derive_page_title(&conn, &task.id).unwrap(), "Nuevo título", "{stored:?}");
        }
    }

    #[test]
    fn any_page_can_be_renamed_and_keeps_its_body() {
        let conn = conn();
        let parent = create_page(&conn, None).unwrap();
        let child = create_page(&conn, Some(&parent.id)).unwrap();
        save_page_content(
            &conn,
            &child.id,
            &serde_json::json!({"type":"doc","content":[
                {"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Viejo"}]},
                {"type":"paragraph","content":[{"type":"text","text":"cuerpo"}]}]}),
        )
        .unwrap();
        rename_page(&conn, &child.id, "  Nuevo  ").unwrap();
        assert_eq!(derive_page_title(&conn, &child.id).unwrap(), "Nuevo");
        let doc = get_page_content(&conn, &child.id).unwrap().unwrap();
        assert_eq!(doc["content"].as_array().unwrap().len(), 2, "the body stays");
        assert!(rename_page(&conn, &child.id, &"x".repeat(MAX_TITLE + 1)).is_err());
        assert!(rename_page(&conn, "no-existe", "x").is_err());
    }

    #[test]
    fn a_page_document_has_a_size_limit() {
        let conn = conn();
        let page = create_page(&conn, None).unwrap();
        save_page_content(&conn, &page.id, &doc_of(MAX_PAGE_BYTES / 2)).unwrap();
        assert!(save_page_content(&conn, &page.id, &doc_of(MAX_PAGE_BYTES)).is_err());
        // the refused save left the previous document in place
        let kept = get_page_content(&conn, &page.id).unwrap().unwrap();
        assert!(kept.to_string().len() < MAX_PAGE_BYTES);
        assert!(kept.to_string().len() > MAX_PAGE_BYTES / 2);
    }
}
