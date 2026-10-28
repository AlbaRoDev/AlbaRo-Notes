//! Databases: a database is a page of its own kind
//! (`pages.kind = 'database'`) that owns typed properties and its rows; a
//! `database` block in any page doc is just a view of one (it holds only its id). Every write goes through a function
//! here that validates the *real* type of the value; neither the UI inputs nor
//! the future AI tool-calling layer ever touch SQL directly.

use crate::db::{self, derive_page_title, is_valid_iso_date, PageSummary};
use crate::validate::is_uuid;
use crate::views::{self, ViewInfo};
use rusqlite::types::{Value as Sql, ValueRef};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

/// Validated here, not by a SQL CHECK: new kinds keep arriving (`place` in 2.8.3.1, `checkbox` in 5.3,
/// `tags` in 8.2).
pub const KINDS: [&str; 8] = ["text", "number", "date", "select", "relation", "place", "checkbox", "tags"];
const MAX_NAME: usize = 60;
const MAX_PROPERTIES: i64 = 30;
const MAX_OPTIONS: usize = 50;
const MAX_TEXT: usize = 2_000;
const MAX_RELATIONS: usize = 200;
/// Tags on one cell (a task with more is a task with no categories).
const MAX_TAGS: usize = 20;

#[derive(Serialize, Clone)]
pub struct PropertyInfo {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    /// select/tags: `{ "options": [..] }`; relation: `{ "target": "<database id>" }`; text: `{}` or
    /// `{ "format": "url" | "email" | "phone" }`; others `{}`.
    pub config: Value,
    /// The icon the user picked for the column (a lucide icon name or an emoji); `None` = the type's own.
    pub icon: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RowInfo {
    pub page_id: String,
    pub title: String,
    /// property id → value (text/date/select: string, number: number, checkbox: `true`, relation: array
    /// of page ids, tags: array of option texts). A property with no value is absent — an unchecked box is just that.
    pub values: Map<String, Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseData {
    pub id: String,
    /// The database's own page (its title is the database's name).
    pub page_id: String,
    pub name: String,
    pub properties: Vec<PropertyInfo>,
    pub rows: Vec<RowInfo>,
    /// Saved views (at least one); a view's sort/filter/group is applied by `views::query_view`.
    pub views: Vec<ViewInfo>,
}

#[derive(Serialize)]
pub struct DatabaseSummary {
    pub id: String,
    pub name: String,
}

/// A date property holds one day (`2026-10-15`) or, as in Notion, a range
/// (`2026-10-15/2026-10-20`, ISO 8601 interval). Splits it into start and end.
pub fn split_date_range(value: &str) -> (&str, Option<&str>) {
    match value.split_once('/') {
        Some((start, end)) => (start, Some(end)),
        None => (value, None),
    }
}

/// Validates a date value and returns its normal form: both ends real calendar
/// dates, end not before start, and a range of a single day stored as that day.
fn normalize_date(value: &str) -> Result<String, String> {
    let (start, end) = split_date_range(value);
    if !is_valid_iso_date(start) {
        return Err(format!("Fecha no válida: {start}"));
    }
    match end {
        None => Ok(start.to_string()),
        Some(end) if !is_valid_iso_date(end) => Err(format!("Fecha de fin no válida: {end}")),
        Some(end) if end < start => Err("La fecha de fin no puede ser anterior a la de inicio".to_string()),
        Some(end) if end == start => Ok(start.to_string()),
        Some(end) => Ok(format!("{start}/{end}")),
    }
}

const MAX_PLACE_NAME: usize = 200;

/// A place is `{ name?, lat?, lng? }` like Notion's: an address/label and map
/// coordinates. Coordinates come together or not at all, inside the real
/// ranges; an entirely empty place clears the cell.
fn normalize_place(value: &Value) -> Result<Option<Value>, String> {
    let obj = value.as_object().ok_or("El lugar debe ser un objeto {name, lat, lng}")?;
    if let Some(unknown) = obj.keys().find(|k| !matches!(k.as_str(), "name" | "lat" | "lng")) {
        return Err(format!("Campo desconocido en el lugar: {unknown}"));
    }
    let name = match obj.get("name") {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.trim().to_string(),
        Some(_) => return Err("El nombre del lugar debe ser texto".to_string()),
    };
    if name.chars().count() > MAX_PLACE_NAME {
        return Err(format!("El nombre del lugar no puede pasar de {MAX_PLACE_NAME} caracteres"));
    }
    let coord = |key: &str, limit: f64| -> Result<Option<f64>, String> {
        match obj.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(v) => v
                .as_f64()
                .filter(|n| n.is_finite() && n.abs() <= limit)
                .map(Some)
                .ok_or_else(|| format!("{key} debe ser un número entre -{limit} y {limit}")),
        }
    };
    let (lat, lng) = (coord("lat", 90.0)?, coord("lng", 180.0)?);
    match (lat, lng) {
        (None, None) if name.is_empty() => Ok(None),
        (None, None) => Ok(Some(json!({ "name": name }))),
        (Some(lat), Some(lng)) => Ok(Some(json!({ "name": name, "lat": lat, "lng": lng }))),
        _ => Err("Las coordenadas necesitan latitud y longitud".to_string()),
    }
}

/// What a text says about a checkbox: «sí», «hecho», «completado»… are checked, «no», «sin marcar»,
/// «pendiente»… unchecked, anything else nothing. Used to convert a column into a checkbox and to
/// read what the assistant asks for.
pub fn truthy(text: &str) -> Option<bool> {
    match text.trim().to_lowercase().as_str() {
        "sí" | "si" | "yes" | "y" | "true" | "verdadero" | "1" | "x" | "✓" | "✔" | "☑" | "marcada" | "marcado" | "hecho" | "hecha" | "completado" | "completada" | "completo"
        | "terminado" | "terminada" | "finalizado" | "finalizada" | "listo" | "lista" | "done" | "checked" | "complete" | "completed" => Some(true),
        "no" | "false" | "falso" | "0" | "sin marcar" | "desmarcada" | "desmarcado" | "unchecked" | "pendiente" | "incompleto" | "incompleta" => Some(false),
        _ => None,
    }
}

/// The options of a select that would end up checked if it became a checkbox: those the user named
/// (`hint`, any case) or, with no hint, those that read as «done» (`truthy`).
pub fn marked_options(options: &[String], hint: &[String]) -> Vec<String> {
    let hint: Vec<String> = hint.iter().map(|h| h.trim().to_lowercase()).collect();
    options
        .iter()
        .filter(|o| {
            if hint.is_empty() {
                truthy(o) == Some(true)
            } else {
                hint.contains(&o.trim().to_lowercase())
            }
        })
        .cloned()
        .collect()
}

fn sql<E: ToString>(e: E) -> String {
    e.to_string()
}

fn need_uuid(id: &str, what: &str) -> Result<(), String> {
    if is_uuid(id) {
        Ok(())
    } else {
        Err(format!("Invalid {what} id"))
    }
}

fn clean_name(raw: &str, allow_empty: bool) -> Result<String, String> {
    let name = raw.trim();
    let n = name.chars().count();
    if n > MAX_NAME || (n == 0 && !allow_empty) {
        return Err(format!("El nombre debe tener entre 1 y {MAX_NAME} caracteres"));
    }
    Ok(name.to_string())
}

/// `null` counts as "no options". Trimmed, unique, non-empty, bounded.
fn clean_options(raw: &Value) -> Result<Vec<String>, String> {
    let items: &[Value] = match raw {
        Value::Null => &[],
        Value::Array(a) => a,
        _ => return Err("Las opciones deben ser una lista".to_string()),
    };
    if items.len() > MAX_OPTIONS {
        return Err(format!("Máximo {MAX_OPTIONS} opciones"));
    }
    let mut seen = HashSet::new();
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let name = clean_name(item.as_str().ok_or("Cada opción debe ser texto")?, false)?;
        if !seen.insert(name.clone()) {
            return Err(format!("Opción repetida: {name}"));
        }
        out.push(name);
    }
    Ok(out)
}

fn options_of(config: &str) -> Vec<String> {
    serde_json::from_str::<Value>(config)
        .ok()
        .and_then(|c| c.get("options").cloned())
        .and_then(|o| serde_json::from_value(o).ok())
        .unwrap_or_default()
}

/// Notion's tag colours. An option with none stored is coloured by its position on the client.
pub const COLORS: [&str; 10] = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

fn colors_of(config: &str) -> Map<String, Value> {
    serde_json::from_str::<Value>(config)
        .ok()
        .and_then(|c| c.get("colors").and_then(Value::as_object).cloned())
        .unwrap_or_default()
}

/// The three groups of a status property's options, as Notion's «Estado» has: to do, in progress, complete.
const STATUS_GROUPS: [&str; 3] = ["todo", "doing", "done"];
/// What a new «Estado» column starts with: option, colour, group.
const STATUS_DEFAULTS: [(&str, &str, &str); 3] = [("Sin empezar", "gray", "todo"), ("En curso", "blue", "doing"), ("Listo", "green", "done")];

/// A status property is a select whose options belong to groups (`config.status`, `config.groups`).
fn is_status(config: &str) -> bool {
    serde_json::from_str::<Value>(config)
        .ok()
        .and_then(|c| c.get("status").and_then(Value::as_bool))
        .unwrap_or(false)
}

fn groups_of(config: &str) -> Map<String, Value> {
    serde_json::from_str::<Value>(config)
        .ok()
        .and_then(|c| c.get("groups").and_then(Value::as_object).cloned())
        .unwrap_or_default()
}

/// A status config: every option in a valid group (unknown or missing ones in «todo»). With `seed`, no options at all
/// means a brand-new column, which starts with the three default states.
fn status_config(options: Vec<String>, colors: &Map<String, Value>, groups: &Map<String, Value>, seed: bool) -> Value {
    let (options, colors, groups) = if options.is_empty() && seed {
        let options = STATUS_DEFAULTS.iter().map(|(o, _, _)| o.to_string()).collect();
        let colors = STATUS_DEFAULTS.iter().map(|(o, c, _)| (o.to_string(), json!(c))).collect();
        let groups = STATUS_DEFAULTS.iter().map(|(o, _, g)| (o.to_string(), json!(g))).collect();
        (options, colors, groups)
    } else {
        (options, colors.clone(), groups.clone())
    };
    let groups: Map<String, Value> = options
        .iter()
        .map(|o| {
            let group = groups.get(o).filter(|g| g.as_str().is_some_and(|g| STATUS_GROUPS.contains(&g))).cloned();
            (o.clone(), group.unwrap_or(json!("todo")))
        })
        .collect();
    let kept: Map<String, Value> = options.iter().filter_map(|o| colors.get(o).map(|c| (o.clone(), c.clone()))).collect();
    let mut config = json!({ "options": options, "status": true, "groups": groups });
    if !kept.is_empty() {
        config["colors"] = json!(kept);
    }
    config
}

/// A select's config: its options and the colours of those that have one (stale ones dropped). `prev` is the
/// config it replaces, so a status property keeps its groups (`renamed` = an option that changed its name).
fn select_config(prev: &str, options: &[String], colors: &Map<String, Value>, renamed: Option<(&str, &str)>) -> String {
    if is_status(prev) {
        let mut groups = groups_of(prev);
        if let Some((old, new)) = renamed {
            if let Some(group) = groups.remove(old) {
                groups.insert(new.to_string(), group);
            }
        }
        return status_config(options.to_vec(), colors, &groups, false).to_string();
    }
    let kept: Map<String, Value> = options.iter().filter_map(|o| colors.get(o).map(|c| (o.clone(), c.clone()))).collect();
    if kept.is_empty() {
        json!({ "options": options }).to_string()
    } else {
        json!({ "options": options, "colors": kept }).to_string()
    }
}

struct Prop {
    database_id: String,
    kind: String,
    config: String,
}

fn load_prop(conn: &Connection, id: &str) -> Result<Prop, String> {
    need_uuid(id, "property")?;
    conn.query_row("SELECT database_id, type, config FROM properties WHERE id = ?1", [id], |r| {
        Ok(Prop {
            database_id: r.get(0)?,
            kind: r.get(1)?,
            config: r.get(2)?,
        })
    })
    .optional()
    .map_err(sql)?
    .ok_or_else(|| "La propiedad no existe".to_string())
}

