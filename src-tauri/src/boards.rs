//! boards, as in Trello. A board has free lists (not the task's *Estado*) and its cards are
//! **references to tasks**, never copies: the same task can be on several boards (once per board), moving or
//! removing a card never touches the task, and deleting the task (or the list, or the board) deletes its cards.
//! Every rule is checked here, whoever asks; the page only draws what comes back.

use crate::db;
use crate::tasks;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;

const MAX_BOARDS: i64 = 50;
const MAX_LISTS: i64 = 50;
const MAX_CARDS: i64 = 500;
const MAX_NAME: usize = 100;
/// The lists a new board starts with (the user renames, adds or removes them).
const STARTING_LISTS: [&str; 3] = ["Por hacer", "En curso", "Hecho"];

fn sql<E: ToString>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoardInfo {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: String,
    pub task_id: String,
    /// The task's own title (a card has none).
    pub title: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BoardList {
    pub id: String,
    pub name: String,
    pub cards: Vec<Card>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BoardData {
    pub id: String,
    pub name: String,
    pub lists: Vec<BoardList>,
}

fn clean_name(name: &str, what: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(format!("{what} necesita un nombre"));
    }
    if name.chars().count() > MAX_NAME {
        return Err(format!("El nombre no puede pasar de {MAX_NAME} caracteres"));
    }
    Ok(name.to_string())
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn list_boards(conn: &Connection) -> Result<Vec<BoardInfo>, String> {
    let mut stmt = conn.prepare("SELECT id, name FROM boards ORDER BY created_at, rowid").map_err(sql)?;
    let rows = stmt.query_map([], |r| Ok(BoardInfo { id: r.get(0)?, name: r.get(1)? })).map_err(sql)?;
    rows.collect::<rusqlite::Result<_>>().map_err(sql)
}

fn board_name(conn: &Connection, id: &str) -> Result<String, String> {
    conn.query_row("SELECT name FROM boards WHERE id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(sql)?
        .ok_or_else(|| "El tablero no existe".to_string())
}

/// A board with its lists and cards, in order.
pub fn get_board(conn: &Connection, id: &str) -> Result<BoardData, String> {
    let name = board_name(conn, id)?;
    let lists: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT id, name FROM board_lists WHERE board_id = ?1 ORDER BY position, rowid").map_err(sql)?;
        let rows = stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(sql)?;
        rows.collect::<rusqlite::Result<_>>().map_err(sql)?
    };
    let mut out = Vec::new();
    for (list_id, list_name) in lists {
        let cards: Vec<(String, String)> = {
            let mut stmt = conn
                .prepare("SELECT id, task_id FROM board_cards WHERE list_id = ?1 ORDER BY position, rowid")
                .map_err(sql)?;
            let rows = stmt.query_map([&list_id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(sql)?;
            rows.collect::<rusqlite::Result<_>>().map_err(sql)?
        };
        let cards = cards
            .into_iter()
            .map(|(id, task_id)| {
                Ok(Card {
                    title: db::derive_page_title(conn, &task_id).map_err(sql)?,
                    id,
                    task_id,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        out.push(BoardList {
            id: list_id,
            name: list_name,
            cards,
        });
    }
    Ok(BoardData {
        id: id.to_string(),
        name,
        lists: out,
    })
}

fn count(conn: &Connection, query: &str, id: Option<&str>) -> Result<i64, String> {
    match id {
        Some(id) => conn.query_row(query, [id], |r| r.get(0)),
        None => conn.query_row(query, [], |r| r.get(0)),
    }
    .map_err(sql)
}

/// A new board with the three starting lists.
pub fn create_board(conn: &Connection, name: &str) -> Result<BoardData, String> {
    let name = clean_name(name, "El tablero")?;
    if count(conn, "SELECT COUNT(*) FROM boards", None)? >= MAX_BOARDS {
        return Err(format!("Hay como mucho {MAX_BOARDS} tableros"));
    }
    let id = new_id();
    let tx = conn.unchecked_transaction().map_err(sql)?;
    tx.execute("INSERT INTO boards (id, name) VALUES (?1, ?2)", [&id, &name]).map_err(sql)?;
    for (position, list) in STARTING_LISTS.iter().enumerate() {
        tx.execute(
            "INSERT INTO board_lists (id, board_id, name, position) VALUES (?1, ?2, ?3, ?4)",
            params![new_id(), id, list, position as i64],
        )
        .map_err(sql)?;
    }
    tx.commit().map_err(sql)?;
    get_board(conn, &id)
}

pub fn rename_board(conn: &Connection, id: &str, name: &str) -> Result<(), String> {
    let name = clean_name(name, "El tablero")?;
    let changed = conn.execute("UPDATE boards SET name = ?2 WHERE id = ?1", [id, &name]).map_err(sql)?;
    if changed == 0 {
        return Err("El tablero no existe".to_string());
    }
    Ok(())
}

/// Deletes the board with its lists and cards (the tasks stay).
pub fn delete_board(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM boards WHERE id = ?1", [id]).map_err(sql)?;
    Ok(())
}

pub fn add_list(conn: &Connection, board_id: &str, name: &str) -> Result<BoardList, String> {
    let name = clean_name(name, "La lista")?;
    board_name(conn, board_id)?; // exists
    if count(conn, "SELECT COUNT(*) FROM board_lists WHERE board_id = ?1", Some(board_id))? >= MAX_LISTS {
        return Err(format!("Un tablero admite como mucho {MAX_LISTS} listas"));
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO board_lists (id, board_id, name, position) VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(position), -1) + 1 FROM board_lists WHERE board_id = ?2))",
        [&id, board_id, &name],
    )
    .map_err(sql)?;
    Ok(BoardList { id, name, cards: Vec::new() })
}

pub fn rename_list(conn: &Connection, id: &str, name: &str) -> Result<(), String> {
    let name = clean_name(name, "La lista")?;
    let changed = conn.execute("UPDATE board_lists SET name = ?2 WHERE id = ?1", [id, &name]).map_err(sql)?;
    if changed == 0 {
        return Err("La lista no existe".to_string());
    }
    Ok(())
}

/// Deletes the list with its cards (the tasks stay).
pub fn delete_list(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM board_lists WHERE id = ?1", [id]).map_err(sql)?;
    Ok(())
}

/// Puts `id` at `index` among `ids` (the others in their order) and writes the order back.
fn reorder(tx: &Transaction, table: &str, ids: &mut Vec<String>, id: &str, index: usize) -> Result<(), String> {
    ids.retain(|x| x != id);
    ids.insert(index.min(ids.len()), id.to_string());
    for (position, id) in ids.iter().enumerate() {
        tx.execute(&format!("UPDATE {table} SET position = ?2 WHERE id = ?1"), params![id, position as i64])
            .map_err(sql)?;
    }
    Ok(())
}

fn ids_of(tx: &Transaction, query: &str, id: &str) -> Result<Vec<String>, String> {
    let mut stmt = tx.prepare(query).map_err(sql)?;
    let rows = stmt.query_map([id], |r| r.get(0)).map_err(sql)?;
    rows.collect::<rusqlite::Result<_>>().map_err(sql)
}

/// Moves a list to `index` among the lists of its board.
pub fn move_list(conn: &Connection, id: &str, index: usize) -> Result<(), String> {
    let board: String = conn
        .query_row("SELECT board_id FROM board_lists WHERE id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(sql)?
        .ok_or("La lista no existe")?;
    let tx = conn.unchecked_transaction().map_err(sql)?;
    let mut ids = ids_of(&tx, "SELECT id FROM board_lists WHERE board_id = ?1 ORDER BY position, rowid", &board)?;
    reorder(&tx, "board_lists", &mut ids, id, index)?;
    tx.commit().map_err(sql)
}

fn card_title(conn: &Connection, id: &str, task_id: String) -> Result<Card, String> {
    Ok(Card {
        title: db::derive_page_title(conn, &task_id).map_err(sql)?,
        id: id.to_string(),
        task_id,
    })
}

/// Puts a card in `list_id` at `index` (a card is moved only inside its own board), renumbering both lists.
fn place_card(tx: &Transaction, card_id: &str, list_id: &str, index: usize) -> Result<(), String> {
    let (board, from): (String, String) = tx
        .query_row("SELECT board_id, list_id FROM board_cards WHERE id = ?1", [card_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(sql)?
        .ok_or("La tarjeta no existe")?;
    let target_board: String = tx
        .query_row("SELECT board_id FROM board_lists WHERE id = ?1", [list_id], |r| r.get(0))
        .optional()
        .map_err(sql)?
        .ok_or("La lista no existe")?;
    if target_board != board {
        return Err("Una tarjeta solo se mueve dentro de su tablero (arrastra la tarea para añadirla a otro)".to_string());
    }
    tx.execute("UPDATE board_cards SET list_id = ?2 WHERE id = ?1", [card_id, list_id]).map_err(sql)?;
    let mut ids = ids_of(tx, "SELECT id FROM board_cards WHERE list_id = ?1 ORDER BY position, rowid", list_id)?;
    reorder(tx, "board_cards", &mut ids, card_id, index)?;
    if from != list_id {
        let rest = ids_of(tx, "SELECT id FROM board_cards WHERE list_id = ?1 ORDER BY position, rowid", &from)?;
        for (position, id) in rest.iter().enumerate() {
            tx.execute("UPDATE board_cards SET position = ?2 WHERE id = ?1", params![id, position as i64])
                .map_err(sql)?;
        }
    }
    Ok(())
}

pub fn move_card(conn: &Connection, card_id: &str, list_id: &str, index: usize) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(sql)?;
    place_card(&tx, card_id, list_id, index)?;
    tx.commit().map_err(sql)
}

/// A card for an existing task in `list_id`, at `index` (the end if `None`). One card per task and board.
pub fn add_card(conn: &Connection, list_id: &str, task_id: &str, index: Option<usize>) -> Result<Card, String> {
    if !tasks::is_task(conn, task_id)? {
        return Err("Solo las tareas pueden estar en un tablero".to_string());
    }
    let board: String = conn
        .query_row("SELECT board_id FROM board_lists WHERE id = ?1", [list_id], |r| r.get(0))
        .optional()
        .map_err(sql)?
        .ok_or("La lista no existe")?;
    let already = conn
        .prepare("SELECT 1 FROM board_cards WHERE board_id = ?1 AND task_id = ?2")
        .and_then(|mut s| s.exists([&board, task_id]))
        .map_err(sql)?;
    if already {
        return Err("Esa tarea ya está en este tablero".to_string());
    }
    if count(conn, "SELECT COUNT(*) FROM board_cards WHERE board_id = ?1", Some(&board))? >= MAX_CARDS {
        return Err(format!("Un tablero admite como mucho {MAX_CARDS} tarjetas"));
    }
    let id = new_id();
    let tx = conn.unchecked_transaction().map_err(sql)?;
    tx.execute(
        "INSERT INTO board_cards (id, board_id, list_id, task_id, position) VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(position), -1) + 1 FROM board_cards WHERE list_id = ?3))",
        [&id, &board, list_id, task_id],
    )
    .map_err(sql)?;
    if let Some(index) = index {
        place_card(&tx, &id, list_id, index)?;
    }
    tx.commit().map_err(sql)?;
    card_title(conn, &id, task_id.to_string())
}

/// What `add_cards` did.
#[derive(Serialize, Debug, PartialEq)]
pub struct Added {
    pub added: usize,
    /// Tasks that already had a card on the board.
    pub skipped: usize,
}

/// A card for each of the tasks, at the end of the board's first list (a whole family at once). Tasks already on
/// the board are skipped; every id must be a task and the board must have room for all of them, or nothing is added.
pub fn add_cards(conn: &Connection, board_id: &str, task_ids: &[String]) -> Result<Added, String> {
    board_name(conn, board_id)?; // exists
    let first: String = conn
        .query_row("SELECT id FROM board_lists WHERE board_id = ?1 ORDER BY position, rowid LIMIT 1", [board_id], |r| r.get(0))
        .optional()
        .map_err(sql)?
        .ok_or("El tablero no tiene ninguna lista")?;
    let mut wanted: Vec<&String> = Vec::new();
    for id in task_ids {
        if !wanted.contains(&id) {
            wanted.push(id);
        }
    }
    if wanted.len() > MAX_CARDS as usize {
        return Err(format!("Un tablero admite como mucho {MAX_CARDS} tarjetas"));
    }
    let mut fresh = Vec::new();
    for id in &wanted {
        if !tasks::is_task(conn, id)? {
            return Err("Solo las tareas pueden estar en un tablero".to_string());
        }
        let on_board = conn
            .prepare("SELECT 1 FROM board_cards WHERE board_id = ?1 AND task_id = ?2")
            .and_then(|mut s| s.exists([board_id, id.as_str()]))
            .map_err(sql)?;
        if !on_board {
            fresh.push(id);
        }
    }
    if count(conn, "SELECT COUNT(*) FROM board_cards WHERE board_id = ?1", Some(board_id))? + fresh.len() as i64 > MAX_CARDS {
        return Err(format!("Un tablero admite como mucho {MAX_CARDS} tarjetas"));
    }
    for id in &fresh {
        add_card(conn, &first, id, None)?;
    }
    Ok(Added {
        added: fresh.len(),
        skipped: wanted.len() - fresh.len(),
    })
}

/// «Añadir una tarjeta» by typing: a new task and its card at the end of the list.
pub fn create_card(conn: &Connection, list_id: &str, title: &str) -> Result<Card, String> {
    let board: String = conn
        .query_row("SELECT board_id FROM board_lists WHERE id = ?1", [list_id], |r| r.get(0))
        .optional()
        .map_err(sql)?
        .ok_or("La lista no existe")?;
    if count(conn, "SELECT COUNT(*) FROM board_cards WHERE board_id = ?1", Some(&board))? >= MAX_CARDS {
        return Err(format!("Un tablero admite como mucho {MAX_CARDS} tarjetas"));
    }
    let task = tasks::add_task(conn, title)?;
    add_card(conn, list_id, &task.id, None)
}

/// Removes the card; the task is untouched.
pub fn remove_card(conn: &Connection, card_id: &str) -> Result<(), String> {
    let (list, _): (String, String) = match conn
        .query_row("SELECT list_id, task_id FROM board_cards WHERE id = ?1", [card_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(sql)?
    {
        Some(found) => found,
        None => return Ok(()),
    };
    let tx = conn.unchecked_transaction().map_err(sql)?;
    tx.execute("DELETE FROM board_cards WHERE id = ?1", [card_id]).map_err(sql)?;
    let ids = ids_of(&tx, "SELECT id FROM board_cards WHERE list_id = ?1 ORDER BY position, rowid", &list)?;
    for (position, id) in ids.iter().enumerate() {
        tx.execute("UPDATE board_cards SET position = ?2 WHERE id = ?1", params![id, position as i64])
            .map_err(sql)?;
    }
    tx.commit().map_err(sql)
}

/// The boards a task is on.
pub fn boards_of_task(conn: &Connection, task_id: &str) -> Result<Vec<BoardInfo>, String> {
    let mut stmt = conn
        .prepare("SELECT b.id, b.name FROM board_cards c JOIN boards b ON b.id = c.board_id WHERE c.task_id = ?1 ORDER BY b.created_at, b.rowid")
        .map_err(sql)?;
    let rows = stmt.query_map([task_id], |r| Ok(BoardInfo { id: r.get(0)?, name: r.get(1)? })).map_err(sql)?;
    rows.collect::<rusqlite::Result<_>>().map_err(sql)
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

    fn titles(board: &BoardData, list: usize) -> Vec<&str> {
        board.lists[list].cards.iter().map(|c| c.title.as_str()).collect()
    }

    #[test]
    fn a_new_board_has_three_lists_and_names_are_checked() {
        let conn = conn();
        let board = create_board(&conn, "  Proyecto  ").unwrap();
        assert_eq!(board.name, "Proyecto");
        assert_eq!(board.lists.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(), ["Por hacer", "En curso", "Hecho"]);
        assert!(create_board(&conn, "   ").is_err());
        assert!(create_board(&conn, &"x".repeat(101)).is_err());
        assert!(rename_board(&conn, &board.id, "").is_err());
        rename_board(&conn, &board.id, "Otro").unwrap();
        assert_eq!(
            list_boards(&conn).unwrap(),
            [BoardInfo {
                id: board.id.clone(),
                name: "Otro".to_string()
            }]
        );
        assert!(rename_board(&conn, "nope", "x").is_err());
        assert!(get_board(&conn, "nope").is_err());
    }

    #[test]
    fn cards_are_references_one_per_board_and_only_for_tasks() {
        let conn = conn();
        let (a, b) = (create_board(&conn, "A").unwrap(), create_board(&conn, "B").unwrap());
        let task = tasks::add_task(&conn, "Escribir ideas").unwrap();
        let card_a = add_card(&conn, &a.lists[0].id, &task.id, None).unwrap();
        assert_eq!(card_a.title, "Escribir ideas");
        // the same task on another board is another card; twice on one board is refused
        let card_b = add_card(&conn, &b.lists[1].id, &task.id, None).unwrap();
        assert_ne!(card_a.id, card_b.id);
        assert!(add_card(&conn, &a.lists[2].id, &task.id, None).unwrap_err().contains("ya está"));
        assert_eq!(boards_of_task(&conn, &task.id).unwrap().len(), 2);
        // a page that is not a task can't be on a board
        let page = db::create_page(&conn, None).unwrap();
        assert!(add_card(&conn, &a.lists[0].id, &page.id, None).is_err());
        assert!(add_card(&conn, "nope", &task.id, None).is_err());
        // the task's title is live
        db::set_row_title(&conn, &task.id, "Escribir más ideas").unwrap();
        assert_eq!(titles(&get_board(&conn, &a.id).unwrap(), 0), ["Escribir más ideas"]);
        // removing a card leaves the task and the other board's card
        remove_card(&conn, &card_a.id).unwrap();
        assert!(titles(&get_board(&conn, &a.id).unwrap(), 0).is_empty());
        assert_eq!(titles(&get_board(&conn, &b.id).unwrap(), 1), ["Escribir más ideas"]);
        assert!(tasks::is_task(&conn, &task.id).unwrap());
        remove_card(&conn, &card_a.id).unwrap(); // already gone: nothing to do
    }

    #[test]
    fn cards_move_and_reorder_inside_their_board_only() {
        let conn = conn();
        let (a, b) = (create_board(&conn, "A").unwrap(), create_board(&conn, "B").unwrap());
        let list = |i: usize| a.lists[i].id.clone();
        let cards: Vec<Card> = ["uno", "dos", "tres"].iter().map(|t| create_card(&conn, &list(0), t).unwrap()).collect();
        assert_eq!(titles(&get_board(&conn, &a.id).unwrap(), 0), ["uno", "dos", "tres"]);
        // to the front, to the end, past the end
        move_card(&conn, &cards[2].id, &list(0), 0).unwrap();
        assert_eq!(titles(&get_board(&conn, &a.id).unwrap(), 0), ["tres", "uno", "dos"]);
        move_card(&conn, &cards[2].id, &list(0), 99).unwrap();
        assert_eq!(titles(&get_board(&conn, &a.id).unwrap(), 0), ["uno", "dos", "tres"]);
        // to another list at an index
        move_card(&conn, &cards[1].id, &list(1), 0).unwrap();
        move_card(&conn, &cards[0].id, &list(1), 0).unwrap();
        let board = get_board(&conn, &a.id).unwrap();
        assert_eq!((titles(&board, 0), titles(&board, 1)), (vec!["tres"], vec!["uno", "dos"]));
        // positions stay a clean 0..n (the next card goes last)
        let next = create_card(&conn, &list(1), "cuatro").unwrap();
        assert_eq!(titles(&get_board(&conn, &a.id).unwrap(), 1), ["uno", "dos", "cuatro"]);
        // not to another board's list, not to a missing list or card
        assert!(move_card(&conn, &next.id, &b.lists[0].id, 0).unwrap_err().contains("su tablero"));
        assert!(move_card(&conn, &next.id, "nope", 0).is_err());
        assert!(move_card(&conn, "nope", &list(0), 0).is_err());
        // dropping a task at an index puts it there
        let extra = tasks::add_task(&conn, "cinco").unwrap();
        add_card(&conn, &list(1), &extra.id, Some(1)).unwrap();
        assert_eq!(titles(&get_board(&conn, &a.id).unwrap(), 1), ["uno", "cinco", "dos", "cuatro"]);
    }

    #[test]
    fn lists_are_added_renamed_reordered_and_deleted_with_their_cards() {
        let conn = conn();
        let board = create_board(&conn, "A").unwrap();
        let extra = add_list(&conn, &board.id, "Revisión").unwrap();
        assert!(add_list(&conn, &board.id, " ").is_err());
        assert!(add_list(&conn, "nope", "x").is_err());
        move_list(&conn, &extra.id, 0).unwrap();
        let names = |b: &BoardData| b.lists.iter().map(|l| l.name.clone()).collect::<Vec<_>>();
        assert_eq!(names(&get_board(&conn, &board.id).unwrap()), ["Revisión", "Por hacer", "En curso", "Hecho"]);
        rename_list(&conn, &extra.id, "QA").unwrap();
        assert!(rename_list(&conn, "nope", "x").is_err());
        let task = tasks::add_task(&conn, "t").unwrap();
        add_card(&conn, &extra.id, &task.id, None).unwrap();
        delete_list(&conn, &extra.id).unwrap();
        assert_eq!(get_board(&conn, &board.id).unwrap().lists.len(), 3);
        assert!(boards_of_task(&conn, &task.id).unwrap().is_empty(), "its card went with the list");
        assert!(tasks::is_task(&conn, &task.id).unwrap(), "the task did not");
        assert!(move_list(&conn, "nope", 0).is_err());
    }

    #[test]
    fn deleting_a_task_or_a_board_takes_the_cards_but_never_the_other_way() {
        let conn = conn();
        let (a, b) = (create_board(&conn, "A").unwrap(), create_board(&conn, "B").unwrap());
        let task = tasks::add_task(&conn, "t").unwrap();
        let keep = tasks::add_task(&conn, "keep").unwrap();
        add_card(&conn, &a.lists[0].id, &task.id, None).unwrap();
        add_card(&conn, &b.lists[0].id, &task.id, None).unwrap();
        add_card(&conn, &b.lists[0].id, &keep.id, None).unwrap();
        db::delete_page(&conn, &task.id).unwrap();
        assert!(titles(&get_board(&conn, &a.id).unwrap(), 0).is_empty());
        assert_eq!(titles(&get_board(&conn, &b.id).unwrap(), 0), ["keep"]);
        delete_board(&conn, &b.id).unwrap();
        assert!(get_board(&conn, &b.id).is_err());
        assert!(tasks::is_task(&conn, &keep.id).unwrap(), "deleting a board leaves its tasks");
        let orphans: i64 = conn.query_row("SELECT COUNT(*) FROM board_cards WHERE board_id = ?1", [&b.id], |r| r.get(0)).unwrap();
        assert_eq!(orphans, 0);
    }

    #[test]
    fn a_batch_of_tasks_goes_to_the_first_list_skipping_the_ones_already_there() {
        let conn = conn();
        let board = create_board(&conn, "A").unwrap();
        let ids: Vec<String> = ["uno", "dos", "tres"].iter().map(|t| tasks::add_task(&conn, t).unwrap().id).collect();
        add_card(&conn, &board.lists[1].id, &ids[1], None).unwrap();
        let done = add_cards(&conn, &board.id, &[ids[0].clone(), ids[1].clone(), ids[2].clone(), ids[0].clone()]).unwrap();
        assert_eq!(done, Added { added: 2, skipped: 1 });
        let after = get_board(&conn, &board.id).unwrap();
        assert_eq!((titles(&after, 0), titles(&after, 1)), (vec!["uno", "tres"], vec!["dos"]));
        // all or nothing: a page among them refuses the whole batch
        let page = db::create_page(&conn, None).unwrap();
        let other = create_board(&conn, "B").unwrap();
        assert!(add_cards(&conn, &other.id, &[ids[0].clone(), page.id]).is_err());
        assert!(titles(&get_board(&conn, &other.id).unwrap(), 0).is_empty());
        assert!(add_cards(&conn, "nope", &ids).is_err());
        delete_list(&conn, &other.lists[0].id).unwrap();
        delete_list(&conn, &other.lists[1].id).unwrap();
        delete_list(&conn, &other.lists[2].id).unwrap();
        assert!(add_cards(&conn, &other.id, &ids).unwrap_err().contains("ninguna lista"));
    }

    #[test]
    fn the_limits_hold() {
        let conn = conn();
        let board = create_board(&conn, "A").unwrap();
        for i in 0..(MAX_LISTS - 3) {
            add_list(&conn, &board.id, &format!("l{i}")).unwrap();
        }
        assert!(add_list(&conn, &board.id, "una más").unwrap_err().contains("50"));
        for i in 1..MAX_BOARDS {
            create_board(&conn, &format!("b{i}")).unwrap();
        }
        assert!(create_board(&conn, "una más").unwrap_err().contains("50"));
        // the card limit is a per-board count; fill it with raw rows
        let list = &board.lists[0].id;
        let task = tasks::add_task(&conn, "t").unwrap();
        for i in 0..MAX_CARDS {
            let page = db::create_page(&conn, None).unwrap();
            conn.execute(
                "INSERT INTO board_cards (id, board_id, list_id, task_id, position) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![new_id(), board.id, list, page.id, i],
            )
            .unwrap();
        }
        assert!(add_card(&conn, list, &task.id, None).unwrap_err().contains("500"));
        assert!(create_card(&conn, list, "otra").unwrap_err().contains("500"));
        let tasks_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM pages p JOIN databases d ON d.id = p.database_id WHERE d.role = 'tasks'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(tasks_after, 1, "a refused quick card leaves no task behind");
    }
}
