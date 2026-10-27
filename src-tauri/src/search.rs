//! full-text search over pages (title + text), on the FTS5 index the
//! triggers in `db.rs` keep up to date (`V9_SEARCH`). Results come ranked, with the
//! matches marked so the client can highlight them without ever rendering HTML.

use crate::db::derive_page_title;
use rusqlite::{params, Connection};
use serde::Serialize;

/// Wrap a match in the title/snippet: private-use characters that can't appear in
/// typed text, so the client splits on them and renders the pieces as plain text.
pub const MARK_START: &str = "\u{E000}";
pub const MARK_END: &str = "\u{E001}";

const MAX_RESULTS: i64 = 20;
const MAX_QUERY: usize = 200;
const MAX_TERMS: usize = 10;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: String,
    /// The page title, matches wrapped in MARK_START / MARK_END ("Sin título" if it has none).
    pub title: String,
    /// A stretch of the page's text around the best match (marked the same way); may be empty.
    pub snippet: String,
    /// "page" or "database".
    pub kind: String,
    /// A row of a database (opens as a page, shown under its database).
    pub is_row: bool,
    /// Titles of the ancestors, root first: where the page lives.
    pub path: Vec<String>,
}

/// The user's text as an FTS5 query. Never passed through raw: each word becomes a quoted
/// literal (quotes doubled) with a prefix star — «desp» finds «Desplegar» — and all words must
/// match. FTS5 operators typed by the user (AND, OR, NEAR, *, ^, :, parentheses) are just text.
fn to_match_query(query: &str) -> Option<String> {
    let terms: Vec<String> = query.split_whitespace().take(MAX_TERMS).map(|t| format!("\"{}\"*", t.replace('"', "\"\""))).collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

pub(crate) fn ancestors(conn: &Connection, parent: Option<String>) -> rusqlite::Result<Vec<String>> {
    let mut path = Vec::new();
    let mut current = parent;
    while let Some(id) = current {
        path.push(derive_page_title(conn, &id)?);
        current = conn.query_row("SELECT parent_id FROM pages WHERE id = ?1", [&id], |r| r.get::<_, Option<String>>(0))?;
        if path.len() > 20 {
            break; // a parent cycle can't happen, but never loop forever
        }
    }
    path.reverse();
    Ok(path)
}

/// Pages matching `query` — in the title, the text or (rows) a cell — best first: a title match
/// weighs ten times one in the text, a cell twice.
/// An empty query lists the most recently edited pages, like Notion's search opens with.
pub fn search_pages(conn: &Connection, query: &str) -> Result<Vec<SearchResult>, String> {
    let query: String = query.chars().take(MAX_QUERY).collect();
    type Hit = (String, String, String, String, Option<String>, Option<String>);
    let hits: Vec<Hit> = match to_match_query(&query) {
        Some(fts) => {
            let mut stmt = conn
                .prepare(
                    "SELECT page_search.page_id,
                            highlight(page_search, 1, ?2, ?3),
                            snippet(page_search, 2, ?2, ?3, '…', 16),
                            snippet(page_search, 3, ?2, ?3, '…', 16),
                            p.kind, p.database_id, p.parent_id
                     FROM page_search JOIN pages p ON p.id = page_search.page_id
                     WHERE page_search MATCH ?1
                     ORDER BY bm25(page_search, 0.0, 10.0, 1.0, 2.0)
                     LIMIT ?4",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![fts, MARK_START, MARK_END, MAX_RESULTS], |r| {
                    // show the text around the match: the page's body, or its cells if that's where it is
                    let (body, props): (String, String) = (r.get(2)?, r.get(3)?);
                    let snippet = if !body.contains(MARK_START) && props.contains(MARK_START) { props } else { body };
                    Ok((r.get(0)?, r.get(1)?, snippet, r.get(4)?, r.get(5)?, r.get(6)?))
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())?
        }
        None => {
            let mut stmt = conn
                .prepare(
                    "SELECT p.id, '', '', p.kind, p.database_id, p.parent_id
                     FROM pages p JOIN blocks b ON b.page_id = p.id AND b.type = 'doc' AND b.parent_id IS NULL
                     ORDER BY b.updated_at DESC, b.rowid DESC
                     LIMIT ?1",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([MAX_RESULTS], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))
                .map_err(|e| e.to_string())?;
            rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())?
        }
    };

    hits.into_iter()
        .map(|(id, title, snippet, kind, database_id, parent_id)| {
            let title = if title.trim().is_empty() {
                derive_page_title(conn, &id).map_err(|e| e.to_string())?
            } else {
                title
            };
            Ok(SearchResult {
                path: ancestors(conn, parent_id).map_err(|e| e.to_string())?,
                id,
                title,
                snippet,
                kind,
                is_row: database_id.is_some(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{databases, db};
    use serde_json::json;

    fn doc(title: &str, body: &[&str]) -> serde_json::Value {
        let mut content = vec![json!({ "type": "heading", "attrs": { "level": 1 }, "content": [{ "type": "text", "text": title }] })];
        for text in body {
            content.push(json!({ "type": "paragraph", "content": [{ "type": "text", "text": text }] }));
        }
        json!({ "type": "doc", "content": content })
    }

    fn page(conn: &Connection, title: &str, body: &[&str]) -> String {
        let id = db::create_page(conn, None).unwrap().id;
        db::save_page_content(conn, &id, &doc(title, body)).unwrap();
        id
    }

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        db::run_migrations(&conn).unwrap();
        conn
    }

    fn ids(conn: &Connection, q: &str) -> Vec<String> {
        search_pages(conn, q).unwrap().into_iter().map(|r| r.id).collect()
    }

    #[test]
    fn finds_by_prefix_and_without_accents_title_first() {
        let conn = fixture();
        let body_hit = page(&conn, "Notas", &["Hay que desplegar el viernes"]);
        let title_hit = page(&conn, "Desplegar la versión", &["nada más"]);
        let other = page(&conn, "Recetas", &["Tortilla de patatas"]);
        assert_eq!(ids(&conn, "desp"), [title_hit.clone(), body_hit]); // title outranks body
        assert_eq!(ids(&conn, "version"), [title_hit.as_str()]); // «versión» without its accent
        assert_eq!(ids(&conn, "TORTILLA patat"), [other]); // every word, any case
        assert!(ids(&conn, "tortilla viernes").is_empty());

        let hit = &search_pages(&conn, "patatas").unwrap()[0];
        assert_eq!(hit.title, "Recetas");
        assert_eq!(hit.snippet, format!("Tortilla de {MARK_START}patatas{MARK_END}"));
        let hit = &search_pages(&conn, "desplegar").unwrap()[0];
        assert_eq!(hit.title, format!("{MARK_START}Desplegar{MARK_END} la versión"));
    }

    #[test]
    fn the_index_follows_every_write() {
        let conn = fixture();
        let id = page(&conn, "Borrador", &["texto viejo"]);
        db::save_page_content(&conn, &id, &doc("Borrador", &["texto nuevo"])).unwrap();
        assert!(ids(&conn, "viejo").is_empty());
        assert_eq!(ids(&conn, "nuevo"), [id.as_str()]);

        // a database row renamed from its table, then the database deleted with its rows (cascade)
        let db_page = databases::create_database_page(&conn).unwrap();
        let row = databases::create_row(&conn, db_page.own_database_id.as_deref().unwrap()).unwrap().id;
        db::set_row_title(&conn, &row, "Fila buscable").unwrap();
        let hit = search_pages(&conn, "buscable").unwrap();
        assert_eq!(hit[0].id, row);
        assert!(hit[0].is_row);
        assert_eq!(hit[0].path, ["Sin título"]); // under its (untitled) database
        db::delete_page(&conn, &db_page.id).unwrap();
        assert!(ids(&conn, "buscable").is_empty());
        let indexed: i64 = conn.query_row("SELECT count(*) FROM page_search", [], |r| r.get(0)).unwrap();
        assert_eq!(indexed, 1); // only «Borrador» is left
    }

    #[test]
    fn rows_are_found_by_their_cells() {
        let conn = fixture();
        let db_page = databases::create_database_page(&conn).unwrap();
        let db_id = db_page.own_database_id.unwrap();
        let note = databases::add_property(&conn, &db_id, "Nota", "text", &json!({})).unwrap().id;
        let state = databases::add_property(&conn, &db_id, "Estado", "select", &json!({ "options": ["Pendiente"] })).unwrap().id;
        let place = databases::add_property(&conn, &db_id, "Dónde", "place", &json!({})).unwrap().id;
        let effort = databases::add_property(&conn, &db_id, "Esfuerzo", "number", &json!({})).unwrap().id;
        let row = databases::create_row(&conn, &db_id).unwrap().id;
        databases::set_value(&conn, &row, &note, &json!("llamar al fontanero")).unwrap();
        databases::set_value(&conn, &row, &state, &json!("Pendiente")).unwrap();
        databases::set_value(&conn, &row, &place, &json!({ "name": "Plaza Mayor", "lat": 40.4, "lng": -3.7 })).unwrap();
        databases::set_value(&conn, &row, &effort, &json!(21)).unwrap();

        let hit = &search_pages(&conn, "fontanero").unwrap()[0];
        assert_eq!(hit.id, row);
        // the cells read in column order, whole numbers without «.0»
        assert_eq!(hit.snippet, format!("llamar al {MARK_START}fontanero{MARK_END} · Pendiente · Plaza Mayor · 21"));
        assert_eq!(ids(&conn, "pendiente"), [row.as_str()]);
        assert_eq!(ids(&conn, "plaza mayor"), [row.as_str()]);
        assert!(ids(&conn, "40.4").is_empty()); // coordinates aren't text to search

        // every way a cell changes keeps the index right
        databases::set_value(&conn, &row, &note, &json!("llamar al electricista")).unwrap();
        assert!(ids(&conn, "fontanero").is_empty());
        databases::rename_select_option(&conn, &state, "Pendiente", "Hecho").unwrap();
        assert!(ids(&conn, "pendiente").is_empty());
        assert_eq!(ids(&conn, "hecho"), [row.as_str()]);
        databases::delete_property(&conn, &note).unwrap();
        assert!(ids(&conn, "electricista").is_empty());
        assert_eq!(ids(&conn, "hecho"), [row.as_str()]); // the rest of the row is still indexed
    }

    #[test]
    fn rows_are_found_by_their_tags() {
        let conn = fixture();
        let db_id = databases::create_database_page(&conn).unwrap().own_database_id.unwrap();
        let tags = databases::add_property(&conn, &db_id, "Categorías", "tags", &json!({ "options": ["Trabajo", "Casa"] }))
            .unwrap()
            .id;
        let row = databases::create_row(&conn, &db_id).unwrap().id;
        databases::set_value(&conn, &row, &tags, &json!(["Trabajo", "Casa"])).unwrap();
        assert_eq!(ids(&conn, "trabajo"), [row.as_str()]);
        assert_eq!(ids(&conn, "casa"), [row.as_str()]);
        assert_eq!(search_pages(&conn, "trabajo").unwrap()[0].snippet, format!("{MARK_START}Trabajo{MARK_END}, Casa"));
        databases::rename_select_option(&conn, &tags, "Trabajo", "Oficina").unwrap();
        assert!(ids(&conn, "trabajo").is_empty());
        assert_eq!(ids(&conn, "oficina"), [row.as_str()]);
        databases::set_value(&conn, &row, &tags, &json!([])).unwrap();
        assert!(ids(&conn, "oficina").is_empty());
    }

    #[test]
    fn typed_query_syntax_is_just_text() {
        let conn = fixture();
        let id = page(&conn, "Comillas", &["dijo \"hola\" AND (adiós) *fin* col:valor NEAR"]);
        for q in ["\"hola\"", "AND", "(adiós)", "*fin*", "col:valor", "NEAR(", "\"", "'", "^", "-"] {
            assert!(search_pages(&conn, q).is_ok(), "{q} must not be an error");
        }
        assert_eq!(ids(&conn, "\"hola\""), [id.as_str()]);
        assert_eq!(ids(&conn, "AND"), [id]);
    }

    #[test]
    fn an_empty_query_lists_recent_pages() {
        let conn = fixture();
        let a = page(&conn, "Primera", &[]);
        let b = page(&conn, "Segunda", &[]);
        conn.execute("UPDATE blocks SET updated_at = '2000-01-01' WHERE page_id = ?1", [&b]).unwrap();
        assert_eq!(ids(&conn, "   "), [a, b]);
    }

    #[test]
    fn existing_pages_are_indexed_by_the_migration() {
        let conn = Connection::open_in_memory().unwrap();
        db::run_migrations_up_to(&conn, 8).unwrap();
        let id = db::create_page(&conn, None).unwrap().id;
        db::save_page_content(&conn, &id, &doc("Anterior", &["al índice"])).unwrap();
        db::run_migrations(&conn).unwrap();
        assert_eq!(ids(&conn, "indice"), [id]);
    }
}