/// A new database: a root-level page of kind `database` plus its `databases`
/// row. No `parent_id` — it is another kind of page, not a sub-page of anything.
pub fn create_database_page(conn: &Connection) -> Result<PageSummary, String> {
    let tx = conn.unchecked_transaction().map_err(sql)?;
    let page = insert_database_page(&tx, None)?;
    tx.commit().map_err(sql)?;
    Ok(page)
}

/// `create_database_page` without its own transaction, for callers that already have one.
/// `role` marks a database the app itself relies on (`tasks`); a second one of the same role fails.
pub(crate) fn insert_database_page(conn: &Connection, role: Option<&str>) -> Result<PageSummary, String> {
    let mut page = db::insert_page(conn, None, None, "database").map_err(sql)?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute("INSERT INTO databases (id, page_id, role) VALUES (?1, ?2, ?3)", params![id, page.id, role])
        .map_err(sql)?;
    views::create_default_view(conn, &id)?;
    page.own_database_id = Some(id);
    page.role = role.map(str::to_string);
    Ok(page)
}

/// Every database, named after its page's title (for the view's source picker
/// and relation targets).
pub fn list_databases(conn: &Connection) -> Result<Vec<DatabaseSummary>, String> {
    let rows: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT id, page_id FROM databases ORDER BY created_at, rowid").map_err(sql)?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(sql)?;
        rows.collect::<rusqlite::Result<_>>().map_err(sql)?
    };
    rows.into_iter()
        .map(|(id, page_id)| {
            Ok(DatabaseSummary {
                id,
                name: derive_page_title(conn, &page_id).map_err(sql)?,
            })
        })
        .collect()
}

fn value_to_json(v: ValueRef) -> Value {
    match v {
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
        _ => Value::Null,
    }
}

pub fn get_database(conn: &Connection, id: &str) -> Result<Option<DatabaseData>, String> {
    need_uuid(id, "database")?;
    let Some(page_id): Option<String> = conn.query_row("SELECT page_id FROM databases WHERE id = ?1", [id], |r| r.get(0)).optional().map_err(sql)? else {
        return Ok(None);
    };
    let name = derive_page_title(conn, &page_id).map_err(sql)?;

    let properties: Vec<PropertyInfo> = {
        let mut stmt = conn
            .prepare("SELECT id, name, type, config, icon FROM properties WHERE database_id = ?1 ORDER BY position, rowid")
            .map_err(sql)?;
        let rows = stmt
            .query_map([id], |r| {
                let config: String = r.get(3)?;
                Ok(PropertyInfo {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    kind: r.get(2)?,
                    config: serde_json::from_str(&config).unwrap_or_else(|_| json!({})),
                    icon: r.get(4)?,
                })
            })
            .map_err(sql)?;
        rows.collect::<rusqlite::Result<_>>().map_err(sql)?
    };

    let kind_of: HashMap<&str, &str> = properties.iter().map(|p| (p.id.as_str(), p.kind.as_str())).collect();
    let mut values: HashMap<String, Map<String, Value>> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT v.page_id, v.property_id, v.value FROM property_values v
                 JOIN properties p ON p.id = v.property_id WHERE p.database_id = ?1",
            )
            .map_err(sql)?;
        let mut rows = stmt.query([id]).map_err(sql)?;
        while let Some(r) = rows.next().map_err(sql)? {
            let (page, prop): (String, String) = (r.get(0).map_err(sql)?, r.get(1).map_err(sql)?);
            let mut v = value_to_json(r.get_ref(2).map_err(sql)?);
            if kind_of.get(prop.as_str()) == Some(&"place") {
                // a place is stored as JSON text ({name, lat, lng}); clients get the object
                v = v.as_str().and_then(|s| serde_json::from_str(s).ok()).unwrap_or(Value::Null);
            } else if kind_of.get(prop.as_str()) == Some(&"tags") {
                // stored as a JSON array of option texts
                v = v.as_str().and_then(|s| serde_json::from_str(s).ok()).unwrap_or(json!([]));
            } else if kind_of.get(prop.as_str()) == Some(&"checkbox") {
                // stored as 1 (unchecked = no value); clients get a boolean
                v = json!(v.as_f64() == Some(1.0));
            }
            values.entry(page).or_default().insert(prop, v);
        }
    }
    {
        let mut stmt = conn
            .prepare(
                "SELECT l.page_id, l.property_id, l.target_id FROM property_relations l
                 JOIN properties p ON p.id = l.property_id WHERE p.database_id = ?1 ORDER BY l.rowid",
            )
            .map_err(sql)?;
        let mut rows = stmt.query([id]).map_err(sql)?;
        while let Some(r) = rows.next().map_err(sql)? {
            let (page, prop, target): (String, String, String) = (r.get(0).map_err(sql)?, r.get(1).map_err(sql)?, r.get(2).map_err(sql)?);
            let slot = values.entry(page).or_default().entry(prop).or_insert_with(|| json!([]));
            if let Value::Array(a) = slot {
                a.push(json!(target));
            }
        }
    }

    let page_ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM pages WHERE database_id = ?1 ORDER BY row_position IS NULL, row_position, created_at, rowid")
            .map_err(sql)?;
        let rows = stmt.query_map([id], |r| r.get(0)).map_err(sql)?;
        rows.collect::<rusqlite::Result<_>>().map_err(sql)?
    };
    let rows = page_ids
        .into_iter()
        .map(|page_id| {
            let title = derive_page_title(conn, &page_id).map_err(sql)?;
            let values = values.remove(&page_id).unwrap_or_default();
            Ok(RowInfo { page_id, title, values })
        })
        .collect::<Result<Vec<_>, String>>()?;

    let views = views::list_views(conn, id)?;
    Ok(Some(DatabaseData {
        id: id.to_string(),
        page_id,
        name,
        properties,
        rows,
        views,
    }))
}

/// The formats a text property can have: plain text, or one Notion shows as a link.
const TEXT_FORMATS: [&str; 3] = ["url", "email", "phone"];

fn text_format(config: &str) -> Option<String> {
    let format = serde_json::from_str::<Value>(config).ok()?.get("format")?.as_str()?.to_string();
    TEXT_FORMATS.contains(&format.as_str()).then_some(format)
}

fn text_config(config: &Value) -> Result<Value, String> {
    match config.get("format") {
        None | Some(Value::Null) => Ok(json!({})),
        Some(Value::String(f)) if TEXT_FORMATS.contains(&f.as_str()) => Ok(json!({ "format": f })),
        Some(_) => Err("Formato de texto desconocido (url, email o phone)".to_string()),
    }
}

/// What a url / email / phone cell may hold. Not a full parser: enough that a link, a mail address or a
/// number is what it says, and nothing with spaces or control characters reaches the opener.
fn check_text_format(format: &str, s: &str) -> Result<(), String> {
    let bad = |what: &str| Err(format!("No es {what} válido"));
    if s.chars().any(|c| c.is_whitespace() || c.is_control()) && format != "phone" {
        return bad(if format == "url" { "un enlace" } else { "un correo" });
    }
    match format {
        "url" => {
            let rest = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://"));
            match rest {
                Some(r) if !r.is_empty() && !r.starts_with('/') => Ok(()),
                _ => Err("El enlace debe empezar por http:// o https://".to_string()),
            }
        }
        "email" => match s.split_once('@') {
            Some((user, host)) if !user.is_empty() && host.contains('.') && !host.contains('@') && !host.starts_with('.') && !host.ends_with('.') => Ok(()),
            _ => bad("un correo"),
        },
        "phone" => {
            let digits = s.chars().filter(char::is_ascii_digit).count();
            let allowed = s.chars().all(|c| c.is_ascii_digit() || matches!(c, '+' | '-' | '(' | ')' | '.' | ' '));
            if allowed && (3..=20).contains(&digits) && !s[1..].contains('+') {
                Ok(())
            } else {
                bad("un teléfono")
            }
        }
        _ => Ok(()),
    }
}

fn relation_config(conn: &Connection, config: &Value) -> Result<Value, String> {
    let target = config
        .get("target")
        .and_then(Value::as_str)
        .filter(|t| is_uuid(t))
        .ok_or("Una relación necesita una base de datos de destino")?;
    let exists = conn.prepare("SELECT 1 FROM databases WHERE id = ?1").and_then(|mut s| s.exists([target])).map_err(sql)?;
    if !exists {
        return Err("La base de datos de destino no existe".to_string());
    }
    Ok(json!({ "target": target }))
}

pub fn add_property(conn: &Connection, database_id: &str, name: &str, kind: &str, config: &Value) -> Result<PropertyInfo, String> {
    need_uuid(database_id, "database")?;
    let name = clean_name(name, false)?;
    if !KINDS.contains(&kind) {
        return Err(format!("Tipo de propiedad desconocido: {kind}"));
    }
    let config = match kind {
        "select" if config.get("status") == Some(&json!(true)) => status_config(clean_options(config.get("options").unwrap_or(&Value::Null))?, &Map::new(), &Map::new(), true),
        "select" | "tags" => json!({ "options": clean_options(config.get("options").unwrap_or(&Value::Null))? }),
        "relation" => relation_config(conn, config)?,
        "text" => text_config(config)?,
        _ => json!({}),
    };

    let (count, next): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(MAX(position), -1) + 1 FROM properties WHERE database_id = ?1",
            [database_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(sql)?;
    if count >= MAX_PROPERTIES {
        return Err(format!("Máximo {MAX_PROPERTIES} propiedades por base de datos"));
    }

    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO properties (id, database_id, name, type, config, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, database_id, name, kind, config.to_string(), next],
    )
    .map_err(sql)?; // FK fails if the database doesn't exist
    Ok(PropertyInfo {
        id,
        name,
        kind: kind.to_string(),
        config,
        icon: None,
    })
}

pub fn rename_property(conn: &Connection, id: &str, name: &str) -> Result<(), String> {
    load_prop(conn, id)?;
    conn.execute("UPDATE properties SET name = ?1 WHERE id = ?2", [&clean_name(name, false)?, id])
        .map_err(sql)?;
    Ok(())
}

pub fn delete_property(conn: &Connection, id: &str) -> Result<(), String> {
    let prop = load_prop(conn, id)?;
    views::strip_property(conn, &prop.database_id, id)?; // no view may keep a rule on it
    conn.execute("DELETE FROM properties WHERE id = ?1", [id]).map_err(sql)?;
    Ok(())
}

/// Selects and tags are the kinds with options.
fn has_options(kind: &str) -> bool {
    matches!(kind, "select" | "tags")
}

/// The tags in a stored tags cell (a JSON array of option texts).
fn tags_of(stored: &str) -> Vec<String> {
    serde_json::from_str(stored).unwrap_or_default()
}

/// Rewrites every cell of a tags property through `f`; a cell left with no tags is cleared.
fn rewrite_tags(tx: &Connection, property_id: &str, f: impl Fn(Vec<String>) -> Vec<String>) -> Result<(), String> {
    let cells: Vec<(String, String)> = {
        let mut stmt = tx.prepare("SELECT page_id, value FROM property_values WHERE property_id = ?1").map_err(sql)?;
        let rows = stmt.query_map([property_id], |r| Ok((r.get(0)?, r.get::<_, String>(1)?))).map_err(sql)?;
        rows.collect::<rusqlite::Result<_>>().map_err(sql)?
    };
    for (page, stored) in cells {
        let before = tags_of(&stored);
        let after = f(before.clone());
        if after == before {
            continue;
        }
        if after.is_empty() {
            tx.execute("DELETE FROM property_values WHERE page_id = ?1 AND property_id = ?2", [&page, property_id])
                .map_err(sql)?;
        } else {
            tx.execute(
                "UPDATE property_values SET value = ?1 WHERE page_id = ?2 AND property_id = ?3",
                params![json!(after).to_string(), page, property_id],
            )
            .map_err(sql)?;
        }
    }
    Ok(())
}

/// Replaces a select or tags property's options; values that are no longer an option are cleared
/// (a tags cell only loses the tags that went).
/// (No rename: values are stored as the option text — upgrade path is option ids.)
pub fn set_select_options(conn: &Connection, id: &str, options: &Value) -> Result<(), String> {
    let prop = load_prop(conn, id)?;
    if !has_options(&prop.kind) {
        return Err("Solo las propiedades de selección y de etiquetas tienen opciones".to_string());
    }
    let options = clean_options(options)?;
    let tx = conn.unchecked_transaction().map_err(sql)?;
    tx.execute(
        "UPDATE properties SET config = ?1 WHERE id = ?2",
        [select_config(&prop.config, &options, &colors_of(&prop.config), None), id.to_string()],
    )
    .map_err(sql)?;
    if prop.kind == "tags" {
        rewrite_tags(&tx, id, |mut tags| {
            tags.retain(|t| options.contains(t));
            tags
        })?;
        return tx.commit().map_err(sql);
    }
    let stale: Vec<String> = {
        let mut stmt = tx.prepare("SELECT page_id, value FROM property_values WHERE property_id = ?1").map_err(sql)?;
        let rows = stmt.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(sql)?;
        let all = rows.collect::<rusqlite::Result<Vec<_>>>().map_err(sql)?;
        all.into_iter().filter(|(_, v)| !options.contains(v)).map(|(p, _)| p).collect()
    };
    for page in stale {
        tx.execute("DELETE FROM property_values WHERE page_id = ?1 AND property_id = ?2", [&page, id])
            .map_err(sql)?;
    }
    tx.commit().map_err(sql)
}

/// Renames one option of a select property. Values are stored as the option's
/// text, so the rename rewrites the property's values in the same transaction
/// (upgrade path if options ever need colors/stable ids: store option ids).
pub fn rename_select_option(conn: &Connection, id: &str, old: &str, new: &str) -> Result<(), String> {
    let prop = load_prop(conn, id)?;
    if !has_options(&prop.kind) {
        return Err("Solo las propiedades de selección y de etiquetas tienen opciones".to_string());
    }
    let new = clean_name(new, false)?;
    let mut options = options_of(&prop.config);
    let at = options.iter().position(|o| o == old).ok_or("La opción no existe")?;
    if new != old && options.contains(&new) {
        return Err(format!("Opción repetida: {new}"));
    }
    options[at] = new.clone();
    let mut colors = colors_of(&prop.config);
    if let Some(color) = colors.remove(old) {
        colors.insert(new.clone(), color);
    }

    let tx = conn.unchecked_transaction().map_err(sql)?;
    tx.execute(
        "UPDATE properties SET config = ?1 WHERE id = ?2",
        [select_config(&prop.config, &options, &colors, Some((old, &new))), id.to_string()],
    )
    .map_err(sql)?;
    if prop.kind == "tags" {
        rewrite_tags(&tx, id, |tags| tags.into_iter().map(|t| if t == old { new.clone() } else { t }).collect())?;
    } else {
        tx.execute("UPDATE property_values SET value = ?1 WHERE property_id = ?2 AND value = ?3", [&new, id, old])
            .map_err(sql)?;
    }
    views::rename_option_in_filters(&tx, &prop.database_id, id, old, &new)?;
    tx.commit().map_err(sql)
}

const MAX_ICON: usize = 32;

/// An icon (of a column or of a page): trimmed, or `None` when empty; a name or an emoji with no markup or spaces.
pub(crate) fn check_icon(icon: Option<&str>) -> Result<Option<&str>, String> {
    let icon = icon.map(str::trim).filter(|i| !i.is_empty());
    if let Some(i) = icon {
        if i.chars().count() > MAX_ICON || i.chars().any(|c| c.is_whitespace() || c.is_control() || matches!(c, '<' | '>' | '"' | '\'' | '&')) {
            return Err("Icono no válido".to_string());
        }
    }
    Ok(icon)
}

/// Sets (or, with `None`, clears) the icon of a column: a lucide icon name or an emoji, no markup, no spaces.
pub fn set_property_icon(conn: &Connection, id: &str, icon: Option<&str>) -> Result<(), String> {
    load_prop(conn, id)?;
    let icon = check_icon(icon)?;
    conn.execute("UPDATE properties SET icon = ?1 WHERE id = ?2", params![icon, id]).map_err(sql)?;
    Ok(())
}

/// Sets the colour of one option of a select property.
pub fn set_option_color(conn: &Connection, id: &str, option: &str, color: &str) -> Result<(), String> {
    let prop = load_prop(conn, id)?;
    if !has_options(&prop.kind) {
        return Err("Solo las propiedades de selección y de etiquetas tienen opciones".to_string());
    }
    if !COLORS.contains(&color) {
        return Err(format!("Color desconocido: {color}"));
    }
    let options = options_of(&prop.config);
    if !options.iter().any(|o| o == option) {
        return Err("La opción no existe".to_string());
    }
    let mut colors = colors_of(&prop.config);
    colors.insert(option.to_string(), json!(color));
    conn.execute(
        "UPDATE properties SET config = ?1 WHERE id = ?2",
        [select_config(&prop.config, &options, &colors, None), id.to_string()],
    )
    .map_err(sql)?;
    Ok(())
}

/// Moves one option of a status property to another group.
pub fn set_option_group(conn: &Connection, id: &str, option: &str, group: &str) -> Result<(), String> {
    let prop = load_prop(conn, id)?;
    if prop.kind != "select" || !is_status(&prop.config) {
        return Err("Solo las propiedades de estado tienen grupos".to_string());
    }
    if !STATUS_GROUPS.contains(&group) {
        return Err(format!("Grupo desconocido: {group}"));
    }
    let options = options_of(&prop.config);
    if !options.iter().any(|o| o == option) {
        return Err("La opción no existe".to_string());
    }
    let mut groups = groups_of(&prop.config);
    groups.insert(option.to_string(), json!(group));
    let config = status_config(options, &colors_of(&prop.config), &groups, false);
    conn.execute("UPDATE properties SET config = ?1 WHERE id = ?2", [config.to_string(), id.to_string()])
        .map_err(sql)?;
    Ok(())
}

/// A copy of a property — type, options and every row's value — placed right after it.
pub fn duplicate_property(conn: &Connection, id: &str) -> Result<PropertyInfo, String> {
    let prop = load_prop(conn, id)?;
    let (name, position): (String, i64) = conn
        .query_row("SELECT name, position FROM properties WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(sql)?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM properties WHERE database_id = ?1", [&prop.database_id], |r| r.get(0))
        .map_err(sql)?;
    if count >= MAX_PROPERTIES {
        return Err(format!("Máximo {MAX_PROPERTIES} propiedades por base de datos"));
    }
    let copy_name: String = format!("{name} (copia)").chars().take(MAX_NAME).collect();
    let new_id = uuid::Uuid::new_v4().to_string();

    let tx = conn.unchecked_transaction().map_err(sql)?;
    tx.execute(
        "UPDATE properties SET position = position + 1 WHERE database_id = ?1 AND position > ?2",
        params![prop.database_id, position],
    )
    .map_err(sql)?;
    tx.execute(
        "INSERT INTO properties (id, database_id, name, type, config, position, icon)
         SELECT ?1, database_id, ?2, type, config, ?3, icon FROM properties WHERE id = ?4",
        params![new_id, copy_name, position + 1, id],
    )
    .map_err(sql)?;
    tx.execute(
        "INSERT INTO property_values (page_id, property_id, value)
         SELECT page_id, ?1, value FROM property_values WHERE property_id = ?2",
        [&new_id, id],
    )
    .map_err(sql)?;
    tx.execute(
        "INSERT INTO property_relations (property_id, page_id, target_id)
         SELECT ?1, page_id, target_id FROM property_relations WHERE property_id = ?2 ORDER BY rowid",
        [&new_id, id],
    )
    .map_err(sql)?;
    tx.commit().map_err(sql)?;
    let config = serde_json::from_str(&prop.config).unwrap_or_else(|_| json!({}));
    let icon: Option<String> = conn.query_row("SELECT icon FROM properties WHERE id = ?1", [id], |r| r.get(0)).map_err(sql)?;
    Ok(PropertyInfo {
        id: new_id,
        name: copy_name,
        kind: prop.kind,
        config,
        icon,
    })
}

/// A value as text, the common ground for converting between types (as Notion does).
fn text_of(kind: &str, value: &Value) -> Option<String> {
    let text = match kind {
        "number" => {
            let n = value.as_f64()?;
            if n.fract() == 0.0 && n.abs() < 1e15 {
                format!("{}", n as i64)
            } else {
                n.to_string()
            }
        }
        // a place is stored as JSON text; its label is what reads as text
        "place" => serde_json::from_str::<Value>(value.as_str()?).ok()?.get("name")?.as_str()?.to_string(),
        // tags read as their texts, comma separated
        "tags" => tags_of(value.as_str()?).join(", "),
        // only checked boxes hold a value, and read as «Sí»
        "checkbox" => (value.as_f64()? == 1.0).then(|| "Sí".to_string())?,
        _ => value.as_str()?.to_string(),
    };
    (!text.trim().is_empty()).then_some(text)
}

/// Changes a property's type, converting every value through its text form (a checkbox's options
/// come from `config.checked`, the texts that become checked; see `marked_options`): «12» becomes the
/// number 12, «2026-10-15» a date, the distinct texts the options of a select, the titles of the
/// linked rows the text of a former relation. A value with no meaning in the new type is cleared;
/// a relation can't be built from text, so changing to one clears every value.
pub fn change_property_type(conn: &Connection, id: &str, kind: &str, config: &Value) -> Result<(), String> {
    let prop = load_prop(conn, id)?;
    if !KINDS.contains(&kind) {
        return Err(format!("Tipo de propiedad desconocido: {kind}"));
    }
    // text → text only changes something when the format does (plain ↔ url / email / phone)
    let same_text_format = kind == "text" && text_format(&prop.config) == text_format(&config.to_string());
    let same_status = kind == "select" && is_status(&prop.config) == (config.get("status") == Some(&json!(true)));
    if kind == prop.kind && ((kind != "text" && kind != "select") || same_text_format && kind == "text" || same_status && kind == "select") {
        return Ok(());
    }

    // every row's current value as text, in row order
    let texts: Vec<(String, String)> = if prop.kind == "relation" {
        let links: Vec<(String, String)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT l.page_id, l.target_id FROM property_relations l JOIN pages p ON p.id = l.page_id
                     WHERE l.property_id = ?1 ORDER BY p.created_at, p.rowid, l.rowid",
                )
                .map_err(sql)?;
            let rows = stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(sql)?;
            rows.collect::<rusqlite::Result<_>>().map_err(sql)?
        };
        let mut by_page: Vec<(String, Vec<String>)> = Vec::new();
        for (page, target) in links {
            let title = derive_page_title(conn, &target).map_err(sql)?;
            match by_page.iter_mut().find(|(p, _)| *p == page) {
                Some((_, titles)) => titles.push(title),
                None => by_page.push((page, vec![title])),
            }
        }
        by_page.into_iter().map(|(page, titles)| (page, titles.join(", "))).collect()
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT v.page_id, v.value FROM property_values v JOIN pages p ON p.id = v.page_id
                 WHERE v.property_id = ?1 ORDER BY p.created_at, p.rowid",
            )
            .map_err(sql)?;
        let mut rows = stmt.query([id]).map_err(sql)?;
        let mut out = Vec::new();
        while let Some(r) = rows.next().map_err(sql)? {
            let page: String = r.get(0).map_err(sql)?;
            let stored = value_to_json(r.get_ref(1).map_err(sql)?);
            // a select holds one option: a tags cell gives its first tag
            let text = if prop.kind == "tags" && kind == "select" {
                stored.as_str().and_then(|s| tags_of(s).into_iter().next())
            } else {
                text_of(&prop.kind, &stored)
            };
            if let Some(text) = text {
                out.push((page, text));
            }
        }
        out
    };

    let checked_hint: Vec<String> = config
        .get("checked")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();
    // what a text is made of in the new type: tags are its comma separated pieces, anything else one piece
    let pieces = |text: &str| -> Vec<String> {
        if kind == "tags" {
            text.split(',').map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect()
        } else {
            vec![text.trim().to_string()]
        }
    };
    let new_config = match kind {
        "select" | "tags" => {
            // a select turning into a status (or back) keeps its options and colours; any other source makes them from its values
            let keep = kind == "select" && prop.kind == "select";
            let mut options: Vec<String> = if keep { options_of(&prop.config) } else { Vec::new() };
            let colors = if keep { colors_of(&prop.config) } else { Map::new() };
            for (_, text) in &texts {
                for option in pieces(text) {
                    if option.chars().count() <= MAX_NAME && options.len() < MAX_OPTIONS && !options.contains(&option) {
                        options.push(option);
                    }
                }
            }
            if kind == "select" && config.get("status") == Some(&json!(true)) {
                status_config(options, &colors, &Map::new(), true)
            } else {
                serde_json::from_str(&select_config("", &options, &colors, None)).unwrap_or_else(|_| json!({ "options": options }))
            }
        }
        "relation" => relation_config(conn, config)?,
        "text" => text_config(config)?,
        _ => json!({}),
    }
    .to_string();
    let converted: Vec<(String, Sql)> = texts
        .iter()
        .filter_map(|(page, text)| {
            let value = match kind {
                "text" => json!(text.chars().take(MAX_TEXT).collect::<String>()),
                // «7,25» as written in Spanish is a number too
                "number" => json!(text.trim().replace(',', ".").parse::<f64>().ok()?),
                "date" | "select" => json!(text.trim()),
                "tags" => json!(pieces(text)),
                "place" => json!({ "name": text.trim().chars().take(MAX_PLACE_NAME).collect::<String>() }),
                "checkbox" => {
                    if marked_options(std::slice::from_ref(text), &checked_hint).is_empty() {
                        return None; // unchecked is simply no value
                    }
                    json!(true)
                }
                _ => return None,
            };
            // the same validation as any write: what doesn't fit the new type is dropped
            scalar(kind, &new_config, &value).ok().flatten().map(|v| (page.clone(), v))
        })
        .collect();

    let tx = conn.unchecked_transaction().map_err(sql)?;
    tx.execute("DELETE FROM property_values WHERE property_id = ?1", [id]).map_err(sql)?;
    tx.execute("DELETE FROM property_relations WHERE property_id = ?1", [id]).map_err(sql)?;
    tx.execute("UPDATE properties SET type = ?1, config = ?2 WHERE id = ?3", [kind, &new_config, id])
        .map_err(sql)?;
    for (page, value) in converted {
        tx.execute("INSERT INTO property_values (page_id, property_id, value) VALUES (?1, ?2, ?3)", params![page, id, value])
            .map_err(sql)?;
    }
    views::retype_property(&tx, &prop.database_id, id, kind)?;
    tx.commit().map_err(sql)
}

/// Sets the column order. `ordered_ids` must be exactly the database's
/// properties, each once — anything else is rejected rather than half-applied.
pub fn reorder_properties(conn: &Connection, database_id: &str, ordered_ids: &[String]) -> Result<(), String> {
    need_uuid(database_id, "database")?;
    let current: HashSet<String> = {
        let mut stmt = conn.prepare("SELECT id FROM properties WHERE database_id = ?1").map_err(sql)?;
        let rows = stmt.query_map([database_id], |r| r.get(0)).map_err(sql)?;
        rows.collect::<rusqlite::Result<_>>().map_err(sql)?
    };
    let given: HashSet<&String> = ordered_ids.iter().collect();
    if given.len() != ordered_ids.len() || given.len() != current.len() || !ordered_ids.iter().all(|i| current.contains(i)) {
        return Err("El orden debe incluir cada propiedad exactamente una vez".to_string());
    }
    let tx = conn.unchecked_transaction().map_err(sql)?;
    for (position, id) in ordered_ids.iter().enumerate() {
        tx.execute("UPDATE properties SET position = ?1 WHERE id = ?2", params![position as i64, id]).map_err(sql)?;
    }
    tx.commit().map_err(sql)
}

/// Sets the order of a database's rows (the order every view starts from before sorting); `ordered_ids` must be
/// every row of the database, once each. Rows made afterwards go last.
pub fn reorder_rows(conn: &Connection, database_id: &str, ordered_ids: &[String]) -> Result<(), String> {
    need_uuid(database_id, "database")?;
    let current: HashSet<String> = {
        let mut stmt = conn.prepare("SELECT id FROM pages WHERE database_id = ?1").map_err(sql)?;
        let rows = stmt.query_map([database_id], |r| r.get(0)).map_err(sql)?;
        rows.collect::<rusqlite::Result<_>>().map_err(sql)?
    };
    let given: HashSet<&String> = ordered_ids.iter().collect();
    if given.len() != ordered_ids.len() || given.len() != current.len() || !ordered_ids.iter().all(|i| current.contains(i)) {
        return Err("El orden debe incluir cada fila exactamente una vez".to_string());
    }
    let tx = conn.unchecked_transaction().map_err(sql)?;
    for (position, id) in ordered_ids.iter().enumerate() {
        tx.execute("UPDATE pages SET row_position = ?1 WHERE id = ?2", params![position as i64, id]).map_err(sql)?;
    }
    tx.commit().map_err(sql)
}

/// A copy of a row — body, cells and relations — titled «… (copia)».
pub fn duplicate_row(conn: &Connection, row_id: &str) -> Result<PageSummary, String> {
    need_uuid(row_id, "page")?;
    let (parent, database_id): (Option<String>, Option<String>) = conn
        .query_row("SELECT parent_id, database_id FROM pages WHERE id = ?1", [row_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(sql)?
        .ok_or("La página no existe")?;
    let database_id = database_id.ok_or("Solo se pueden duplicar las filas de una base de datos")?;
    let title = derive_page_title(conn, row_id).map_err(sql)?;

    let tx = conn.unchecked_transaction().map_err(sql)?;
    let copy = db::insert_page(&tx, parent.as_deref(), Some(&database_id), "page").map_err(sql)?;
    tx.execute(
        "UPDATE blocks SET content = (SELECT content FROM blocks WHERE page_id = ?1 AND parent_id IS NULL AND type = 'doc')
         WHERE page_id = ?2 AND parent_id IS NULL AND type = 'doc'",
        [row_id, &copy.id],
    )
    .map_err(sql)?;
    tx.execute(
        "INSERT INTO property_values (page_id, property_id, value) SELECT ?1, property_id, value FROM property_values WHERE page_id = ?2",
        [&copy.id, row_id],
    )
    .map_err(sql)?;
    tx.execute(
        "INSERT INTO property_relations (property_id, page_id, target_id) SELECT property_id, ?1, target_id FROM property_relations WHERE page_id = ?2 ORDER BY rowid",
        [&copy.id, row_id],
    )
    .map_err(sql)?;
    let name: String = format!("{title} (copia)").chars().take(200).collect();
    db::set_row_title(&tx, &copy.id, &name)?;
    tx.commit().map_err(sql)?;
    Ok(PageSummary { title: name, ..copy })
}

/// A new row: an ordinary page nested under the database's own page.
pub fn create_row(conn: &Connection, database_id: &str) -> Result<PageSummary, String> {
    need_uuid(database_id, "database")?;
    let host: String = conn
        .query_row("SELECT page_id FROM databases WHERE id = ?1", [database_id], |r| r.get(0))
        .optional()
        .map_err(sql)?
        .ok_or("La base de datos no existe")?;
    db::insert_page(conn, Some(&host), Some(database_id), "page").map_err(sql)
}

/// Validates `value` against the property's real type. `None` = clear the value.
fn scalar(kind: &str, config: &str, value: &Value) -> Result<Option<Sql>, String> {
    if value.is_null() {
        return Ok(None);
    }
    match kind {
        "text" => {
            let s = value.as_str().ok_or("El valor debe ser texto")?;
            if s.chars().count() > MAX_TEXT {
                return Err(format!("El texto no puede pasar de {MAX_TEXT} caracteres"));
            }
            if let Some(format) = text_format(config).filter(|_| !s.is_empty()) {
                check_text_format(&format, s)?;
            }
            Ok((!s.is_empty()).then(|| Sql::Text(s.to_string())))
        }
        "number" => value
            .as_f64()
            .filter(|n| n.is_finite())
            .map(|n| Some(Sql::Real(n)))
            .ok_or_else(|| "El valor debe ser un número".to_string()),
        "date" => {
            let s = value.as_str().ok_or("La fecha debe ser texto AAAA-MM-DD (o AAAA-MM-DD/AAAA-MM-DD)")?;
            Ok(Some(Sql::Text(normalize_date(s)?)))
        }
        "place" => Ok(normalize_place(value)?.map(|p| Sql::Text(p.to_string()))),
        // checked = 1; unchecked clears the value, so «no value» and «unchecked» are the same thing
        "checkbox" => Ok(value.as_bool().ok_or("El valor debe ser verdadero o falso")?.then_some(Sql::Integer(1))),
        "select" => {
            let s = value.as_str().ok_or("La opción debe ser texto")?;
            if !options_of(config).iter().any(|o| o == s) {
                return Err(format!("«{s}» no es una opción de esta propiedad"));
            }
            Ok(Some(Sql::Text(s.to_string())))
        }
        // a list of the property's options, each once; stored as a JSON array, none = no value
        "tags" => {
            let items = value.as_array().ok_or("Las etiquetas deben ser una lista")?;
            let options = options_of(config);
            let mut tags: Vec<&str> = Vec::new();
            for item in items {
                let tag = item.as_str().ok_or("Cada etiqueta debe ser texto")?;
                if !options.iter().any(|o| o == tag) {
                    return Err(format!("«{tag}» no es una etiqueta de esta propiedad"));
                }
                if !tags.contains(&tag) {
                    tags.push(tag);
                }
            }
            if tags.len() > MAX_TAGS {
                return Err(format!("Máximo {MAX_TAGS} etiquetas por celda"));
            }
            Ok((!tags.is_empty()).then(|| Sql::Text(json!(tags).to_string())))
        }
        _ => Err("Tipo de propiedad no soportado".to_string()),
    }
}

/// The property, if `page_id` is a row of its database.
fn row_property(conn: &Connection, page_id: &str, property_id: &str) -> Result<Prop, String> {
    need_uuid(page_id, "page")?;
    let prop = load_prop(conn, property_id)?;
    let row_db: Option<String> = conn
        .query_row("SELECT database_id FROM pages WHERE id = ?1", [page_id], |r| r.get(0))
        .optional()
        .map_err(sql)?
        .flatten();
    if row_db.as_deref() != Some(prop.database_id.as_str()) {
        return Err("La página no es una fila de esta base de datos".to_string());
    }
    Ok(prop)
}

/// Whether `set_value` would accept this scalar value, without writing anything: the AI's
/// proposed changes are checked when proposed, not only when applied. Relations are refused.
pub fn check_value(conn: &Connection, page_id: &str, property_id: &str, value: &Value) -> Result<(), String> {
    let prop = row_property(conn, page_id, property_id)?;
    if prop.kind == "relation" {
        return Err("Las relaciones no se cambian desde el asistente".to_string());
    }
    scalar(&prop.kind, &prop.config, value).map(|_| ())
}

/// Sets (or clears, with `null`) one cell. `page_id` must be a row of the
/// property's own database; relation values are arrays of rows of the target
/// database, replaced as a whole.
pub fn set_value(conn: &Connection, page_id: &str, property_id: &str, value: &Value) -> Result<(), String> {
    let prop = row_property(conn, page_id, property_id)?;
    let tx = conn.unchecked_transaction().map_err(sql)?;
    if prop.kind == "relation" {
        let ids: Vec<&str> = match value {
            Value::Null => vec![],
            Value::Array(a) => a
                .iter()
                .map(|v| v.as_str().filter(|s| is_uuid(s)).ok_or("Cada relación debe ser un id de página"))
                .collect::<Result<_, _>>()?,
            _ => return Err("Una relación debe ser una lista de páginas".to_string()),
        };
        if ids.len() > MAX_RELATIONS {
            return Err(format!("Máximo {MAX_RELATIONS} relaciones por celda"));
        }
        let target_db = serde_json::from_str::<Value>(&prop.config)
            .ok()
            .and_then(|c| c.get("target").and_then(Value::as_str).map(str::to_string))
            .ok_or("La relación no tiene destino")?;
        let mut seen = HashSet::new();
        let unique: Vec<&str> = ids.iter().copied().filter(|t| seen.insert(*t)).collect();
        for target in &unique {
            let in_target: Option<String> = tx
                .query_row("SELECT database_id FROM pages WHERE id = ?1", [target], |r| r.get(0))
                .optional()
                .map_err(sql)?
                .flatten();
            if in_target.as_deref() != Some(target_db.as_str()) {
                return Err("Solo se pueden relacionar filas de la base de datos de destino".to_string());
            }
        }
        tx.execute("DELETE FROM property_relations WHERE property_id = ?1 AND page_id = ?2", [property_id, page_id])
            .map_err(sql)?;
        for target in &unique {
            tx.execute(
                "INSERT INTO property_relations (property_id, page_id, target_id) VALUES (?1, ?2, ?3)",
                [property_id, page_id, target],
            )
            .map_err(sql)?;
        }
    } else {
        match scalar(&prop.kind, &prop.config, value)? {
            None => {
                tx.execute("DELETE FROM property_values WHERE page_id = ?1 AND property_id = ?2", [page_id, property_id])
                    .map_err(sql)?;
            }
            Some(v) => {
                tx.execute(
                    "INSERT INTO property_values (page_id, property_id, value) VALUES (?1, ?2, ?3)
                     ON CONFLICT(page_id, property_id) DO UPDATE SET value = excluded.value",
                    params![page_id, property_id, v],
                )
                .map_err(sql)?;
            }
        }
    }
    tx.commit().map_err(sql)
}

/// Sets (or clears, with `null`) the same scalar value on several rows at once, all or nothing in a
/// single transaction (the assistant's «ponlas todas como completadas»). Same validation as
/// `set_value`: the value is checked against the property's real type once, and every row must belong
/// to the property's database. Relations are refused (they are set row by row).
pub fn set_values(conn: &Connection, row_ids: &[String], property_id: &str, value: &Value) -> Result<(), String> {
    let prop = load_prop(conn, property_id)?;
    if prop.kind == "relation" {
        return Err("Las relaciones no se cambian en bloque".to_string());
    }
    let checked = scalar(&prop.kind, &prop.config, value)?;
    for row in row_ids {
        row_property(conn, row, property_id)?;
    }
    let tx = conn.unchecked_transaction().map_err(sql)?;
    for row in row_ids {
        match &checked {
            None => {
                tx.execute("DELETE FROM property_values WHERE page_id = ?1 AND property_id = ?2", [row.as_str(), property_id])
                    .map_err(sql)?;
            }
            Some(v) => {
                tx.execute(
                    "INSERT INTO property_values (page_id, property_id, value) VALUES (?1, ?2, ?3)
                     ON CONFLICT(page_id, property_id) DO UPDATE SET value = excluded.value",
                    params![row, property_id, v],
                )
                .map_err(sql)?;
            }
        }
    }
    tx.commit().map_err(sql)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fx {
        conn: Connection,
        /// The database page (owner of `db`).
        page: String,
        db: String,
    }

    fn fixture() -> Fx {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        db::run_migrations(&conn).unwrap();
        let p = create_database_page(&conn).unwrap();
        Fx {
            conn,
            page: p.id,
            db: p.own_database_id.unwrap(),
        }
    }

    fn new_db(fx: &Fx) -> String {
        create_database_page(&fx.conn).unwrap().own_database_id.unwrap()
    }

    fn prop(fx: &Fx, name: &str, kind: &str, config: Value) -> String {
        add_property(&fx.conn, &fx.db, name, kind, &config).unwrap().id
    }

    fn get(fx: &Fx, row: &str, p: &str) -> Option<Value> {
        let data = get_database(&fx.conn, &fx.db).unwrap().unwrap();
        data.rows.into_iter().find(|r| r.page_id == row).unwrap().values.get(p).cloned()
    }

    #[test]
    fn legacy_properties_table_is_replaced() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        conn.execute_batch(
            "CREATE TABLE pages (id TEXT PRIMARY KEY, parent_id TEXT, created_at TEXT, updated_at TEXT);
             CREATE TABLE blocks (id TEXT PRIMARY KEY, page_id TEXT, parent_id TEXT, type TEXT, content TEXT,
                 position INTEGER, created_at TEXT, updated_at TEXT);
             CREATE TABLE properties (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, name TEXT NOT NULL,
                 type TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', position INTEGER NOT NULL DEFAULT 0,
                 created_at TEXT, updated_at TEXT);
             INSERT INTO properties (id, page_id, name, type) VALUES ('a', 'p', 'x', 'text');
             PRAGMA user_version = 4;",
        )
        .unwrap();
        db::run_migrations(&conn).unwrap();
        let has: bool = conn
            .prepare("SELECT 1 FROM pragma_table_info('properties') WHERE name = 'database_id'")
            .unwrap()
            .exists([])
            .unwrap();
        assert!(has);
    }

    #[test]
    fn rows_duplicate_with_their_cells_and_pages_have_favourites_and_info() {
        let fx = fixture();
        let note = prop(&fx, "Nota", "text", json!({}));
        let row = create_row(&fx.conn, &fx.db).unwrap();
        db::set_row_title(&fx.conn, &row.id, "Tarea").unwrap();
        set_value(&fx.conn, &row.id, &note, &json!("hola")).unwrap();
        let copy = duplicate_row(&fx.conn, &row.id).unwrap();
        assert_ne!(copy.id, row.id);
        assert_eq!(copy.title, "Tarea (copia)");
        assert_eq!(get(&fx, &copy.id, &note), Some(json!("hola")));
        assert_eq!(get(&fx, &row.id, &note), Some(json!("hola")), "the original is untouched");
        assert!(duplicate_row(&fx.conn, &fx.page).is_err(), "a database page is not a row");

        assert!(db::set_page_favorite(&fx.conn, &row.id, true).is_ok());
        let pages = db::list_pages(&fx.conn).unwrap();
        assert!(pages.iter().find(|p| p.id == row.id).unwrap().favorite);
        assert!(!pages.iter().find(|p| p.id == copy.id).unwrap().favorite);
        assert!(db::set_page_favorite(&fx.conn, "no-existe", true).is_err());

        let info = db::page_info(&fx.conn, &row.id).unwrap();
        assert_eq!(info.words, 1, "only the title: «Tarea»");
        assert!(db::page_info(&fx.conn, "no-existe").is_err());
    }

    #[test]
    fn status_properties_keep_their_options_in_groups() {
        let fx = fixture();
        let row = create_row(&fx.conn, &fx.db).unwrap().id;
        let status = prop(&fx, "Estado", "select", json!({ "status": true }));
        let get_prop = |id: &str| get_database(&fx.conn, &fx.db).unwrap().unwrap().properties.into_iter().find(|p| p.id == id).unwrap();
        let cfg = get_prop(&status).config;
        assert_eq!(cfg["options"], json!(["Sin empezar", "En curso", "Listo"]));
        assert_eq!(cfg["groups"], json!({ "Sin empezar": "todo", "En curso": "doing", "Listo": "done" }));
        assert_eq!(cfg["status"], json!(true));

        set_value(&fx.conn, &row, &status, &json!("En curso")).unwrap();
        // renaming moves the group with it, adding an option puts it in «todo», removing one drops its group
        rename_select_option(&fx.conn, &status, "En curso", "Haciendo").unwrap();
        assert_eq!(get_prop(&status).config["groups"]["Haciendo"], json!("doing"));
        assert_eq!(get(&fx, &row, &status), Some(json!("Haciendo")));
        set_select_options(&fx.conn, &status, &json!(["Sin empezar", "Haciendo", "Listo", "Revisión"])).unwrap();
        assert_eq!(get_prop(&status).config["groups"]["Revisión"], json!("todo"));
        set_option_group(&fx.conn, &status, "Revisión", "done").unwrap();
        assert_eq!(get_prop(&status).config["groups"]["Revisión"], json!("done"));
        set_select_options(&fx.conn, &status, &json!(["Sin empezar", "Haciendo", "Listo"])).unwrap();
        assert!(get_prop(&status).config["groups"].get("Revisión").is_none());
        set_option_color(&fx.conn, &status, "Listo", "purple").unwrap();
        assert_eq!(get_prop(&status).config["groups"]["Listo"], json!("done"), "recolouring keeps the groups");
        assert!(set_option_group(&fx.conn, &status, "Listo", "nunca").is_err());
        assert!(set_option_group(&fx.conn, &status, "Fantasma", "done").is_err());
        let plain = prop(&fx, "Tipo", "select", json!({ "options": ["a"] }));
        assert!(set_option_group(&fx.conn, &plain, "a", "done").is_err(), "only status properties have groups");

        // a plain select becomes a status (its options kept, in «todo») and back
        change_property_type(&fx.conn, &plain, "select", &json!({ "status": true })).unwrap();
        assert!(get_prop(&plain).config["status"] == json!(true));
        assert_eq!(get_prop(&plain).config["groups"]["a"], json!("todo"));
        change_property_type(&fx.conn, &plain, "select", &json!({})).unwrap();
        assert!(get_prop(&plain).config.get("status").is_none());
    }

    #[test]
    fn link_email_and_phone_texts_are_checked_and_icons_are_plain() {
        let fx = fixture();
        let row = create_row(&fx.conn, &fx.db).unwrap().id;
        let link = prop(&fx, "Web", "text", json!({ "format": "url" }));
        let mail = prop(&fx, "Correo", "text", json!({ "format": "email" }));
        let tel = prop(&fx, "Teléfono", "text", json!({ "format": "phone" }));
        let set = |p: &str, v: Value| set_value(&fx.conn, &row, p, &v);
        assert!(set(&link, json!("https://example.com/a?b=1")).is_ok());
        for bad in ["example.com", "javascript:alert(1)", "https://", "https:///x", "http://a b.com", "file:///etc/passwd"] {
            assert!(set(&link, json!(bad)).is_err(), "{bad}");
        }
        assert!(set(&mail, json!("ana@correo.es")).is_ok());
        for bad in ["ana", "@correo.es", "ana@correo", "a b@c.es", "ana@@c.es"] {
            assert!(set(&mail, json!(bad)).is_err(), "{bad}");
        }
        assert!(set(&tel, json!("+34 600 123 456")).is_ok());
        for bad in ["hola", "12", "6+00123", "<script>"] {
            assert!(set(&tel, json!(bad)).is_err(), "{bad}");
        }
        assert!(add_property(&fx.conn, &fx.db, "X", "text", &json!({ "format": "fax" })).is_err());

        // plain text → url keeps what fits and clears the rest; an unknown format is refused
        let note = prop(&fx, "Nota", "text", json!({}));
        set(&note, json!("https://a.es")).unwrap();
        change_property_type(&fx.conn, &note, "text", &json!({ "format": "url" })).unwrap();
        assert_eq!(get(&fx, &row, &note), Some(json!("https://a.es")));
        set(&note, json!("no es un enlace")).unwrap_err();
        assert!(change_property_type(&fx.conn, &note, "text", &json!({ "format": "fax" })).is_err());

        // icons: names and emoji pass, markup and blanks don't; clearing restores the type's own
        let data = || get_database(&fx.conn, &fx.db).unwrap().unwrap().properties.into_iter().find(|p| p.id == note).unwrap();
        set_property_icon(&fx.conn, &note, Some("Star")).unwrap();
        assert_eq!(data().icon.as_deref(), Some("Star"));
        set_property_icon(&fx.conn, &note, Some("🚀")).unwrap();
        for bad in ["<b>", "a b", "x\"y", &"a".repeat(33)] {
            assert!(set_property_icon(&fx.conn, &note, Some(bad)).is_err(), "{bad}");
        }
        assert_eq!(data().icon.as_deref(), Some("🚀"), "a refused icon changes nothing");
        let copy = duplicate_property(&fx.conn, &note).unwrap();
        assert_eq!(copy.icon.as_deref(), Some("🚀"));
        set_property_icon(&fx.conn, &note, None).unwrap();
        assert_eq!(data().icon, None);
    }

    #[test]
    fn scalar_values_are_type_checked() {
        let fx = fixture();
        let row = create_row(&fx.conn, &fx.db).unwrap().id;
        let text = prop(&fx, "Nota", "text", json!({}));
        let num = prop(&fx, "Precio", "number", json!({}));
        let date = prop(&fx, "Día", "date", json!({}));
        let sel = prop(&fx, "Estado", "select", json!({ "options": ["Hecho", "Pendiente"] }));
        let set = |p: &str, v: Value| set_value(&fx.conn, &row, p, &v);

        assert!(set(&text, json!("hola")).is_ok());
        assert!(set(&text, json!(5)).is_err());
        assert!(set(&num, json!(12.5)).is_ok());
        assert!(set(&num, json!("12")).is_err());
        assert!(set(&date, json!("2026-02-28")).is_ok());
        assert!(set(&date, json!("2026-02-30")).is_err());
        // ranges: both ends real, end not before start, a one-day range collapses
        assert!(set(&date, json!("2026-10-15/2026-10-20")).is_ok());
        assert_eq!(get(&fx, &row, &date), Some(json!("2026-10-15/2026-10-20")));
        assert!(set(&date, json!("2026-10-20/2026-10-15")).is_err());
        assert!(set(&date, json!("2026-10-15/2026-02-30")).is_err());
        assert!(set(&date, json!("2026-10-15/")).is_err());
        assert!(set(&date, json!("2026-10-15/2026-10-20/2026-10-25")).is_err());
        assert!(set(&date, json!("2026-10-15/2026-10-15")).is_ok());
        assert_eq!(get(&fx, &row, &date), Some(json!("2026-10-15")));
        assert!(set(&date, json!("2026-02-28")).is_ok());
        assert!(set(&date, json!("mañana")).is_err());
        assert!(set(&sel, json!("Hecho")).is_ok());
        assert!(set(&sel, json!("Otra")).is_err());

        // places: a label, coordinates (both or none, in range), nothing else
        let place = prop(&fx, "Dónde", "place", json!({}));
        assert!(set(&place, json!({ "name": " Plaza Mayor ", "lat": 40.4155, "lng": -3.7074 })).is_ok());
        assert_eq!(get(&fx, &row, &place), Some(json!({ "name": "Plaza Mayor", "lat": 40.4155, "lng": -3.7074 })));
        assert!(set(&place, json!({ "name": "Solo nombre" })).is_ok());
        assert_eq!(get(&fx, &row, &place), Some(json!({ "name": "Solo nombre" })));
        assert!(set(&place, json!({ "lat": 91.0, "lng": 0.0 })).is_err()); // latitude out of range
        assert!(set(&place, json!({ "lat": 10.0, "lng": 181.0 })).is_err());
        assert!(set(&place, json!({ "lat": 10.0 })).is_err()); // one coordinate alone
        assert!(set(&place, json!({ "lat": "10", "lng": "20" })).is_err()); // strings are not coordinates
        assert!(set(&place, json!({ "name": "x", "url": "y" })).is_err());
        assert!(set(&place, json!("Madrid")).is_err());
        assert!(set(&place, json!({ "name": "x".repeat(201) })).is_err());
        assert!(set(&place, json!({ "name": "  " })).is_ok()); // nothing left: clears
        assert_eq!(get(&fx, &row, &place), None);

        assert_eq!(get(&fx, &row, &num), Some(json!(12.5)));
        assert_eq!(get(&fx, &row, &date), Some(json!("2026-02-28")));
        set(&num, Value::Null).unwrap();
        assert_eq!(get(&fx, &row, &num), None);
    }

    #[test]
    fn values_only_for_rows_of_the_same_database() {
        let fx = fixture();
        let text = prop(&fx, "Nota", "text", json!({}));
        let loose = db::create_page(&fx.conn, None).unwrap().id; // a normal page, not a row
        assert!(set_value(&fx.conn, &loose, &text, &json!("x")).is_err());

        let other = new_db(&fx);
        let foreign_row = create_row(&fx.conn, &other).unwrap().id;
        assert!(set_value(&fx.conn, &foreign_row, &text, &json!("x")).is_err());
    }

    #[test]
    fn relations_stay_inside_the_target_database_and_do_not_dangle() {
        let fx = fixture();
        let other = new_db(&fx);
        let rel = add_property(&fx.conn, &fx.db, "Familia", "relation", &json!({ "target": other })).unwrap().id;
        assert!(add_property(&fx.conn, &fx.db, "Mala", "relation", &json!({ "target": uuid::Uuid::new_v4().to_string() })).is_err());

        let row = create_row(&fx.conn, &fx.db).unwrap().id;
        let a = create_row(&fx.conn, &other).unwrap().id;
        let b = create_row(&fx.conn, &other).unwrap().id;
        let own_row = create_row(&fx.conn, &fx.db).unwrap().id; // wrong database
        assert!(set_value(&fx.conn, &row, &rel, &json!([own_row])).is_err());
        assert!(set_value(&fx.conn, &row, &rel, &json!(["nope"])).is_err());
        assert!(set_value(&fx.conn, &row, &rel, &json!("x")).is_err());

        set_value(&fx.conn, &row, &rel, &json!([a, b, a])).unwrap();
        assert_eq!(get(&fx, &row, &rel), Some(json!([a, b])));

        db::delete_page(&fx.conn, &a).unwrap(); // deleting a target row removes the link
        assert_eq!(get(&fx, &row, &rel), Some(json!([b])));
        set_value(&fx.conn, &row, &rel, &json!([])).unwrap();
        assert_eq!(get(&fx, &row, &rel), None);
    }

    #[test]
    fn property_rules() {
        let fx = fixture();
        assert!(add_property(&fx.conn, &fx.db, "  ", "text", &json!({})).is_err());
        assert!(add_property(&fx.conn, &fx.db, "x", "formula", &json!({})).is_err());
        assert!(add_property(&fx.conn, &fx.db, "x", "select", &json!({ "options": ["a", "a"] })).is_err());
        assert!(add_property(&fx.conn, &uuid::Uuid::new_v4().to_string(), "x", "text", &json!({})).is_err());
        for i in 0..MAX_PROPERTIES {
            add_property(&fx.conn, &fx.db, &format!("p{i}"), "text", &json!({})).unwrap();
        }
        assert!(add_property(&fx.conn, &fx.db, "extra", "text", &json!({})).is_err());
    }

    #[test]
    fn removing_a_select_option_clears_its_values() {
        let fx = fixture();
        let sel = prop(&fx, "Estado", "select", json!({ "options": ["A", "B"] }));
        let (r1, r2) = (create_row(&fx.conn, &fx.db).unwrap().id, create_row(&fx.conn, &fx.db).unwrap().id);
        set_value(&fx.conn, &r1, &sel, &json!("A")).unwrap();
        set_value(&fx.conn, &r2, &sel, &json!("B")).unwrap();
        set_select_options(&fx.conn, &sel, &json!(["B", "C"])).unwrap();
        assert_eq!(get(&fx, &r1, &sel), None);
        assert_eq!(get(&fx, &r2, &sel), Some(json!("B")));
        let text = prop(&fx, "Nota", "text", json!({}));
        assert!(set_select_options(&fx.conn, &text, &json!(["x"])).is_err());
    }

    #[test]
    fn option_colours_follow_their_option() {
        let fx = fixture();
        let sel = prop(&fx, "Estado", "select", json!({ "options": ["A", "B"] }));
        let colors = |fx: &Fx| get_database(&fx.conn, &fx.db).unwrap().unwrap().properties[0].config.get("colors").cloned();
        set_option_color(&fx.conn, &sel, "A", "green").unwrap();
        assert_eq!(colors(&fx), Some(json!({ "A": "green" })));
        assert!(set_option_color(&fx.conn, &sel, "A", "fucsia").is_err()); // not a Notion colour
        assert!(set_option_color(&fx.conn, &sel, "Nope", "red").is_err()); // no such option
        let text = prop(&fx, "Nota", "text", json!({}));
        assert!(set_option_color(&fx.conn, &text, "A", "red").is_err());
        // renaming carries the colour; removing the option drops it
        rename_select_option(&fx.conn, &sel, "A", "Hecho").unwrap();
        assert_eq!(colors(&fx), Some(json!({ "Hecho": "green" })));
        set_select_options(&fx.conn, &sel, &json!(["Hecho", "B", "C"])).unwrap();
        assert_eq!(colors(&fx), Some(json!({ "Hecho": "green" })));
        set_select_options(&fx.conn, &sel, &json!(["B"])).unwrap();
        assert_eq!(colors(&fx), None);
    }

    #[test]
    fn duplicating_copies_type_values_and_links_right_after() {
        let fx = fixture();
        let other = new_db(&fx);
        let first = prop(&fx, "Estado", "select", json!({ "options": ["A"] }));
        let rel = add_property(&fx.conn, &fx.db, "Familia", "relation", &json!({ "target": other })).unwrap().id;
        let last = prop(&fx, "Nota", "text", json!({}));
        let row = create_row(&fx.conn, &fx.db).unwrap().id;
        let target = create_row(&fx.conn, &other).unwrap().id;
        set_value(&fx.conn, &row, &first, &json!("A")).unwrap();
        set_value(&fx.conn, &row, &rel, &json!([target])).unwrap();

        let copy = duplicate_property(&fx.conn, &first).unwrap();
        assert_eq!(copy.name, "Estado (copia)");
        assert_eq!(get(&fx, &row, &copy.id), Some(json!("A")));
        let rel_copy = duplicate_property(&fx.conn, &rel).unwrap();
        assert_eq!(get(&fx, &row, &rel_copy.id), Some(json!([target])));
        let order: Vec<String> = get_database(&fx.conn, &fx.db).unwrap().unwrap().properties.into_iter().map(|p| p.id).collect();
        assert_eq!(order, [first, copy.id.clone(), rel, rel_copy.id, last]);
        // the copy is independent
        set_value(&fx.conn, &row, &copy.id, &Value::Null).unwrap();
        assert_eq!(get(&fx, &row, &order[0]), Some(json!("A")));
    }

    #[test]
    fn changing_type_converts_values_through_text() {
        let fx = fixture();
        let p = prop(&fx, "Dato", "text", json!({}));
        let rows: Vec<String> = (0..4).map(|_| create_row(&fx.conn, &fx.db).unwrap().id).collect();
        for (row, v) in rows.iter().zip(["12", "7,25", "hola", "2026-10-15"]) {
            set_value(&fx.conn, row, &p, &json!(v)).unwrap();
        }
        // text -> number: what reads as a number survives, the rest is cleared
        change_property_type(&fx.conn, &p, "number", &json!({})).unwrap();
        let values: Vec<Option<Value>> = rows.iter().map(|r| get(&fx, r, &p)).collect();
        assert_eq!(values, [Some(json!(12.0)), Some(json!(7.25)), None, None]);
        // number -> select: one option per distinct value, in row order
        change_property_type(&fx.conn, &p, "select", &json!({})).unwrap();
        let data = get_database(&fx.conn, &fx.db).unwrap().unwrap();
        assert_eq!(data.properties[0].config, json!({ "options": ["12", "7.25"] }));
        assert_eq!(get(&fx, &rows[1], &p), Some(json!("7.25")));
        // select -> text -> date
        change_property_type(&fx.conn, &p, "text", &json!({})).unwrap();
        set_value(&fx.conn, &rows[3], &p, &json!("2026-10-15")).unwrap();
        change_property_type(&fx.conn, &p, "date", &json!({})).unwrap();
        assert_eq!(get(&fx, &rows[0], &p), None);
        assert_eq!(get(&fx, &rows[3], &p), Some(json!("2026-10-15")));
        // date -> place keeps the text as the place's label
        change_property_type(&fx.conn, &p, "place", &json!({})).unwrap();
        assert_eq!(get(&fx, &rows[3], &p), Some(json!({ "name": "2026-10-15" })));
        assert!(change_property_type(&fx.conn, &p, "formula", &json!({})).is_err());
    }

    #[test]
    fn a_checkbox_holds_true_or_nothing_and_a_select_becomes_one() {
        let fx = fixture();
        let done = prop(&fx, "Hecho", "checkbox", json!({}));
        let rows: Vec<String> = (0..3).map(|_| create_row(&fx.conn, &fx.db).unwrap().id).collect();
        // only booleans; checked reads back as true, unchecked is no value at all
        set_value(&fx.conn, &rows[0], &done, &json!(true)).unwrap();
        assert_eq!(get(&fx, &rows[0], &done), Some(json!(true)));
        assert!(set_value(&fx.conn, &rows[1], &done, &json!("sí")).is_err());
        assert!(set_value(&fx.conn, &rows[1], &done, &json!(1)).is_err());
        set_value(&fx.conn, &rows[0], &done, &json!(false)).unwrap();
        assert_eq!(get(&fx, &rows[0], &done), None);
        set_value(&fx.conn, &rows[0], &done, &json!(true)).unwrap();

        // a select becomes a checkbox: the options that read as «done» are checked, the rest are not
        let state = prop(&fx, "Estado", "select", json!({ "options": ["Pendiente", "En curso", "Completado"] }));
        for (row, v) in rows.iter().zip(["Completado", "Pendiente", "En curso"]) {
            set_value(&fx.conn, row, &state, &json!(v)).unwrap();
        }
        assert_eq!(marked_options(&["Pendiente".into(), "En curso".into(), "Completado".into()], &[]), ["Completado"]);
        change_property_type(&fx.conn, &state, "checkbox", &json!({})).unwrap();
        let values: Vec<Option<Value>> = rows.iter().map(|r| get(&fx, r, &state)).collect();
        assert_eq!(values, [Some(json!(true)), None, None]);
        // …or the options the user names
        let state2 = prop(&fx, "Fase", "select", json!({ "options": ["Pendiente", "En curso", "Completado"] }));
        for (row, v) in rows.iter().zip(["Completado", "Pendiente", "En curso"]) {
            set_value(&fx.conn, row, &state2, &json!(v)).unwrap();
        }
        change_property_type(&fx.conn, &state2, "checkbox", &json!({ "checked": ["en curso", "Completado"] })).unwrap();
        let values: Vec<Option<Value>> = rows.iter().map(|r| get(&fx, r, &state2)).collect();
        assert_eq!(values, [Some(json!(true)), None, Some(json!(true))]);
        // a checkbox goes back to text as «Sí»
        change_property_type(&fx.conn, &state2, "text", &json!({})).unwrap();
        assert_eq!(get(&fx, &rows[0], &state2), Some(json!("Sí")));
        assert_eq!(get(&fx, &rows[1], &state2), None);
        // what a text says about a box
        assert_eq!(truthy(" Sí "), Some(true));
        assert_eq!(truthy("desmarcada"), Some(false));
        assert_eq!(truthy("quizá"), None);
    }

    #[test]
    fn several_rows_change_together_or_not_at_all() {
        let fx = fixture();
        let done = prop(&fx, "Hecho", "checkbox", json!({}));
        let rows: Vec<String> = (0..3).map(|_| create_row(&fx.conn, &fx.db).unwrap().id).collect();
        set_values(&fx.conn, &rows, &done, &json!(true)).unwrap();
        assert!(rows.iter().all(|r| get(&fx, r, &done) == Some(json!(true))));
        set_values(&fx.conn, &rows[..2], &done, &json!(false)).unwrap();
        let now: Vec<Option<Value>> = rows.iter().map(|r| get(&fx, r, &done)).collect();
        assert_eq!(now, [None, None, Some(json!(true))]);
        // a bad value, a row of another database or a relation changes nothing
        assert!(set_values(&fx.conn, &rows, &done, &json!("sí")).is_err());
        let other = new_db(&fx);
        let stranger = create_row(&fx.conn, &other).unwrap().id;
        assert!(set_values(&fx.conn, &[rows[0].clone(), stranger], &done, &json!(true)).is_err());
        assert_eq!(get(&fx, &rows[0], &done), None);
        let rel = add_property(&fx.conn, &fx.db, "Rel", "relation", &json!({ "target": other })).unwrap().id;
        assert!(set_values(&fx.conn, &rows, &rel, &json!([])).is_err());
    }

    #[test]
    fn a_relation_becomes_its_titles_and_filters_on_it_go() {
        let fx = fixture();
        let other = new_db(&fx);
        let rel = add_property(&fx.conn, &fx.db, "Familia", "relation", &json!({ "target": other })).unwrap().id;
        let row = create_row(&fx.conn, &fx.db).unwrap().id;
        let (a, b) = (create_row(&fx.conn, &other).unwrap().id, create_row(&fx.conn, &other).unwrap().id);
        db::set_row_title(&fx.conn, &a, "Ana").unwrap();
        db::set_row_title(&fx.conn, &b, "Bea").unwrap();
        set_value(&fx.conn, &row, &rel, &json!([a, b])).unwrap();
        let view = get_database(&fx.conn, &fx.db).unwrap().unwrap().views[0].id.clone();
        let filtered = json!({ "filter": { "rules": [{ "property": rel, "operator": "contains", "value": a }] }, "sorts": [{ "property": rel, "direction": "asc" }] });
        views::update_view_config(&fx.conn, &view, &filtered).unwrap();

        change_property_type(&fx.conn, &rel, "text", &json!({})).unwrap();
        assert_eq!(get(&fx, &row, &rel), Some(json!("Ana, Bea")));
        let config = &get_database(&fx.conn, &fx.db).unwrap().unwrap().views[0].config;
        assert_eq!(config["filter"]["rules"], json!([])); // a relation filter means nothing for text
        assert_eq!(config["sorts"][0]["property"], json!(rel)); // sorting still does
                                                                // to a relation: needs a target, and no text can become a link
        assert!(change_property_type(&fx.conn, &rel, "relation", &json!({})).is_err());
        change_property_type(&fx.conn, &rel, "relation", &json!({ "target": other })).unwrap();
        assert_eq!(get(&fx, &row, &rel), None);
    }

    #[test]
    fn renaming_an_option_rewrites_its_values() {
        let fx = fixture();
        let sel = prop(&fx, "Estado", "select", json!({ "options": ["A", "B"] }));
        let (r1, r2) = (create_row(&fx.conn, &fx.db).unwrap().id, create_row(&fx.conn, &fx.db).unwrap().id);
        set_value(&fx.conn, &r1, &sel, &json!("A")).unwrap();
        set_value(&fx.conn, &r2, &sel, &json!("B")).unwrap();

        rename_select_option(&fx.conn, &sel, "A", "Hecho").unwrap();
        assert_eq!(get(&fx, &r1, &sel), Some(json!("Hecho")));
        assert_eq!(get(&fx, &r2, &sel), Some(json!("B")));
        let data = get_database(&fx.conn, &fx.db).unwrap().unwrap();
        assert_eq!(data.properties[0].config["options"], json!(["Hecho", "B"])); // position kept
                                                                                 // the renamed option is selectable, the old name no longer is
        assert!(set_value(&fx.conn, &r2, &sel, &json!("Hecho")).is_ok());
        assert!(set_value(&fx.conn, &r2, &sel, &json!("A")).is_err());

        assert!(rename_select_option(&fx.conn, &sel, "Hecho", "B").is_err()); // duplicate
        assert!(rename_select_option(&fx.conn, &sel, "Nope", "X").is_err()); // unknown
        assert!(rename_select_option(&fx.conn, &sel, "B", "  ").is_err());
        let text = prop(&fx, "Nota", "text", json!({}));
        assert!(rename_select_option(&fx.conn, &text, "a", "b").is_err());
    }

    #[test]
    fn tags_hold_a_list_of_the_options_and_nothing_else() {
        let fx = fixture();
        let tags = prop(&fx, "Categorías", "tags", json!({ "options": ["Casa", "Trabajo", "Estudio"] }));
        let row = create_row(&fx.conn, &fx.db).unwrap().id;
        set_value(&fx.conn, &row, &tags, &json!(["Trabajo", "Casa", "Trabajo"])).unwrap();
        assert_eq!(get(&fx, &row, &tags), Some(json!(["Trabajo", "Casa"])), "no repeats, the order given");

        // what is not a list of the property's options is rejected and the cell is left as it was
        for bad in [json!("Casa"), json!(["Gimnasio"]), json!(["Casa", 3]), json!(5), json!(true), json!({ "a": 1 })] {
            assert!(set_value(&fx.conn, &row, &tags, &bad).is_err(), "{bad}");
        }
        assert_eq!(get(&fx, &row, &tags), Some(json!(["Trabajo", "Casa"])));
        // a cell never holds more than MAX_TAGS: more options than that is the only way to try
        let many: Vec<String> = (0..MAX_TAGS + 1).map(|i| format!("t{i}")).collect();
        let big = prop(&fx, "Muchas", "tags", json!({ "options": many }));
        assert!(set_value(&fx.conn, &row, &big, &json!(many)).is_err());
        assert!(set_value(&fx.conn, &row, &big, &json!(&many[..MAX_TAGS])).is_ok());

        // an empty list or null clears it; the check without writing agrees with the write
        assert!(check_value(&fx.conn, &row, &tags, &json!(["Casa"])).is_ok());
        assert!(check_value(&fx.conn, &row, &tags, &json!(["Nada"])).is_err());
        set_value(&fx.conn, &row, &tags, &json!([])).unwrap();
        assert_eq!(get(&fx, &row, &tags), None);
        set_value(&fx.conn, &row, &tags, &json!(["Casa"])).unwrap();
        set_value(&fx.conn, &row, &tags, &Value::Null).unwrap();
        assert_eq!(get(&fx, &row, &tags), None);
        // several rows at once, all or nothing
        let other = create_row(&fx.conn, &fx.db).unwrap().id;
        set_values(&fx.conn, &[row.clone(), other.clone()], &tags, &json!(["Estudio"])).unwrap();
        assert_eq!(get(&fx, &other, &tags), Some(json!(["Estudio"])));
        assert!(set_values(&fx.conn, std::slice::from_ref(&row), &tags, &json!(["Nada"])).is_err());
    }

    #[test]
    fn options_of_tags_can_be_removed_renamed_and_coloured_with_the_cells_following() {
        let fx = fixture();
        let tags = prop(&fx, "Categorías", "tags", json!({ "options": ["A", "B", "C"] }));
        let (r1, r2) = (create_row(&fx.conn, &fx.db).unwrap().id, create_row(&fx.conn, &fx.db).unwrap().id);
        set_value(&fx.conn, &r1, &tags, &json!(["A", "B"])).unwrap();
        set_value(&fx.conn, &r2, &tags, &json!(["C"])).unwrap();

        rename_select_option(&fx.conn, &tags, "B", "Beta").unwrap();
        assert_eq!(get(&fx, &r1, &tags), Some(json!(["A", "Beta"])));
        assert_eq!(get(&fx, &r2, &tags), Some(json!(["C"])));
        assert!(rename_select_option(&fx.conn, &tags, "Beta", "A").is_err()); // duplicate

        set_option_color(&fx.conn, &tags, "Beta", "red").unwrap();
        rename_select_option(&fx.conn, &tags, "Beta", "Gamma").unwrap();
        let config = &get_database(&fx.conn, &fx.db).unwrap().unwrap().properties[0].config;
        assert_eq!(config["colors"]["Gamma"], "red", "the colour follows the rename");

        // removing an option takes just that tag off the cells; a cell left with none is cleared
        set_select_options(&fx.conn, &tags, &json!(["A", "C"])).unwrap();
        assert_eq!(get(&fx, &r1, &tags), Some(json!(["A"])));
        assert_eq!(get(&fx, &r2, &tags), Some(json!(["C"])));
        set_select_options(&fx.conn, &tags, &json!(["A"])).unwrap();
        assert_eq!(get(&fx, &r2, &tags), None);
        // a text property still has no options
        let text = prop(&fx, "Nota", "text", json!({}));
        assert!(set_select_options(&fx.conn, &text, &json!(["x"])).is_err());
        assert!(set_option_color(&fx.conn, &text, "x", "red").is_err());
    }

    #[test]
    fn tags_convert_to_and_from_other_types_through_text() {
        let fx = fixture();
        let text = prop(&fx, "Texto", "text", json!({}));
        let (r1, r2, r3) = (
            create_row(&fx.conn, &fx.db).unwrap().id,
            create_row(&fx.conn, &fx.db).unwrap().id,
            create_row(&fx.conn, &fx.db).unwrap().id,
        );
        set_value(&fx.conn, &r1, &text, &json!("casa, trabajo")).unwrap();
        set_value(&fx.conn, &r2, &text, &json!("trabajo")).unwrap();

        // text -> tags: the comma separated pieces, one option for each distinct one
        change_property_type(&fx.conn, &text, "tags", &json!({})).unwrap();
        let data = get_database(&fx.conn, &fx.db).unwrap().unwrap();
        assert_eq!(data.properties[0].config["options"], json!(["casa", "trabajo"]));
        assert_eq!(get(&fx, &r1, &text), Some(json!(["casa", "trabajo"])));
        assert_eq!(get(&fx, &r2, &text), Some(json!(["trabajo"])));
        assert_eq!(get(&fx, &r3, &text), None);

        // tags -> select keeps the first tag; tags -> text reads them comma separated
        let dup = duplicate_property(&fx.conn, &text).unwrap().id;
        change_property_type(&fx.conn, &dup, "select", &json!({})).unwrap();
        assert_eq!(get(&fx, &r1, &dup), Some(json!("casa")));
        change_property_type(&fx.conn, &text, "text", &json!({})).unwrap();
        assert_eq!(get(&fx, &r1, &text), Some(json!("casa, trabajo")));
        // select -> tags
        change_property_type(&fx.conn, &dup, "tags", &json!({})).unwrap();
        assert_eq!(get(&fx, &r1, &dup), Some(json!(["casa"])));
    }

    #[test]
    fn properties_can_be_reordered_only_with_the_exact_set() {
        let fx = fixture();
        let a = prop(&fx, "A", "text", json!({}));
        let b = prop(&fx, "B", "number", json!({}));
        let c = prop(&fx, "C", "date", json!({}));
        let names = |fx: &Fx| -> Vec<String> { get_database(&fx.conn, &fx.db).unwrap().unwrap().properties.into_iter().map(|p| p.name).collect() };
        assert_eq!(names(&fx), ["A", "B", "C"]);

        reorder_properties(&fx.conn, &fx.db, &[c.clone(), a.clone(), b.clone()]).unwrap();
        assert_eq!(names(&fx), ["C", "A", "B"]);
        // new properties still go last
        prop(&fx, "D", "text", json!({}));
        assert_eq!(names(&fx), ["C", "A", "B", "D"]);

        assert!(reorder_properties(&fx.conn, &fx.db, &[a.clone(), b.clone()]).is_err()); // missing
        assert!(reorder_properties(&fx.conn, &fx.db, &[a.clone(), a.clone(), b.clone(), c.clone()]).is_err()); // dup
        assert!(reorder_properties(&fx.conn, &fx.db, &[a.clone(), b.clone(), c.clone(), uuid::Uuid::new_v4().to_string()]).is_err()); // foreign
        assert_eq!(names(&fx), ["C", "A", "B", "D"]); // rejected calls change nothing
    }

    #[test]
    fn rows_can_be_reordered_only_with_the_exact_set_and_new_rows_go_last() {
        let fx = fixture();
        let a = create_row(&fx.conn, &fx.db).unwrap().id;
        let b = create_row(&fx.conn, &fx.db).unwrap().id;
        let c = create_row(&fx.conn, &fx.db).unwrap().id;
        let order = |fx: &Fx| -> Vec<String> { get_database(&fx.conn, &fx.db).unwrap().unwrap().rows.into_iter().map(|r| r.page_id).collect() };
        assert_eq!(order(&fx), [a.clone(), b.clone(), c.clone()]); // creation order until someone drags

        reorder_rows(&fx.conn, &fx.db, &[c.clone(), a.clone(), b.clone()]).unwrap();
        assert_eq!(order(&fx), [c.clone(), a.clone(), b.clone()]);
        let d = create_row(&fx.conn, &fx.db).unwrap().id;
        assert_eq!(order(&fx), [c.clone(), a.clone(), b.clone(), d.clone()]);

        assert!(reorder_rows(&fx.conn, &fx.db, &[a.clone(), b.clone(), c.clone()]).is_err()); // missing one
        assert!(reorder_rows(&fx.conn, &fx.db, &[a.clone(), a.clone(), b.clone(), c.clone(), d.clone()]).is_err()); // dup
        assert!(reorder_rows(&fx.conn, &fx.db, &[a.clone(), b.clone(), c.clone(), uuid::Uuid::new_v4().to_string()]).is_err()); // foreign
        assert!(reorder_rows(&fx.conn, "not-a-uuid", &[]).is_err());
        assert_eq!(order(&fx), [c, a, b, d]); // rejected calls change nothing
    }

    #[test]
    fn a_row_title_is_its_first_heading() {
        let fx = fixture();
        let row = create_row(&fx.conn, &fx.db).unwrap().id;
        // body content must survive a title change
        let doc = json!({ "type": "doc", "content": [
            { "type": "heading", "attrs": { "level": 1 } },
            { "type": "paragraph", "content": [{ "type": "text", "text": "cuerpo" }] }] });
        db::save_page_content(&fx.conn, &row, &doc).unwrap();

        db::set_row_title(&fx.conn, &row, "  Informe  ").unwrap();
        let title = |fx: &Fx| get_database(&fx.conn, &fx.db).unwrap().unwrap().rows[0].title.clone();
        assert_eq!(title(&fx), "Informe");
        let saved = db::get_page_content(&fx.conn, &row).unwrap().unwrap();
        assert_eq!(saved["content"][1]["content"][0]["text"], "cuerpo");

        db::set_row_title(&fx.conn, &row, "").unwrap();
        assert_eq!(title(&fx), "Sin título");
        assert!(db::set_row_title(&fx.conn, &row, &"x".repeat(201)).is_err());
        // not a row: the database page itself, an ordinary page
        assert!(db::set_row_title(&fx.conn, &fx.page, "x").is_err());
        let plain = db::create_page(&fx.conn, None).unwrap().id;
        assert!(db::set_row_title(&fx.conn, &plain, "x").is_err());
    }

    #[test]
    fn deleting_the_database_page_or_a_property_cascades() {
        let fx = fixture();
        let text = prop(&fx, "Nota", "text", json!({}));
        let row = create_row(&fx.conn, &fx.db).unwrap().id;
        set_value(&fx.conn, &row, &text, &json!("x")).unwrap();
        delete_property(&fx.conn, &text).unwrap();
        assert!(get_database(&fx.conn, &fx.db).unwrap().unwrap().rows[0].values.is_empty());

        db::delete_page(&fx.conn, &fx.page).unwrap();
        assert!(get_database(&fx.conn, &fx.db).unwrap().is_none());
        let pages: i64 = fx.conn.query_row("SELECT COUNT(*) FROM pages", [], |r| r.get(0)).unwrap();
        assert_eq!(pages, 0); // the row page went with its database
    }

    #[test]
    fn database_pages_are_root_level_pages_of_their_own_kind() {
        let fx = fixture();
        let pages = db::list_pages(&fx.conn).unwrap();
        let p = pages.iter().find(|p| p.id == fx.page).unwrap();
        assert_eq!((p.kind.as_str(), p.parent_id.as_deref()), ("database", None));
        assert_eq!(p.own_database_id.as_deref(), Some(fx.db.as_str()));

        let row = create_row(&fx.conn, &fx.db).unwrap();
        assert_eq!((row.parent_id.as_deref(), row.kind.as_str()), (Some(fx.page.as_str()), "page"));

        // the name is the page's title
        let title = json!({ "type": "heading", "attrs": { "level": 1 }, "content": [{ "type": "text", "text": "Tareas" }] });
        db::save_page_content(&fx.conn, &fx.page, &json!({ "type": "doc", "content": [title.clone()] })).unwrap();
        assert_eq!(get_database(&fx.conn, &fx.db).unwrap().unwrap().name, "Tareas");
        assert_eq!(list_databases(&fx.conn).unwrap()[0].name, "Tareas");

        // its document can only be the title
        let extra = json!({ "type": "doc", "content": [title, { "type": "paragraph" }] });
        assert!(db::save_page_content(&fx.conn, &fx.page, &extra).is_err());
        let view = json!({ "type": "database", "attrs": { "databaseId": fx.db } });
        assert!(db::save_page_content(&fx.conn, &fx.page, &json!({ "type": "doc", "content": [view] })).is_err());
    }

    #[test]
    fn migration_turns_v5_databases_into_root_database_pages() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        const DB: &str = "3f0c2a9e-6b1d-4c1a-9d7e-2b8f5a1c4e60";
        const PROP: &str = "9a1e7c52-0d3b-4f6a-8b2e-5c4d3e2f1a0b";
        db::run_migrations_up_to(&conn, 5).unwrap();

        // v5 data: a database named "Tareas" hosted by an ordinary page, with a property and a row.
        let host = "host".to_string();
        conn.execute("INSERT INTO pages (id) VALUES ('host')", []).unwrap();
        conn.execute(
            "INSERT INTO databases (id, page_id, name) VALUES ('3f0c2a9e-6b1d-4c1a-9d7e-2b8f5a1c4e60', ?1, 'Tareas')",
            [&host],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO properties (id, database_id, name, type) VALUES ('9a1e7c52-0d3b-4f6a-8b2e-5c4d3e2f1a0b', '3f0c2a9e-6b1d-4c1a-9d7e-2b8f5a1c4e60', 'Nota', 'text')",
            [],
        )
        .unwrap();
        let row = "row1".to_string();
        conn.execute(
            "INSERT INTO pages (id, parent_id, database_id) VALUES ('row1', 'host', '3f0c2a9e-6b1d-4c1a-9d7e-2b8f5a1c4e60')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO property_values (page_id, property_id, value) VALUES (?1, '9a1e7c52-0d3b-4f6a-8b2e-5c4d3e2f1a0b', 'hola')",
            [&row],
        )
        .unwrap();

        db::run_migrations(&conn).unwrap();

        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert!(version >= 8, "migrated past the version under test");
        assert_eq!(views::list_views(&conn, DB).unwrap().len(), 1); // the existing database got its default view
        let data = get_database(&conn, DB).unwrap().unwrap();
        assert_eq!(data.name, "Tareas");
        assert_ne!(data.page_id, host); // owned by a new page, not the host
        let kind_parent: (String, Option<String>) = conn
            .query_row("SELECT kind, parent_id FROM pages WHERE id = ?1", [&data.page_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(kind_parent, ("database".to_string(), None));
        let row_parent: String = conn.query_row("SELECT parent_id FROM pages WHERE id = ?1", [&row], |r| r.get(0)).unwrap();
        assert_eq!(row_parent, data.page_id);
        assert_eq!(data.rows[0].values.get(PROP), Some(&json!("hola")));
        // the host page is untouched and keeps being an ordinary page
        let host_kind: String = conn.query_row("SELECT kind FROM pages WHERE id = ?1", [&host], |r| r.get(0)).unwrap();
        assert_eq!(host_kind, "page");
    }
    #[test]
    fn rebuilding_properties_for_place_keeps_every_value_and_relation() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        db::run_migrations_up_to(&conn, 7).unwrap();

        // databases as the v7 schema had them (no `role` column yet)
        let old_database = || {
            let page = db::insert_page(&conn, None, None, "database").unwrap();
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute("INSERT INTO databases (id, page_id) VALUES (?1, ?2)", [&id, &page.id]).unwrap();
            views::create_default_view(&conn, &id).unwrap();
            id
        };
        let (a, b) = (old_database(), old_database());
        let note = add_property(&conn, &a, "Nota", "text", &json!({})).unwrap().id;
        let rel = add_property(&conn, &a, "Rel", "relation", &json!({ "target": b })).unwrap().id;
        let (row, target) = (create_row(&conn, &a).unwrap().id, create_row(&conn, &b).unwrap().id);
        set_value(&conn, &row, &note, &json!("hola")).unwrap();
        set_value(&conn, &row, &rel, &json!([target])).unwrap();
        // at v7 the CHECK still refuses a new kind
        assert!(conn
            .execute("INSERT INTO properties (id, database_id, name, type) VALUES ('x', ?1, 'x', 'place')", [&a])
            .is_err());

        db::run_migrations(&conn).unwrap();

        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert!(version >= 8, "migrated past the version under test");
        let data = get_database(&conn, &a).unwrap().unwrap();
        assert_eq!(data.properties.len(), 2);
        assert_eq!(data.rows[0].values.get(&note), Some(&json!("hola"))); // child tables survived the DROP
        assert_eq!(data.rows[0].values.get(&rel), Some(&json!([target])));
        let fk_errors: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
        assert_eq!(fk_errors, 0);
        let fk_on: bool = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert!(fk_on); // switched back on
        assert!(add_property(&conn, &a, "Dónde", "place", &json!({})).is_ok());
        // cascades still work from the rebuilt table
        delete_property(&conn, &note).unwrap();
        assert!(get_database(&conn, &a).unwrap().unwrap().rows[0].values.get(&note).is_none());
    }
}
