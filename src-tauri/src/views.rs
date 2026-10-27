//! saved views of a database: a name, a kind (only `table` so far)
//! and a config with sort, filter and group rules. The config is typed (serde)
//! and checked against the database's real schema on every write; evaluation
//! runs here over the rows already loaded — nothing the client or the future
//! AI layer sends ever becomes SQL.

use crate::databases::{self, split_date_range, DatabaseData, RowInfo};
use crate::db::{derive_page_title, is_valid_iso_date, PageSummary};
use crate::validate::is_uuid;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};

/// Not a SQL CHECK: new kinds keep arriving (2.8.3+) and SQLite can't alter a
/// CHECK without rebuilding the table.
pub const VIEW_KINDS: [&str; 11] = ["table", "list", "gallery", "feed", "board", "calendar", "timeline", "map", "form", "chart", "dashboard"];
const MAX_WIDGETS: usize = 12;
/// A chart draws at most this many points; the client is told how many there were.
const MAX_CHART_POINTS: usize = 100;
const MAX_FORM_FIELDS: usize = 31;
const MAX_HIDDEN: usize = 30;
const MIN_COLUMN_WIDTH: u32 = 60;
const MAX_COLUMN_WIDTH: u32 = 1000;
/// Characters of page text a gallery/feed card previews.
const SNIPPET_CHARS: usize = 200;
const MAX_VIEWS: i64 = 20;
const MAX_SORTS: usize = 10;
const MAX_FILTERS: usize = 20;
const MAX_TEXT: usize = 2_000;
/// Pseudo-property: the row's own title.
const TITLE: &str = "title";
const NO_VALUE: &str = "Sin valor";

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Asc,
    Desc,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum BoolOp {
    #[default]
    And,
    Or,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Operator {
    Contains,
    NotContains,
    Is,
    IsNot,
    IsEmpty,
    IsNotEmpty,
    Eq,
    Neq,
    Gt,
    Gte,
    Lt,
    Lte,
    Before,
    After,
    OnOrBefore,
    OnOrAfter,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Granularity {
    Day,
    Week,
    Month,
    Year,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct SortRule {
    pub property: String,
    pub direction: Direction,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct FilterRule {
    pub property: String,
    pub operator: Operator,
    /// `None` on a rule that needs one = the rule is still being filled in and is ignored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct FilterGroup {
    #[serde(default)]
    pub op: BoolOp,
    #[serde(default)]
    pub rules: Vec<FilterRule>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupRule {
    pub property: String,
    /// Dates only; month when omitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub granularity: Option<Granularity>,
    /// Hides select options with no rows.
    #[serde(default)]
    pub hide_empty: bool,
}

/// One question of a form view: a property of the database (or the row `title`).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormField {
    pub property: String,
    /// The question's text; the property's name when omitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// A line of help under the question.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
    #[serde(default)]
    pub required: bool,
}

/// A form view, like Notion's: it creates rows. Without `fields` the form asks
/// for the title (required) and every property, in order.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<Vec<FormField>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submit_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success_message: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum ChartType {
    /// One big number: the aggregate over every row.
    Number,
    Donut,
    #[default]
    Bar,
    /// Horizontal bars.
    Hbar,
    Line,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum Aggregate {
    #[default]
    Count,
    Sum,
    Avg,
    Min,
    Max,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum ChartSort {
    /// The groups' own order (options, dates, numbers…).
    #[default]
    X,
    Asc,
    Desc,
}

/// A chart view, like Notion's: the X axis is the view's group (`config.group`),
/// the Y axis an aggregate of the rows in each group.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct ChartConfig {
    #[serde(default, rename = "type")]
    pub chart_type: ChartType,
    #[serde(default)]
    pub aggregate: Aggregate,
    /// The number property sum/avg/min/max work on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default)]
    pub sort: ChartSort,
}

/// One tile of a dashboard: a chart or a number with its own X axis, calculation and filter.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct DashboardWidget {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default)]
    pub chart: ChartConfig,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<GroupRule>,
    #[serde(default)]
    pub filter: FilterGroup,
    /// Takes the whole row instead of half of it.
    #[serde(default)]
    pub wide: bool,
}

/// A dashboard view: widgets in order. The view's own filter narrows the rows every widget sees.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct DashboardConfig {
    #[serde(default)]
    pub widgets: Vec<DashboardWidget>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct ViewConfig {
    #[serde(default)]
    pub sorts: Vec<SortRule>,
    #[serde(default)]
    pub filter: FilterGroup,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<GroupRule>,
    /// Property ids hidden from this view's columns / card fields. Hidden rather than visible so a new property shows up everywhere by default.
    #[serde(default, rename = "hiddenProperties", skip_serializing_if = "Option::is_none")]
    pub hidden_properties: Option<Vec<String>>,
    /// Gallery/feed: show the row page's first image and a text snippet. On unless set to false.
    #[serde(default, rename = "showPreview", skip_serializing_if = "Option::is_none")]
    pub show_preview: Option<bool>,
    /// Calendar/timeline: the date property the view is laid out by (a range for a timeline bar).
    #[serde(default, rename = "dateProperty", skip_serializing_if = "Option::is_none")]
    pub date_property: Option<String>,
    /// Map: the place property whose coordinates become pins (unset = the first one).
    #[serde(default, rename = "placeProperty", skip_serializing_if = "Option::is_none")]
    pub place_property: Option<String>,
    /// Form views only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub form: Option<FormConfig>,
    /// Chart views only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chart: Option<ChartConfig>,
    /// Dashboard views only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dashboard: Option<DashboardConfig>,
    /// Table (and form answers) columns resized by hand: px by property id or "title". Others use the default width.
    #[serde(default, rename = "columnWidths", skip_serializing_if = "Option::is_none")]
    pub column_widths: Option<BTreeMap<String, u32>>,
    /// Table footer: one calculation per column (property id or "title"), like Notion's «Calcular».
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calculations: Option<BTreeMap<String, Calc>>,
    /// Table: columns from the left up to and including this one stay in place while scrolling sideways («Fijar»).
    #[serde(default, rename = "frozenUpTo", skip_serializing_if = "Option::is_none")]
    pub frozen_up_to: Option<String>,
    /// Table: columns whose content wraps onto several lines instead of being cut («Ajustar contenido»).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrapped: Option<Vec<String>>,
}

/// A column calculation. The table computes it over the rows the view shows; Rust only
/// checks it fits the column's type (sums need numbers, earliest/latest need dates).
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Calc {
    CountAll,
    CountValues,
    CountEmpty,
    CountUnique,
    PercentEmpty,
    PercentNotEmpty,
    Sum,
    Avg,
    Median,
    Min,
    Max,
    Range,
    Earliest,
    Latest,
}

#[derive(Serialize)]
pub struct ViewInfo {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub config: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewGroup {
    pub key: String,
    pub label: String,
    pub row_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewResult {
    /// Filtered and sorted rows (all of them, even when grouped).
    pub row_ids: Vec<String>,
    pub groups: Option<Vec<ViewGroup>>,
    /// Gallery/feed only: row id -> what its page shows on a card.
    pub previews: Option<HashMap<String, RowPreview>>,
    /// Chart views only: what to draw.
    pub chart: Option<ChartResult>,
    /// Dashboard views only: what each widget draws, in the widgets' order.
    pub widgets: Option<Vec<ChartResult>>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct ChartPoint {
    pub key: String,
    pub label: String,
    /// `None` when the group has no numbers to aggregate.
    pub value: Option<f64>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct ChartResult {
    pub points: Vec<ChartPoint>,
    /// Points before the cap (`MAX_CHART_POINTS`).
    pub total: usize,
}

/// What a card previews of a row's page: its first image and the start of its text.
#[derive(Serialize, Default, Debug, PartialEq)]
pub struct RowPreview {
    /// An attachment file name (`<uuid>.<ext>`), already checked as a valid one.
    pub image: Option<String>,
    pub snippet: String,
}

fn sql<E: ToString>(e: E) -> String {
    e.to_string()
}

pub fn operators_for(kind: &str) -> &'static [Operator] {
    use Operator::*;
    match kind {
        "text" => &[Contains, NotContains, Is, IsNot, IsEmpty, IsNotEmpty],
        "number" => &[Eq, Neq, Gt, Gte, Lt, Lte, IsEmpty, IsNotEmpty],
        "date" => &[Is, Before, After, OnOrBefore, OnOrAfter, IsEmpty, IsNotEmpty],
        "select" => &[Is, IsNot, IsEmpty, IsNotEmpty],
        "relation" => &[Contains, NotContains, IsEmpty, IsNotEmpty],
        // «contiene la etiqueta X»
        "tags" => &[Contains, NotContains, IsEmpty, IsNotEmpty],
        // a place filters by its label
        "place" => &[Contains, NotContains, IsEmpty, IsNotEmpty],
        // «es» marcada / sin marcar (the value is a boolean)
        "checkbox" => &[Is],
        _ => &[],
    }
}

fn needs_value(op: Operator) -> bool {
    !matches!(op, Operator::IsEmpty | Operator::IsNotEmpty)
}

// ---------------------------------------------------------------- validation

/// property id (or `title`) -> kind, for the database the view belongs to.
type Schema = HashMap<String, String>;

fn load_schema(conn: &Connection, database_id: &str) -> Result<Schema, String> {
    let mut stmt = conn.prepare("SELECT id, type FROM properties WHERE database_id = ?1").map_err(sql)?;
    let rows = stmt.query_map([database_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(sql)?;
    let mut schema: Schema = rows.collect::<rusqlite::Result<_>>().map_err(sql)?;
    schema.insert(TITLE.to_string(), "text".to_string());
    Ok(schema)
}

fn check_value(kind: &str, value: &Value) -> Result<(), String> {
    let ok = match kind {
        "text" => value.as_str().is_some_and(|s| s.chars().count() <= MAX_TEXT),
        "number" => value.as_f64().is_some_and(f64::is_finite),
        "date" => value.as_str().is_some_and(is_valid_iso_date),
        "select" | "tags" => value.as_str().is_some_and(|s| s.chars().count() <= 60),
        "place" => value.as_str().is_some_and(|s| s.chars().count() <= MAX_TEXT),
        "relation" => value.as_str().is_some_and(is_uuid),
        "checkbox" => value.is_boolean(),
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err(format!("El valor del filtro no es válido para una propiedad de tipo {kind}"))
    }
}

pub fn parse_config(raw: &Value) -> Result<ViewConfig, String> {
    serde_json::from_value(raw.clone()).map_err(|e| format!("Configuración de vista no válida: {e}"))
}

pub fn validate_config(config: &ViewConfig, schema: &Schema, view_kind: &str) -> Result<(), String> {
    if config.sorts.len() > MAX_SORTS {
        return Err(format!("Máximo {MAX_SORTS} reglas de orden"));
    }
    for rule in &config.sorts {
        if !schema.contains_key(&rule.property) {
            return Err("Se ordena por una propiedad que no existe".to_string());
        }
    }
    if config.filter.rules.len() > MAX_FILTERS {
        return Err(format!("Máximo {MAX_FILTERS} filtros"));
    }
    for rule in &config.filter.rules {
        let kind = schema.get(&rule.property).ok_or("Se filtra por una propiedad que no existe")?;
        if !operators_for(kind).contains(&rule.operator) {
            return Err(format!("El operador {:?} no se puede usar con una propiedad de tipo {kind}", rule.operator));
        }
        match (&rule.value, needs_value(rule.operator)) {
            (Some(v), true) => check_value(kind, v)?,
            (Some(_), false) => return Err("Este operador no lleva valor".to_string()),
            (None, _) => {}
        }
    }
    if let Some(group) = &config.group {
        let kind = match schema.get(&group.property) {
            Some(k) if group.property != TITLE => k,
            _ => return Err("No se puede agrupar por esa propiedad".to_string()),
        };
        if group.granularity.is_some() && kind != "date" {
            return Err("La granularidad solo se aplica a fechas".to_string());
        }
        // a board's columns are the options of a select (cards move by changing that value)
        if view_kind == "board" && kind != "select" {
            return Err("Un tablero solo se puede agrupar por una propiedad de selección".to_string());
        }
    }
    if let Some(date) = &config.date_property {
        if !matches!(view_kind, "calendar" | "timeline") {
            return Err("Solo el calendario y el cronograma usan una propiedad de fecha".to_string());
        }
        if schema.get(date).map(String::as_str) != Some("date") {
            return Err("La vista necesita una propiedad de tipo fecha".to_string());
        }
    }
    if let Some(chart) = &config.chart {
        if view_kind != "chart" {
            return Err("Solo un gráfico tiene configuración de gráfico".to_string());
        }
        if let Some(value) = &chart.value {
            if schema.get(value).map(String::as_str) != Some("number") {
                return Err("Un gráfico solo suma, promedia o compara propiedades numéricas".to_string());
            }
        }
        if chart.aggregate != Aggregate::Count && chart.value.is_none() {
            return Err("Elige la propiedad numérica que se calcula".to_string());
        }
    }
    if let Some(dashboard) = &config.dashboard {
        if view_kind != "dashboard" {
            return Err("Solo un panel de control tiene widgets".to_string());
        }
        if dashboard.widgets.len() > MAX_WIDGETS {
            return Err(format!("Un panel de control puede tener como máximo {MAX_WIDGETS} widgets"));
        }
        let mut seen = HashSet::new();
        for widget in &dashboard.widgets {
            if !is_uuid(&widget.id) || !seen.insert(widget.id.as_str()) {
                return Err("Cada widget necesita un id único".to_string());
            }
            check_text("El título del widget", &widget.title, 100)?;
            // a widget is a chart with its own axis and filter: the same rules as a chart view
            let as_chart = ViewConfig {
                filter: widget.filter.clone(),
                group: widget.group.clone(),
                chart: Some(widget.chart.clone()),
                ..Default::default()
            };
            validate_config(&as_chart, schema, "chart")?;
        }
    }
    if let Some(form) = &config.form {
        if view_kind != "form" {
            return Err("Solo un formulario tiene configuración de formulario".to_string());
        }
        validate_form(form, schema)?;
    }
    if let Some(place) = &config.place_property {
        if view_kind != "map" {
            return Err("Solo el mapa usa una propiedad de lugar".to_string());
        }
        if schema.get(place).map(String::as_str) != Some("place") {
            return Err("El mapa necesita una propiedad de tipo lugar".to_string());
        }
    }
    if let Some(visible) = &config.hidden_properties {
        if visible.len() > MAX_HIDDEN {
            return Err("Demasiadas propiedades ocultas".to_string());
        }
        if visible.iter().any(|id| id == TITLE || !schema.contains_key(id)) {
            return Err("Se oculta una propiedad que no existe".to_string());
        }
    }
    let is_table = matches!(view_kind, "table" | "form");
    if let Some(calcs) = &config.calculations {
        if !is_table {
            return Err("Solo una tabla tiene cálculos por columna".to_string());
        }
        for (id, calc) in calcs {
            let kind = schema.get(id).ok_or("Se calcula una columna que no existe")?;
            match calc {
                Calc::Sum | Calc::Avg | Calc::Median | Calc::Min | Calc::Max | Calc::Range if kind != "number" => {
                    return Err("Ese cálculo solo vale para números".to_string());
                }
                Calc::Earliest | Calc::Latest if kind != "date" => {
                    return Err("Ese cálculo solo vale para fechas".to_string());
                }
                _ => {}
            }
        }
    }
    if let Some(frozen) = &config.frozen_up_to {
        if !is_table {
            return Err("Solo una tabla puede fijar columnas".to_string());
        }
        if !schema.contains_key(frozen) {
            return Err("Se fija una columna que no existe".to_string());
        }
    }
    if let Some(wrapped) = &config.wrapped {
        if !is_table {
            return Err("Solo una tabla ajusta el contenido de sus columnas".to_string());
        }
        let unique: HashSet<&String> = wrapped.iter().collect();
        if wrapped.len() > MAX_HIDDEN + 1 || unique.len() != wrapped.len() {
            return Err("Lista de columnas ajustadas no válida".to_string());
        }
        if wrapped.iter().any(|id| !schema.contains_key(id)) {
            return Err("Se ajusta una columna que no existe".to_string());
        }
    }
    if let Some(widths) = &config.column_widths {
        if !is_table {
            return Err("Solo una tabla tiene anchos de columna".to_string());
        }
        if widths.len() > MAX_HIDDEN + 1 {
            return Err("Demasiados anchos de columna".to_string());
        }
        for (id, width) in widths {
            if id != TITLE && !schema.contains_key(id) {
                return Err("Ancho de una columna que no existe".to_string());
            }
            if !(MIN_COLUMN_WIDTH..=MAX_COLUMN_WIDTH).contains(width) {
                return Err(format!("El ancho de columna va de {MIN_COLUMN_WIDTH} a {MAX_COLUMN_WIDTH} px"));
            }
        }
    }
    Ok(())
}

fn check_text(what: &str, value: &Option<String>, max: usize) -> Result<(), String> {
    match value {
        Some(s) if s.chars().count() > max => Err(format!("{what} no puede pasar de {max} caracteres")),
        _ => Ok(()),
    }
}

fn validate_form(form: &FormConfig, schema: &Schema) -> Result<(), String> {
    check_text("El título del formulario", &form.title, 100)?;
    check_text("La descripción", &form.description, 500)?;
    check_text("El texto del botón", &form.submit_label, 40)?;
    check_text("El mensaje de éxito", &form.success_message, 300)?;
    let Some(fields) = &form.fields else { return Ok(()) };
    if fields.len() > MAX_FORM_FIELDS {
        return Err(format!("Un formulario puede tener como máximo {MAX_FORM_FIELDS} campos"));
    }
    let mut seen = HashSet::new();
    for field in fields {
        if !schema.contains_key(&field.property) {
            return Err("El formulario pide una propiedad que no existe".to_string());
        }
        if !seen.insert(field.property.as_str()) {
            return Err("Un campo no puede aparecer dos veces en el formulario".to_string());
        }
        check_text("La pregunta", &field.label, 100)?;
        check_text("La ayuda", &field.help, 200)?;
    }
    Ok(())
}

// ---------------------------------------------------------------- evaluation

fn value_of(row: &RowInfo, property: &str) -> Option<Value> {
    if property == TITLE {
        Some(json!(row.title))
    } else {
        row.values.get(property).cloned()
    }
}

fn is_empty(v: &Option<Value>) -> bool {
    match v {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.is_empty(),
        Some(Value::Array(a)) => a.is_empty(),
        _ => false,
    }
}

fn rule_matches(rule: &FilterRule, kind: &str, cell: &Option<Value>) -> bool {
    use Operator::*;
    match rule.operator {
        IsEmpty => return is_empty(cell),
        IsNotEmpty => return !is_empty(cell),
        _ => {}
    }
    let Some(target) = &rule.value else { return true };
    match kind {
        "text" => {
            let cell = cell.as_ref().and_then(Value::as_str).unwrap_or("").to_lowercase();
            let t = target.as_str().unwrap_or("").to_lowercase();
            match rule.operator {
                Contains => cell.contains(&t),
                NotContains => !cell.contains(&t),
                Is => cell == t,
                IsNot => cell != t,
                _ => true,
            }
        }
        "number" => {
            let Some(t) = target.as_f64() else { return true };
            let Some(c) = cell.as_ref().and_then(Value::as_f64) else { return rule.operator == Neq };
            match rule.operator {
                Eq => c == t,
                Neq => c != t,
                Gt => c > t,
                Gte => c >= t,
                Lt => c < t,
                Lte => c <= t,
                _ => true,
            }
        }
        "date" => {
            let (Some(c), Some(t)) = (cell.as_ref().and_then(Value::as_str), target.as_str()) else {
                return false;
            };
            // A cell may be a range. ISO dates compare correctly as strings. «es» matches
            // any day inside the range; the other operators compare the range's start.
            let (start, end) = split_date_range(c);
            match rule.operator {
                Is => start <= t && t <= end.unwrap_or(start),
                Before => start < t,
                After => start > t,
                OnOrBefore => start <= t,
                OnOrAfter => start >= t,
                _ => true,
            }
        }
        "checkbox" => {
            let checked = *cell == Some(json!(true));
            match rule.operator {
                Is => checked == target.as_bool().unwrap_or(false),
                _ => true,
            }
        }
        "select" => {
            let c = cell.as_ref().and_then(Value::as_str);
            let t = target.as_str().unwrap_or("");
            match rule.operator {
                Is => c == Some(t),
                IsNot => c != Some(t),
                _ => true,
            }
        }
        "place" => {
            let name = cell.as_ref().and_then(|v| v.get("name")).and_then(Value::as_str).unwrap_or("").to_lowercase();
            let t = target.as_str().unwrap_or("").to_lowercase();
            match rule.operator {
                Contains => name.contains(&t),
                NotContains => !name.contains(&t),
                _ => true,
            }
        }
        "relation" | "tags" => {
            let linked = cell.as_ref().and_then(Value::as_array);
            let has = linked.is_some_and(|a| a.iter().any(|v| v == target));
            match rule.operator {
                Contains => has,
                NotContains => !has,
                _ => true,
            }
        }
        _ => true,
    }
}

/// A sort key; empty values always sort last, whichever the direction.
#[derive(PartialEq, PartialOrd, Debug)]
enum Key {
    Num(f64),
    Text(String),
    Empty,
}

fn sort_key(row: &RowInfo, property: &str, kind: &str, options: &[String], titles: &HashMap<String, String>) -> Key {
    let cell = value_of(row, property);
    if kind == "checkbox" {
        // an unchecked box is no value, but it still sorts (before the checked ones), never «empty»
        return Key::Num(if cell == Some(json!(true)) { 1.0 } else { 0.0 });
    }
    if is_empty(&cell) {
        return Key::Empty;
    }
    let cell = cell.unwrap();
    match kind {
        "number" => cell.as_f64().map_or(Key::Empty, Key::Num),
        "select" => cell.as_str().and_then(|s| options.iter().position(|o| o == s)).map_or(Key::Empty, |i| Key::Num(i as f64)),
        // a tags cell sorts by its first tag, in the order of the options
        "tags" => cell
            .as_array()
            .and_then(|a| a.first())
            .and_then(Value::as_str)
            .and_then(|s| options.iter().position(|o| o == s))
            .map_or(Key::Empty, |i| Key::Num(i as f64)),
        "relation" => cell
            .as_array()
            .and_then(|a| a.first())
            .and_then(Value::as_str)
            .map_or(Key::Empty, |id| Key::Text(titles.get(id).cloned().unwrap_or_default().to_lowercase())),
        "date" => Key::Text(split_date_range(cell.as_str().unwrap_or("")).0.to_string()),
        "place" => match cell.get("name").and_then(Value::as_str).filter(|n| !n.is_empty()) {
            Some(name) => Key::Text(name.to_lowercase()),
            None => Key::Empty,
        },
        _ => Key::Text(cell.as_str().unwrap_or("").to_lowercase()),
    }
}

fn compare(a: &Key, b: &Key, direction: Direction) -> Ordering {
    match (a, b) {
        (Key::Empty, Key::Empty) => Ordering::Equal,
        (Key::Empty, _) => Ordering::Greater,
        (_, Key::Empty) => Ordering::Less,
        _ => {
            let ord = a.partial_cmp(b).unwrap_or(Ordering::Equal);
            if direction == Direction::Desc {
                ord.reverse()
            } else {
                ord
            }
        }
    }
}

// Civil-date <-> day-number conversions (Howard Hinnant's algorithms), so
// weekly grouping needs no date crate.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { yoe + era * 400 + 1 } else { yoe + era * 400 }, m, d)
}

const MONTHS: [&str; 12] = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
];

/// (key, label) of the bucket an ISO date falls in.
fn date_bucket(date: &str, granularity: Granularity) -> Option<(String, String)> {
    let mut parts = date.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, d) = (parts.next()??, parts.next()??, parts.next()??);
    Some(match granularity {
        Granularity::Day => (date.to_string(), date.to_string()),
        Granularity::Week => {
            let z = days_from_civil(y, m, d);
            // 1970-01-01 was a Thursday; Monday = 0
            let (my, mm, md) = civil_from_days(z - (z + 3).rem_euclid(7));
            let monday = format!("{my:04}-{mm:02}-{md:02}");
            (monday.clone(), format!("Semana del {monday}"))
        }
        Granularity::Month => (format!("{y:04}-{m:02}"), format!("{} {y}", MONTHS.get((m - 1) as usize)?)),
        Granularity::Year => (format!("{y:04}"), format!("{y}")),
    })
}

fn build_groups(rows: &[&RowInfo], rule: &GroupRule, kind: &str, options: &[String], titles: &HashMap<String, String>) -> Vec<ViewGroup> {
    // key -> (sort key, label, rows). A BTreeMap keyed by the sort key orders the groups.
    let mut buckets: BTreeMap<(i64, String), (String, Vec<String>)> = BTreeMap::new();
    let mut none: Vec<String> = Vec::new();
    let mut add = |order: i64, key: String, label: String, id: &str| {
        buckets.entry((order, key)).or_insert_with(|| (label, Vec::new())).1.push(id.to_string());
    };

    for row in rows {
        let cell = value_of(row, &rule.property);
        if kind == "checkbox" {
            // two groups, never «Sin valor»: an unchecked box has no value but is a group of its own
            let on = cell == Some(json!(true));
            add(if on { 0 } else { 1 }, on.to_string(), if on { "Marcada" } else { "Sin marcar" }.to_string(), &row.page_id);
            continue;
        }
        if is_empty(&cell) {
            none.push(row.page_id.clone());
            continue;
        }
        let cell = cell.unwrap();
        match kind {
            "select" => match cell.as_str().and_then(|s| options.iter().position(|o| o == s)) {
                Some(i) => add(i as i64, options[i].clone(), options[i].clone(), &row.page_id),
                None => none.push(row.page_id.clone()),
            },
            "number" => {
                let n = cell.as_f64().unwrap_or(0.0);
                // numeric order via the integer part + the text for ties; labels show the value
                add((n * 1_000.0).round() as i64, format!("{n}"), format!("{n}"), &row.page_id);
            }
            "date" => match cell
                .as_str()
                .map(|d| split_date_range(d).0)
                .and_then(|d| date_bucket(d, rule.granularity.unwrap_or(Granularity::Month)))
            {
                Some((key, label)) => add(0, key, label, &row.page_id),
                None => none.push(row.page_id.clone()),
            },
            "place" => match cell.get("name").and_then(Value::as_str).filter(|n| !n.is_empty()) {
                Some(name) => add(0, name.to_lowercase(), name.to_string(), &row.page_id),
                None => none.push(row.page_id.clone()),
            },
            // a row appears under each of its tags
            "tags" => {
                let mut placed = false;
                for tag in cell.as_array().into_iter().flatten().filter_map(Value::as_str) {
                    if let Some(i) = options.iter().position(|o| o == tag) {
                        add(i as i64, options[i].clone(), options[i].clone(), &row.page_id);
                        placed = true;
                    }
                }
                if !placed {
                    none.push(row.page_id.clone());
                }
            }
            "relation" => {
                for id in cell.as_array().into_iter().flatten().filter_map(Value::as_str) {
                    let title = titles.get(id).cloned().unwrap_or_default();
                    add(0, format!("{}\u{0}{id}", title.to_lowercase()), title, &row.page_id);
                }
            }
            _ => {
                let text = cell.as_str().unwrap_or("").to_string();
                add(0, text.to_lowercase(), text, &row.page_id);
            }
        }
    }

    let mut groups: Vec<ViewGroup> = Vec::new();
    if matches!(kind, "select" | "tags") && !rule.hide_empty {
        // every option is a group even with no rows (a board needs its empty columns)
        for (i, option) in options.iter().enumerate() {
            let key = (i as i64, option.clone());
            let (label, row_ids) = buckets.remove(&key).unwrap_or_else(|| (option.clone(), Vec::new()));
            groups.push(ViewGroup {
                key: option.clone(),
                label,
                row_ids,
            });
        }
    }
    for ((_, key), (label, row_ids)) in buckets {
        // relation keys carry the target id after a NUL, which the client doesn't need to see
        let key = key.split('\u{0}').next_back().filter(|_| kind == "relation").map_or(key.clone(), str::to_string);
        groups.push(ViewGroup { key, label, row_ids });
    }
    if !none.is_empty() {
        groups.push(ViewGroup {
            key: String::new(),
            label: NO_VALUE.to_string(),
            row_ids: none,
        });
    }
    groups
}

/// Filters, sorts and (optionally) groups `data`'s rows per `config`. Rules that
/// reference a property that no longer exists are skipped rather than failing —
/// the data may have changed since the config was validated.
pub fn evaluate(data: &DatabaseData, config: &ViewConfig, titles: &HashMap<String, String>) -> ViewResult {
    let mut kinds: HashMap<&str, (&str, Vec<String>)> = HashMap::new();
    kinds.insert(TITLE, ("text", Vec::new()));
    for p in &data.properties {
        let options = p
            .config
            .get("options")
            .and_then(Value::as_array)
            .map_or_else(Vec::new, |a| a.iter().filter_map(Value::as_str).map(str::to_string).collect());
        kinds.insert(p.id.as_str(), (p.kind.as_str(), options));
    }

    let rules: Vec<(&FilterRule, &str)> = config
        .filter
        .rules
        .iter()
        .filter_map(|r| kinds.get(r.property.as_str()).map(|(k, _)| (r, *k)))
        .filter(|(r, _)| !needs_value(r.operator) || r.value.is_some())
        .collect();

    let mut rows: Vec<&RowInfo> = data
        .rows
        .iter()
        .filter(|row| {
            if rules.is_empty() {
                return true;
            }
            let test = |(rule, kind): &(&FilterRule, &str)| rule_matches(rule, kind, &value_of(row, &rule.property));
            match config.filter.op {
                BoolOp::And => rules.iter().all(test),
                BoolOp::Or => rules.iter().any(test),
            }
        })
        .collect();

    // sort_by is stable, so ties keep creation order
    let sorts: Vec<(&SortRule, &str, &[String])> = config
        .sorts
        .iter()
        .filter_map(|s| kinds.get(s.property.as_str()).map(|(k, o)| (s, *k, o.as_slice())))
        .collect();
    rows.sort_by(|a, b| {
        for (rule, kind, options) in &sorts {
            let ord = compare(
                &sort_key(a, &rule.property, kind, options, titles),
                &sort_key(b, &rule.property, kind, options, titles),
                rule.direction,
            );
            if ord != Ordering::Equal {
                return ord;
            }
        }
        Ordering::Equal
    });

    let groups = config.group.as_ref().and_then(|rule| {
        let (kind, options) = kinds.get(rule.property.as_str())?;
        Some(build_groups(&rows, rule, kind, options, titles))
    });
    ViewResult {
        row_ids: rows.iter().map(|r| r.page_id.clone()).collect(),
        groups,
        previews: None,
        chart: None,
        widgets: None,
    }
}

/// The aggregate of `rows`' numbers in property `value` (a count ignores it).
pub(crate) fn aggregate(rows: &[&RowInfo], agg: Aggregate, value: Option<&str>) -> Option<f64> {
    if agg == Aggregate::Count {
        return Some(rows.len() as f64);
    }
    let numbers: Vec<f64> = rows.iter().filter_map(|r| r.values.get(value?)?.as_f64()).collect();
    if numbers.is_empty() {
        return None;
    }
    let sum: f64 = numbers.iter().sum();
    Some(match agg {
        Aggregate::Sum => sum,
        Aggregate::Avg => sum / numbers.len() as f64,
        Aggregate::Min => numbers.iter().copied().fold(f64::INFINITY, f64::min),
        _ => numbers.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    })
}

/// What a chart draws, from an already evaluated view: one point per group (the X
/// axis), or a single total for the `number` type. Without a group there is no axis.
pub fn build_chart(data: &DatabaseData, result: &ViewResult, chart: &ChartConfig) -> ChartResult {
    let by_id: HashMap<&str, &RowInfo> = data.rows.iter().map(|r| (r.page_id.as_str(), r)).collect();
    let rows_of = |ids: &[String]| -> Vec<&RowInfo> { ids.iter().filter_map(|id| by_id.get(id.as_str()).copied()).collect() };
    let value = chart.value.as_deref();

    let mut points: Vec<ChartPoint> = if chart.chart_type == ChartType::Number {
        let total = aggregate(&rows_of(&result.row_ids), chart.aggregate, value);
        vec![ChartPoint {
            key: String::new(),
            label: "Total".to_string(),
            value: total,
        }]
    } else {
        result
            .groups
            .iter()
            .flatten()
            .map(|g| ChartPoint {
                key: g.key.clone(),
                label: g.label.clone(),
                value: aggregate(&rows_of(&g.row_ids), chart.aggregate, value),
            })
            .collect()
    };
    // a line keeps the X axis order: sorting its points by value would scramble the line
    if chart.sort != ChartSort::X && chart.chart_type != ChartType::Line {
        // empty groups go last either way, like sorting rows
        points.sort_by(|a, b| match (a.value, b.value) {
            (Some(x), Some(y)) => {
                let ord = x.partial_cmp(&y).unwrap_or(Ordering::Equal);
                if chart.sort == ChartSort::Desc {
                    ord.reverse()
                } else {
                    ord
                }
            }
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        });
    }
    let total = points.len();
    points.truncate(MAX_CHART_POINTS);
    ChartResult { points, total }
}

/// What each widget of a dashboard draws. Rows first pass the view's own filter, then each widget's.
pub fn build_dashboard(data: &DatabaseData, config: &ViewConfig, titles: &HashMap<String, String>) -> Vec<ChartResult> {
    let Some(dashboard) = &config.dashboard else { return Vec::new() };
    let base = evaluate(
        data,
        &ViewConfig {
            filter: config.filter.clone(),
            ..Default::default()
        },
        titles,
    );
    let kept: HashSet<&str> = base.row_ids.iter().map(String::as_str).collect();
    let narrowed = DatabaseData {
        id: data.id.clone(),
        page_id: data.page_id.clone(),
        name: data.name.clone(),
        properties: data.properties.clone(),
        rows: data.rows.iter().filter(|r| kept.contains(r.page_id.as_str())).cloned().collect(),
        views: vec![],
    };
    dashboard
        .widgets
        .iter()
        .map(|w| {
            let own = ViewConfig {
                filter: w.filter.clone(),
                group: w.group.clone(),
                ..Default::default()
            };
            build_chart(&narrowed, &evaluate(&narrowed, &own, titles), &w.chart)
        })
        .collect()
}

// ---------------------------------------------------------------- persistence

struct Stored {
    database_id: String,
    kind: String,
    config: String,
}

fn load_view(conn: &Connection, id: &str) -> Result<Stored, String> {
    if !is_uuid(id) {
        return Err("Invalid view id".to_string());
    }
    conn.query_row("SELECT database_id, type, config FROM views WHERE id = ?1", [id], |r| {
        Ok(Stored {
            database_id: r.get(0)?,
            kind: r.get(1)?,
            config: r.get(2)?,
        })
    })
    .optional()
    .map_err(sql)?
    .ok_or_else(|| "La vista no existe".to_string())
}

pub fn list_views(conn: &Connection, database_id: &str) -> Result<Vec<ViewInfo>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, type, config FROM views WHERE database_id = ?1 ORDER BY position, rowid")
        .map_err(sql)?;
    let rows = stmt
        .query_map([database_id], |r| {
            let config: String = r.get(3)?;
            Ok(ViewInfo {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
                config: serde_json::from_str(&config).unwrap_or_else(|_| json!({})),
            })
        })
        .map_err(sql)?;
    rows.collect::<rusqlite::Result<_>>().map_err(sql)
}

fn clean_view_name(raw: &str) -> Result<String, String> {
    let name = raw.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err("El nombre debe tener entre 1 y 60 caracteres".to_string());
    }
    Ok(name.to_string())
}

pub fn create_view(conn: &Connection, database_id: &str, name: &str, kind: &str) -> Result<ViewInfo, String> {
    if !is_uuid(database_id) {
        return Err("Invalid database id".to_string());
    }
    let name = clean_view_name(name)?;
    if !VIEW_KINDS.contains(&kind) {
        return Err(format!("Tipo de vista desconocido: {kind}"));
    }
    let (count, next): (i64, i64) = conn
        .query_row("SELECT COUNT(*), COALESCE(MAX(position), -1) + 1 FROM views WHERE database_id = ?1", [database_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(sql)?;
    if count >= MAX_VIEWS {
        return Err(format!("Máximo {MAX_VIEWS} vistas por base de datos"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO views (id, database_id, name, type, position) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, database_id, name, kind, next],
    )
    .map_err(sql)?; // FK fails if the database doesn't exist
    Ok(ViewInfo {
        id,
        name,
        kind: kind.to_string(),
        config: json!({}),
    })
}

/// Every database has at least one view; this is the one created with it.
pub fn create_default_view(conn: &Connection, database_id: &str) -> Result<(), String> {
    create_view(conn, database_id, "Tabla", "table").map(|_| ())
}

pub fn rename_view(conn: &Connection, id: &str, name: &str) -> Result<(), String> {
    load_view(conn, id)?;
    conn.execute("UPDATE views SET name = ?1 WHERE id = ?2", [&clean_view_name(name)?, id]).map_err(sql)?;
    Ok(())
}

pub fn delete_view(conn: &Connection, id: &str) -> Result<(), String> {
    let view = load_view(conn, id)?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM views WHERE database_id = ?1", [&view.database_id], |r| r.get(0))
        .map_err(sql)?;
    if count <= 1 {
        return Err("Una base de datos necesita al menos una vista".to_string());
    }
    conn.execute("DELETE FROM views WHERE id = ?1", [id]).map_err(sql)?;
    Ok(())
}

/// Validates against the database's current schema, then stores the normalized config.
pub fn update_view_config(conn: &Connection, id: &str, raw: &Value) -> Result<(), String> {
    let view = load_view(conn, id)?;
    let config = parse_config(raw)?;
    validate_config(&config, &load_schema(conn, &view.database_id)?, &view.kind)?;
    let stored = serde_json::to_string(&config).map_err(sql)?;
    conn.execute("UPDATE views SET config = ?1 WHERE id = ?2", [&stored, id]).map_err(sql)?;
    Ok(())
}

fn rewrite_configs(conn: &Connection, database_id: &str, edit: impl Fn(&mut ViewConfig)) -> Result<(), String> {
    for view in list_views(conn, database_id)? {
        let Ok(mut config) = parse_config(&view.config) else { continue };
        let before = serde_json::to_string(&config).map_err(sql)?;
        edit(&mut config);
        let after = serde_json::to_string(&config).map_err(sql)?;
        if before != after {
            conn.execute("UPDATE views SET config = ?1 WHERE id = ?2", [&after, &view.id]).map_err(sql)?;
        }
    }
    Ok(())
}

/// A deleted property can't be referenced by any view any more.
pub fn strip_property(conn: &Connection, database_id: &str, property_id: &str) -> Result<(), String> {
    rewrite_configs(conn, database_id, |c| {
        c.sorts.retain(|s| s.property != property_id);
        c.filter.rules.retain(|r| r.property != property_id);
        if c.group.as_ref().is_some_and(|g| g.property == property_id) {
            c.group = None;
        }
        for widget in c.dashboard.iter_mut().flat_map(|d| d.widgets.iter_mut()) {
            widget.filter.rules.retain(|r| r.property != property_id);
            if widget.group.as_ref().is_some_and(|g| g.property == property_id) {
                widget.group = None;
            }
            if widget.chart.value.as_deref() == Some(property_id) {
                widget.chart.value = None;
                widget.chart.aggregate = Aggregate::Count;
            }
        }
        if c.date_property.as_deref() == Some(property_id) {
            c.date_property = None;
        }
        if c.place_property.as_deref() == Some(property_id) {
            c.place_property = None;
        }
        if let Some(visible) = &mut c.hidden_properties {
            visible.retain(|p| p != property_id);
        }
        if let Some(widths) = &mut c.column_widths {
            widths.remove(property_id);
        }
        if let Some(calcs) = &mut c.calculations {
            calcs.remove(property_id);
        }
        if let Some(wrapped) = &mut c.wrapped {
            wrapped.retain(|p| p != property_id);
        }
        if c.frozen_up_to.as_deref() == Some(property_id) {
            c.frozen_up_to = None;
        }
        if let Some(chart) = c.chart.as_mut().filter(|ch| ch.value.as_deref() == Some(property_id)) {
            chart.value = None;
            chart.aggregate = Aggregate::Count;
        }
        if let Some(fields) = c.form.as_mut().and_then(|f| f.fields.as_mut()) {
            fields.retain(|f| f.property != property_id);
        }
    })
}

/// A property changed type: drop what only made sense for the old one — its filters, grouping,
/// calculation, the date/place a view is laid out by, a chart's value. Sorts, widths, visibility
/// and form questions still apply to the new type and stay.
pub fn retype_property(conn: &Connection, database_id: &str, property_id: &str, kind: &str) -> Result<(), String> {
    rewrite_configs(conn, database_id, |c| {
        c.filter.rules.retain(|r| r.property != property_id);
        if c.group.as_ref().is_some_and(|g| g.property == property_id) {
            c.group = None;
        }
        let drop_value = |chart: &mut ChartConfig| {
            if kind != "number" && chart.value.as_deref() == Some(property_id) {
                chart.value = None;
                chart.aggregate = Aggregate::Count;
            }
        };
        for widget in c.dashboard.iter_mut().flat_map(|d| d.widgets.iter_mut()) {
            widget.filter.rules.retain(|r| r.property != property_id);
            if widget.group.as_ref().is_some_and(|g| g.property == property_id) {
                widget.group = None;
            }
            drop_value(&mut widget.chart);
        }
        if let Some(chart) = c.chart.as_mut() {
            drop_value(chart);
        }
        if kind != "date" && c.date_property.as_deref() == Some(property_id) {
            c.date_property = None;
        }
        if kind != "place" && c.place_property.as_deref() == Some(property_id) {
            c.place_property = None;
        }
        if let Some(calcs) = &mut c.calculations {
            calcs.remove(property_id);
        }
    })
}

/// A select option is its text, so renaming one must follow into the filters that use it.
pub fn rename_option_in_filters(conn: &Connection, database_id: &str, property_id: &str, old: &str, new: &str) -> Result<(), String> {
    rewrite_configs(conn, database_id, |c| {
        let widget_filters = c.dashboard.iter_mut().flat_map(|d| d.widgets.iter_mut()).map(|w| &mut w.filter);
        for filter in std::iter::once(&mut c.filter).chain(widget_filters) {
            for rule in filter.rules.iter_mut().filter(|r| r.property == property_id) {
                if rule.value.as_ref().and_then(Value::as_str) == Some(old) {
                    rule.value = Some(json!(new));
                }
            }
        }
    })
}

/// Titles of every row page that appears as a relation target in `data`.
pub(crate) fn target_titles(conn: &Connection, data: &DatabaseData) -> Result<HashMap<String, String>, String> {
    let ids: HashSet<&str> = data
        .rows
        .iter()
        .flat_map(|r| r.values.values())
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(Value::as_str)
        .filter(|s| is_uuid(s)) // tags are texts too, and no page's title
        .collect();
    ids.into_iter().map(|id| Ok((id.to_string(), derive_page_title(conn, id).map_err(sql)?))).collect()
}

pub fn query_view(conn: &Connection, view_id: &str) -> Result<ViewResult, String> {
    let view = load_view(conn, view_id)?;
    debug_assert!(VIEW_KINDS.contains(&view.kind.as_str()));
    let data = databases::get_database(conn, &view.database_id)?.ok_or("La base de datos no existe")?;
    let config = serde_json::from_str::<Value>(&view.config).ok().and_then(|v| parse_config(&v).ok()).unwrap_or_default();
    let titles = target_titles(conn, &data)?;
    let mut result = evaluate(&data, &config, &titles);
    if matches!(view.kind.as_str(), "gallery" | "feed") && config.show_preview != Some(false) {
        result.previews = Some(build_previews(conn, &result.row_ids)?);
    }
    if view.kind == "chart" {
        result.chart = Some(build_chart(&data, &result, &config.chart.clone().unwrap_or_default()));
    }
    if view.kind == "dashboard" {
        result.widgets = Some(build_dashboard(&data, &config, &titles));
    }
    Ok(result)
}

fn collect_snippet(node: &Value, image: &mut Option<String>, text: &mut String) {
    if image.is_none() && node.get("type").and_then(Value::as_str) == Some("image") {
        *image = node
            .get("attrs")
            .and_then(|a| a.get("file"))
            .and_then(Value::as_str)
            .filter(|f| crate::attachments::valid_attachment_name(f))
            .map(str::to_string);
    }
    if let Some(t) = node.get("text").and_then(Value::as_str) {
        text.push_str(t);
    }
    for child in node.get("content").and_then(Value::as_array).into_iter().flatten() {
        collect_snippet(child, image, text);
        // keep words of neighbouring blocks apart (cheap: a space after every child)
        if text.chars().last().is_some_and(|c| !c.is_whitespace()) {
            text.push(' ');
        }
    }
}

/// First image and first stretch of text of a page, skipping its title heading.
pub fn extract_preview(doc: &Value) -> RowPreview {
    let blocks = doc.get("content").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
    let (mut image, mut text) = (None, String::new());
    for (i, block) in blocks.iter().enumerate() {
        if i == 0 && block.get("type").and_then(Value::as_str) == Some("heading") {
            continue;
        }
        collect_snippet(block, &mut image, &mut text);
        text.push(' ');
        if image.is_some() && text.chars().count() > SNIPPET_CHARS {
            break;
        }
    }
    let words = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let snippet = if words.chars().count() > SNIPPET_CHARS {
        format!("{}…", words.chars().take(SNIPPET_CHARS).collect::<String>().trim_end())
    } else {
        words
    };
    RowPreview { image, snippet }
}

fn build_previews(conn: &Connection, row_ids: &[String]) -> Result<HashMap<String, RowPreview>, String> {
    let mut previews = HashMap::with_capacity(row_ids.len());
    for id in row_ids {
        let doc = crate::db::get_page_content(conn, id).map_err(sql)?;
        previews.insert(id.clone(), doc.as_ref().map(extract_preview).unwrap_or_default());
    }
    Ok(previews)
}

/// The questions a form asks: the configured ones, else the title (required) and every property.
fn effective_fields(form: Option<&FormConfig>, data: &DatabaseData) -> Vec<FormField> {
    if let Some(fields) = form.and_then(|f| f.fields.clone()) {
        return fields;
    }
    std::iter::once(FormField {
        property: TITLE.to_string(),
        label: None,
        help: None,
        required: true,
    })
    .chain(data.properties.iter().map(|p| FormField {
        property: p.id.clone(),
        label: None,
        help: None,
        required: false,
    }))
    .collect()
}

/// Whether an answer actually says something (an empty string, list or place does not).
fn has_value(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::String(s) => !s.trim().is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => o.values().any(has_value),
        _ => true,
    }
}

/// Creates one row from a form's answers (`values`: property id or `title` → value).
/// Rust is the judge: required questions, unknown keys and every value's real type
/// are checked here, and if anything fails the row is deleted again — a rejected
/// submission leaves nothing behind.
pub fn submit_form(conn: &Connection, view_id: &str, values: &serde_json::Map<String, Value>) -> Result<PageSummary, String> {
    let view = load_view(conn, view_id)?;
    if view.kind != "form" {
        return Err("Esta vista no es un formulario".to_string());
    }
    let config = serde_json::from_str::<Value>(&view.config).ok().and_then(|v| parse_config(&v).ok()).unwrap_or_default();
    let data = databases::get_database(conn, &view.database_id)?.ok_or("La base de datos no existe")?;
    let fields = effective_fields(config.form.as_ref(), &data);

    if let Some(extra) = values.keys().find(|k| !fields.iter().any(|f| &f.property == *k)) {
        return Err(format!("El formulario no pide el campo {extra}"));
    }
    for field in fields.iter().filter(|f| f.required) {
        if !values.get(&field.property).is_some_and(has_value) {
            let name = field
                .label
                .clone()
                .or_else(|| data.properties.iter().find(|p| p.id == field.property).map(|p| p.name.clone()))
                .unwrap_or_else(|| "Título".to_string());
            return Err(format!("Falta el campo obligatorio: {name}"));
        }
    }

    let row = databases::create_row(conn, &view.database_id)?;
    let write = || -> Result<(), String> {
        if let Some(title) = values.get(TITLE).filter(|v| has_value(v)) {
            let title = title.as_str().ok_or("El título debe ser texto")?;
            crate::db::set_row_title(conn, &row.id, title)?;
        }
        for (property, value) in values.iter().filter(|(k, v)| k.as_str() != TITLE && has_value(v)) {
            databases::set_value(conn, &row.id, property, value)?;
        }
        Ok(())
    };
    if let Err(e) = write() {
        let _ = crate::db::delete_page(conn, &row.id); // cascades to whatever was written
        return Err(e);
    }
    Ok(row)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::databases::PropertyInfo;
    use serde_json::Map;

    fn prop(id: &str, kind: &str, config: Value) -> PropertyInfo {
        PropertyInfo {
            id: id.to_string(),
            name: id.to_string(),
            kind: kind.to_string(),
            config,
            icon: None,
        }
    }

    fn row(id: &str, title: &str, values: Value) -> RowInfo {
        let values: Map<String, Value> = values.as_object().cloned().unwrap_or_default();
        RowInfo {
            page_id: id.to_string(),
            title: title.to_string(),
            values,
        }
    }

    /// Four rows over a text, number, date, select and relation property.
    fn data() -> DatabaseData {
        DatabaseData {
            id: "db".into(),
            page_id: "page".into(),
            name: "Tareas".into(),
            properties: vec![
                prop("note", "text", json!({})),
                prop("n", "number", json!({})),
                prop("d", "date", json!({})),
                prop("s", "select", json!({ "options": ["Pendiente", "Hecho"] })),
                prop("rel", "relation", json!({ "target": "t" })),
            ],
            rows: vec![
                row("r1", "Beta", json!({ "note": "Hola Mundo", "n": 5, "d": "2026-10-15", "s": "Hecho", "rel": ["p1", "p2"] })),
                row("r2", "alfa", json!({ "note": "adiós", "n": 12.5, "d": "2026-10-13", "s": "Pendiente", "rel": ["p2"] })),
                row("r3", "Gamma", json!({ "n": -1, "d": "2026-11-02" })),
                row("r4", "delta", json!({ "note": "hola", "s": "Hecho" })),
            ],
            views: vec![],
        }
    }

    fn titles() -> HashMap<String, String> {
        HashMap::from([("p1".to_string(), "Zeta".to_string()), ("p2".to_string(), "Alfa".to_string())])
    }

    fn run(config: Value) -> ViewResult {
        evaluate(&data(), &parse_config(&config).unwrap(), &titles())
    }

    fn ids(config: Value) -> Vec<String> {
        run(config).row_ids
    }

    fn rule(property: &str, operator: &str, value: Value) -> Value {
        json!({ "property": property, "operator": operator, "value": value })
    }

    #[test]
    fn filters_by_type() {
        let f = |rules: Value, op: &str| ids(json!({ "filter": { "op": op, "rules": rules } }));
        // text: case-insensitive; empty cells count as ""
        assert_eq!(f(json!([rule("note", "contains", json!("HOLA"))]), "and"), ["r1", "r4"]);
        assert_eq!(f(json!([rule("note", "not_contains", json!("hola"))]), "and"), ["r2", "r3"]);
        assert_eq!(f(json!([rule("note", "is", json!("HOLA"))]), "and"), ["r4"]);
        assert_eq!(f(json!([{ "property": "note", "operator": "is_empty" }]), "and"), ["r3"]);
        // the title behaves like a text property
        assert_eq!(f(json!([rule("title", "contains", json!("ta"))]), "and"), ["r1", "r4"]);
        // number
        assert_eq!(f(json!([rule("n", "gt", json!(4))]), "and"), ["r1", "r2"]);
        assert_eq!(f(json!([rule("n", "lte", json!(5))]), "and"), ["r1", "r3"]);
        assert_eq!(f(json!([rule("n", "neq", json!(5))]), "and"), ["r2", "r3", "r4"]); // empty differs
        assert_eq!(f(json!([{ "property": "n", "operator": "is_not_empty" }]), "and"), ["r1", "r2", "r3"]);
        // date
        assert_eq!(f(json!([rule("d", "before", json!("2026-10-15"))]), "and"), ["r2"]);
        assert_eq!(f(json!([rule("d", "on_or_after", json!("2026-10-15"))]), "and"), ["r1", "r3"]);
        assert_eq!(f(json!([rule("d", "is", json!("2026-10-13"))]), "and"), ["r2"]);
        // select
        assert_eq!(f(json!([rule("s", "is", json!("Hecho"))]), "and"), ["r1", "r4"]);
        assert_eq!(f(json!([rule("s", "is_not", json!("Hecho"))]), "and"), ["r2", "r3"]);
        // relation
        assert_eq!(f(json!([rule("rel", "contains", json!("p2"))]), "and"), ["r1", "r2"]);
        assert_eq!(f(json!([rule("rel", "not_contains", json!("p1"))]), "and"), ["r2", "r3", "r4"]);
        // and / or
        let two = json!([rule("s", "is", json!("Hecho")), rule("n", "gt", json!(4))]);
        assert_eq!(f(two.clone(), "and"), ["r1"]);
        assert_eq!(f(two, "or"), ["r1", "r2", "r4"]);
    }

    #[test]
    fn a_rule_still_missing_its_value_is_ignored() {
        assert_eq!(ids(json!({ "filter": { "rules": [{ "property": "n", "operator": "gt" }] } })).len(), 4);
        // ...and so is one whose property was deleted
        assert_eq!(ids(json!({ "filter": { "rules": [rule("gone", "is", json!("x"))] } })).len(), 4);
    }

    #[test]
    fn sorts_put_empties_last_in_both_directions() {
        let s = |property: &str, direction: &str| ids(json!({ "sorts": [{ "property": property, "direction": direction }] }));
        assert_eq!(s("n", "asc"), ["r3", "r1", "r2", "r4"]);
        assert_eq!(s("n", "desc"), ["r2", "r1", "r3", "r4"]); // r4 (empty) still last
        assert_eq!(s("title", "asc"), ["r2", "r1", "r4", "r3"]); // case-insensitive
        assert_eq!(s("d", "desc"), ["r3", "r1", "r2", "r4"]);
        // select sorts by option order, not alphabetically
        assert_eq!(s("s", "asc"), ["r2", "r1", "r4", "r3"]);
        // relation sorts by the first linked row's title
        assert_eq!(s("rel", "asc"), ["r2", "r1", "r3", "r4"]);
        // second rule breaks ties; no rules = creation order
        let two = ids(json!({ "sorts": [{ "property": "s", "direction": "asc" }, { "property": "title", "direction": "desc" }] }));
        assert_eq!(two, ["r2", "r4", "r1", "r3"]);
        assert_eq!(ids(json!({})), ["r1", "r2", "r3", "r4"]);
    }

    #[test]
    fn groups_by_each_kind() {
        let g = |group: Value| run(json!({ "group": group })).groups.unwrap().into_iter().map(|g| (g.label, g.row_ids)).collect::<Vec<_>>();
        // select: every option (even empty), in option order, then "Sin valor"
        assert_eq!(
            g(json!({ "property": "s" })),
            [
                ("Pendiente".to_string(), vec!["r2".to_string()]),
                ("Hecho".to_string(), vec!["r1".into(), "r4".into()]),
                ("Sin valor".to_string(), vec!["r3".into()])
            ]
        );
        let hidden = run(json!({ "filter": { "rules": [rule("s", "is", json!("Hecho"))] }, "group": { "property": "s", "hideEmpty": true } }));
        assert_eq!(hidden.groups.unwrap().len(), 1); // "Pendiente" has no rows after filtering
                                                     // dates by month and by ISO week (Monday)
        assert_eq!(
            g(json!({ "property": "d", "granularity": "month" })),
            [
                ("Octubre 2026".to_string(), vec!["r1".to_string(), "r2".into()]),
                ("Noviembre 2026".to_string(), vec!["r3".into()]),
                ("Sin valor".to_string(), vec!["r4".into()])
            ]
        );
        let weeks = g(json!({ "property": "d", "granularity": "week" }));
        assert_eq!(weeks[0].0, "Semana del 2026-10-12"); // 13 and 15 Oct 2026 are Tue/Thu
        assert_eq!(weeks[0].1, ["r1", "r2"]);
        assert_eq!(weeks[1].0, "Semana del 2026-11-02"); // a Monday maps to itself
                                                         // relation: a row appears under every linked row, groups ordered by title
        let rel = g(json!({ "property": "rel" }));
        assert_eq!(rel[0], ("Alfa".to_string(), vec!["r1".to_string(), "r2".into()]));
        assert_eq!(rel[1], ("Zeta".to_string(), vec!["r1".to_string()]));
        // numbers order numerically, not as text (12.5 after 5)
        let nums: Vec<String> = g(json!({ "property": "n" })).into_iter().map(|(l, _)| l).collect();
        assert_eq!(nums, ["-1", "5", "12.5", "Sin valor"]);
    }

    #[test]
    fn week_math() {
        assert_eq!(date_bucket("2026-10-15", Granularity::Week).unwrap().0, "2026-10-12");
        assert_eq!(date_bucket("2026-01-01", Granularity::Week).unwrap().0, "2025-12-29"); // crosses the year
        assert_eq!(date_bucket("2024-03-03", Granularity::Week).unwrap().0, "2024-02-26"); // leap year
        assert_eq!(date_bucket("2026-10-15", Granularity::Year).unwrap().0, "2026");
        for (y, m, d) in [(1970, 1, 1), (2000, 2, 29), (2026, 12, 31), (1969, 7, 20)] {
            assert_eq!(civil_from_days(days_from_civil(y, m, d)), (y, m, d));
        }
    }

    #[test]
    fn config_is_validated_against_the_schema() {
        let schema: Schema = [("note", "text"), ("n", "number"), ("d", "date"), ("s", "select"), ("rel", "relation"), ("title", "text")]
            .into_iter()
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .collect();
        let ok = |c: Value| parse_config(&c).and_then(|c| validate_config(&c, &schema, "table")).is_ok();
        assert!(ok(json!({})));
        assert!(ok(json!({ "sorts": [{ "property": "title", "direction": "asc" }] })));
        assert!(ok(
            json!({ "filter": { "rules": [rule("n", "gt", json!(3))] }, "group": { "property": "d", "granularity": "week" } })
        ));
        // unknown property / wrong operator for the type / wrong value type
        assert!(!ok(json!({ "sorts": [{ "property": "nope", "direction": "asc" }] })));
        assert!(!ok(json!({ "filter": { "rules": [rule("n", "contains", json!("a"))] } })));
        assert!(!ok(json!({ "filter": { "rules": [rule("n", "gt", json!("3"))] } })));
        assert!(!ok(json!({ "filter": { "rules": [rule("d", "is", json!("2026-02-30"))] } })));
        assert!(!ok(json!({ "filter": { "rules": [rule("rel", "contains", json!("not-a-uuid"))] } })));
        assert!(!ok(json!({ "filter": { "rules": [rule("n", "is_empty", json!(1))] } })));
        // malformed structure / unknown operator / unknown field
        assert!(!ok(json!({ "sorts": [{ "property": "n", "direction": "sideways" }] })));
        assert!(!ok(json!({ "filter": { "rules": [{ "property": "n", "operator": "drop_table" }] } })));
        assert!(!ok(json!({ "surprise": true })));
        // grouping: not by title, granularity only for dates
        assert!(!ok(json!({ "group": { "property": "title" } })));
        assert!(!ok(json!({ "group": { "property": "s", "granularity": "day" } })));
        // limits
        let many = vec![json!({ "property": "n", "direction": "asc" }); MAX_SORTS + 1];
        assert!(!ok(json!({ "sorts": many })));
    }

    // ---- against a real database

    fn fixture() -> (Connection, String, String) {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        crate::db::run_migrations(&conn).unwrap();
        let page = databases::create_database_page(&conn).unwrap();
        let db = page.own_database_id.unwrap();
        (conn, page.id, db)
    }

    #[test]
    fn views_have_a_default_and_cannot_all_be_deleted() {
        let (conn, _, db) = fixture();
        let views = list_views(&conn, &db).unwrap();
        assert_eq!((views.len(), views[0].name.as_str(), views[0].kind.as_str()), (1, "Tabla", "table"));
        assert!(delete_view(&conn, &views[0].id).is_err()); // the only one

        let second = create_view(&conn, &db, "  Pendientes ", "table").unwrap();
        assert_eq!(second.name, "Pendientes");
        assert!(create_view(&conn, &db, "x", "kanban").is_err()); // kind not available yet
        assert!(create_view(&conn, &db, "  ", "table").is_err());
        rename_view(&conn, &second.id, "Hechas").unwrap();
        delete_view(&conn, &views[0].id).unwrap();
        assert_eq!(list_views(&conn, &db).unwrap()[0].name, "Hechas");
        assert!(create_view(&conn, &uuid::Uuid::new_v4().to_string(), "x", "table").is_err());
    }

    #[test]
    fn a_checkbox_filters_sorts_and_groups_with_unchecked_as_a_group_of_its_own() {
        let (conn, _, db) = fixture();
        let view = list_views(&conn, &db).unwrap().remove(0).id;
        let c = databases::add_property(&conn, &db, "Hecho", "checkbox", &json!({})).unwrap().id;
        let rows: Vec<String> = (0..3).map(|_| databases::create_row(&conn, &db).unwrap().id).collect();
        databases::set_value(&conn, &rows[0], &c, &json!(true)).unwrap();
        databases::set_value(&conn, &rows[2], &c, &json!(true)).unwrap();

        let ids = |config: Value| {
            update_view_config(&conn, &view, &config).unwrap();
            query_view(&conn, &view).unwrap()
        };
        // «es» marcada / sin marcar
        assert_eq!(
            ids(json!({ "filter": { "rules": [rule(&c, "is", json!(true))] } })).row_ids,
            [rows[0].clone(), rows[2].clone()]
        );
        assert_eq!(ids(json!({ "filter": { "rules": [rule(&c, "is", json!(false))] } })).row_ids, [rows[1].clone()]);
        // unchecked sorts first ascending and never counts as «empty» (which would always go last)
        assert_eq!(ids(json!({ "sorts": [{ "property": c, "direction": "asc" }] })).row_ids[0], rows[1]);
        assert_eq!(ids(json!({ "sorts": [{ "property": c, "direction": "desc" }] })).row_ids[2], rows[1]);
        // two groups, checked first, and no «Sin valor»
        let groups = ids(json!({ "group": { "property": c } })).groups.unwrap();
        let labels: Vec<&str> = groups.iter().map(|g| g.label.as_str()).collect();
        assert_eq!(labels, ["Marcada", "Sin marcar"]);
        assert_eq!(groups[0].row_ids.len(), 2);
        // only «es» with a boolean is a valid rule
        for bad in [rule(&c, "is", json!("true")), rule(&c, "is_empty", Value::Null), rule(&c, "contains", json!(true))] {
            assert!(update_view_config(&conn, &view, &json!({ "filter": { "rules": [bad] } })).is_err());
        }
    }

    #[test]
    fn saved_config_drives_the_query_and_follows_schema_changes() {
        let (conn, _, db) = fixture();
        let view = list_views(&conn, &db).unwrap().remove(0).id;
        let n = databases::add_property(&conn, &db, "N", "number", &json!({})).unwrap().id;
        let s = databases::add_property(&conn, &db, "S", "select", &json!({ "options": ["A", "B"] })).unwrap().id;
        let rows: Vec<String> = (0..3).map(|_| databases::create_row(&conn, &db).unwrap().id).collect();
        for (r, v) in rows.iter().zip([3.0, 1.0, 2.0]) {
            databases::set_value(&conn, r, &n, &json!(v)).unwrap();
        }
        databases::set_value(&conn, &rows[0], &s, &json!("A")).unwrap();

        let config = json!({
            "sorts": [{ "property": n, "direction": "asc" }],
            "filter": { "rules": [rule(&n, "gt", json!(1))] },
            "group": { "property": s }
        });
        update_view_config(&conn, &view, &config).unwrap();
        let result = query_view(&conn, &view).unwrap();
        assert_eq!(result.row_ids, [rows[2].clone(), rows[0].clone()]); // n=2 then n=3; n=1 filtered out
        assert_eq!(result.groups.unwrap().len(), 3); // A, B (empty option kept), Sin valor

        // invalid configs are rejected and the stored one is untouched
        assert!(update_view_config(&conn, &view, &json!({ "filter": { "rules": [rule(&n, "contains", json!("x"))] } })).is_err());
        assert_eq!(query_view(&conn, &view).unwrap().row_ids.len(), 2);

        // renaming an option follows into filters that use it
        update_view_config(&conn, &view, &json!({ "filter": { "rules": [rule(&s, "is", json!("A"))] }, "group": { "property": s } })).unwrap();
        databases::rename_select_option(&conn, &s, "A", "Alta").unwrap();
        assert_eq!(query_view(&conn, &view).unwrap().row_ids, [rows[0].clone()]);

        // deleting a property removes every rule that used it
        databases::delete_property(&conn, &n).unwrap();
        let config = list_views(&conn, &db).unwrap().remove(0).config;
        assert!(config["sorts"].as_array().unwrap().is_empty());
        assert_eq!(config["filter"]["rules"].as_array().unwrap().len(), 1); // the select rule stays
        assert!(config.get("group").is_some_and(|g| g["property"] == json!(s)));
        databases::delete_property(&conn, &s).unwrap();
        let config = list_views(&conn, &db).unwrap().remove(0).config;
        assert!(config["filter"]["rules"].as_array().unwrap().is_empty() && config.get("group").is_none());
    }

    #[test]
    fn tags_filter_sort_and_group_by_the_options() {
        let (conn, _, db) = fixture();
        let view = list_views(&conn, &db).unwrap().remove(0).id;
        let t = databases::add_property(&conn, &db, "T", "tags", &json!({ "options": ["Casa", "Trabajo", "Vacía"] }))
            .unwrap()
            .id;
        let rows: Vec<String> = (0..4).map(|_| databases::create_row(&conn, &db).unwrap().id).collect();
        databases::set_value(&conn, &rows[0], &t, &json!(["Trabajo", "Casa"])).unwrap();
        databases::set_value(&conn, &rows[1], &t, &json!(["Trabajo"])).unwrap();
        databases::set_value(&conn, &rows[2], &t, &json!(["Casa"])).unwrap();
        // rows[3] has no tags
        let ids = |config: Value| {
            update_view_config(&conn, &view, &config).unwrap();
            query_view(&conn, &view).unwrap()
        };

        // «contiene»: the row has that tag among others; «no contiene»: it doesn't (empty rows included)
        assert_eq!(
            ids(json!({ "filter": { "rules": [rule(&t, "contains", json!("Casa"))] } })).row_ids,
            [rows[0].clone(), rows[2].clone()]
        );
        assert_eq!(
            ids(json!({ "filter": { "rules": [rule(&t, "not_contains", json!("Casa"))] } })).row_ids,
            [rows[1].clone(), rows[3].clone()]
        );
        assert_eq!(
            ids(json!({ "filter": { "rules": [{ "property": t, "operator": "is_empty" }] } })).row_ids,
            [rows[3].clone()]
        );
        // sorted by the first tag, in the order of the options; empties last
        assert_eq!(
            ids(json!({ "sorts": [{ "property": t, "direction": "asc" }] })).row_ids,
            [rows[2].clone(), rows[0].clone(), rows[1].clone(), rows[3].clone()]
        );
        // grouped: a row under each of its tags, every option shown (even with no rows), then «Sin valor»
        let groups: Vec<(String, Vec<String>)> = ids(json!({ "group": { "property": t } }))
            .groups
            .unwrap()
            .into_iter()
            .map(|g| (g.label, g.row_ids))
            .collect();
        assert_eq!(
            groups,
            [
                ("Casa".to_string(), vec![rows[0].clone(), rows[2].clone()]),
                ("Trabajo".to_string(), vec![rows[0].clone(), rows[1].clone()]),
                ("Vacía".to_string(), vec![]),
                ("Sin valor".to_string(), vec![rows[3].clone()]),
            ]
        );

        // what a tags rule can't be: an operator of another type, a value that isn't text; a board needs a select
        assert!(update_view_config(&conn, &view, &json!({ "filter": { "rules": [rule(&t, "is", json!("Casa"))] } })).is_err());
        assert!(update_view_config(&conn, &view, &json!({ "filter": { "rules": [rule(&t, "contains", json!(3))] } })).is_err());
        let board = create_view(&conn, &db, "Tablero", "board").unwrap().id;
        assert!(update_view_config(&conn, &board, &json!({ "group": { "property": t } })).is_err());

        // renaming a tag follows into the filter that uses it
        ids(json!({ "filter": { "rules": [rule(&t, "contains", json!("Casa"))] } }));
        databases::rename_select_option(&conn, &t, "Casa", "Hogar").unwrap();
        assert_eq!(query_view(&conn, &view).unwrap().row_ids, [rows[0].clone(), rows[2].clone()]);
    }

    #[test]
    fn relation_targets_resolve_to_titles_for_sort_and_group() {
        let (conn, _, db) = fixture();
        let view = list_views(&conn, &db).unwrap().remove(0).id;
        let other = databases::create_database_page(&conn).unwrap().own_database_id.unwrap();
        let rel = databases::add_property(&conn, &db, "Rel", "relation", &json!({ "target": other })).unwrap().id;
        let (a, b) = (databases::create_row(&conn, &other).unwrap().id, databases::create_row(&conn, &other).unwrap().id);
        crate::db::set_row_title(&conn, &a, "Zeta").unwrap();
        crate::db::set_row_title(&conn, &b, "Alfa").unwrap();
        let (r1, r2) = (databases::create_row(&conn, &db).unwrap().id, databases::create_row(&conn, &db).unwrap().id);
        databases::set_value(&conn, &r1, &rel, &json!([a])).unwrap();
        databases::set_value(&conn, &r2, &rel, &json!([b])).unwrap();

        update_view_config(&conn, &view, &json!({ "sorts": [{ "property": rel, "direction": "asc" }], "group": { "property": rel } })).unwrap();
        let result = query_view(&conn, &view).unwrap();
        assert_eq!(result.row_ids, [r2.clone(), r1.clone()]); // Alfa before Zeta
        let labels: Vec<String> = result.groups.unwrap().into_iter().map(|g| g.label).collect();
        assert_eq!(labels, ["Alfa", "Zeta"]);
    }
    #[test]
    fn view_kinds_and_their_config_rules() {
        let (conn, _, db) = fixture();
        for kind in ["list", "gallery", "feed", "board"] {
            assert_eq!(create_view(&conn, &db, kind, kind).unwrap().kind, kind);
        }
        assert!(create_view(&conn, &db, "x", "kanban").is_err()); // not a kind

        let s = databases::add_property(&conn, &db, "S", "select", &json!({ "options": ["A"] })).unwrap().id;
        let n = databases::add_property(&conn, &db, "N", "number", &json!({})).unwrap().id;
        let views = list_views(&conn, &db).unwrap();
        let id_of = |kind: &str| views.iter().find(|v| v.kind == kind).unwrap().id.clone();
        // a board's columns are a select; other kinds may group by anything
        assert!(update_view_config(&conn, &id_of("board"), &json!({ "group": { "property": s } })).is_ok());
        assert!(update_view_config(&conn, &id_of("board"), &json!({ "group": { "property": n } })).is_err());
        assert!(update_view_config(&conn, &id_of("gallery"), &json!({ "group": { "property": n } })).is_ok());

        // hidden properties: must exist, can't be the title; deleting a property drops it from the list
        let list = id_of("list");
        assert!(update_view_config(&conn, &list, &json!({ "hiddenProperties": [s, n], "showPreview": false })).is_ok());
        assert!(update_view_config(&conn, &list, &json!({ "hiddenProperties": ["title"] })).is_err());
        assert!(update_view_config(&conn, &list, &json!({ "hiddenProperties": [uuid::Uuid::new_v4().to_string()] })).is_err());
        databases::delete_property(&conn, &n).unwrap();
        let cfg = list_views(&conn, &db).unwrap().into_iter().find(|v| v.id == list).unwrap().config;
        assert_eq!(cfg["hiddenProperties"], json!([s]));
    }

    #[test]
    fn previews_take_the_first_image_and_the_start_of_the_text() {
        let img = "3f0c2a9e-6b1d-4c1a-9d7e-2b8f5a1c4e60.png";
        let doc = json!({ "type": "doc", "content": [
            { "type": "heading", "attrs": { "level": 1 }, "content": [{ "type": "text", "text": "Título" }] },
            { "type": "paragraph", "content": [{ "type": "text", "text": "Primera" }] },
            { "type": "image", "attrs": { "file": img } },
            { "type": "bulletList", "content": [{ "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "segunda" }] }] }] },
            { "type": "image", "attrs": { "file": "9a1e7c52-0d3b-4f6a-8b2e-5c4d3e2f1a0b.png" } }
        ]});
        let p = extract_preview(&doc);
        assert_eq!(p.image.as_deref(), Some(img)); // the first one
        assert_eq!(p.snippet, "Primera segunda"); // title skipped, blocks kept apart

        // a bad file name never reaches the client; long text is cut
        let bad = json!({ "type": "doc", "content": [{ "type": "image", "attrs": { "file": "../../secret" } },
            { "type": "paragraph", "content": [{ "type": "text", "text": "palabra ".repeat(100) }] }] });
        let p = extract_preview(&bad);
        assert_eq!(p.image, None);
        assert!(p.snippet.ends_with('…') && p.snippet.chars().count() <= SNIPPET_CHARS + 1);
        assert_eq!(extract_preview(&json!({ "type": "doc" })), RowPreview::default());
    }

    #[test]
    fn only_gallery_and_feed_views_compute_previews() {
        let (conn, _, db) = fixture();
        let row = databases::create_row(&conn, &db).unwrap().id;
        let doc = json!({ "type": "doc", "content": [
            { "type": "heading", "attrs": { "level": 1 } },
            { "type": "paragraph", "content": [{ "type": "text", "text": "hola mundo" }] }] });
        crate::db::save_page_content(&conn, &row, &doc).unwrap();
        let view = |kind: &str| create_view(&conn, &db, kind, kind).unwrap().id;
        let (gallery, table) = (view("gallery"), view("table"));
        assert_eq!(query_view(&conn, &gallery).unwrap().previews.unwrap()[&row].snippet, "hola mundo");
        assert!(query_view(&conn, &table).unwrap().previews.is_none());
        update_view_config(&conn, &gallery, &json!({ "showPreview": false })).unwrap();
        assert!(query_view(&conn, &gallery).unwrap().previews.is_none());
    }
    #[test]
    fn date_ranges_filter_sort_and_group_by_their_start() {
        let mut data = data();
        // r1 becomes a range 10-15..10-20; r2 stays 10-13; r3 11-02; r4 none
        data.rows[0].values.insert("d".into(), json!("2026-10-15/2026-10-20"));
        let ids = |config: Value| evaluate(&data, &parse_config(&config).unwrap(), &titles()).row_ids;
        let f = |op: &str, v: &str| ids(json!({ "filter": { "rules": [rule("d", op, json!(v))] } }));
        assert_eq!(f("is", "2026-10-18"), ["r1"]); // «es» matches any day inside the range
        assert_eq!(f("is", "2026-10-21"), Vec::<String>::new());
        assert_eq!(f("before", "2026-10-15"), ["r2"]); // the rest compare the start
        assert_eq!(f("on_or_after", "2026-10-15"), ["r1", "r3"]);
        assert_eq!(ids(json!({ "sorts": [{ "property": "d", "direction": "asc" }] })), ["r2", "r1", "r3", "r4"]);
        let groups = evaluate(&data, &parse_config(&json!({ "group": { "property": "d", "granularity": "day" } })).unwrap(), &titles())
            .groups
            .unwrap();
        assert_eq!(groups[1].label, "2026-10-15"); // not "2026-10-15/2026-10-20"
                                                   // a range is not a valid filter *value*: filters compare against one day
        let schema: Schema = [("d".to_string(), "date".to_string())].into();
        let bad = parse_config(&json!({ "filter": { "rules": [rule("d", "is", json!("2026-10-15/2026-10-20"))] } })).unwrap();
        assert!(validate_config(&bad, &schema, "table").is_err());
    }

    #[test]
    fn calendar_and_timeline_need_a_date_property() {
        let (conn, _, db) = fixture();
        let d = databases::add_property(&conn, &db, "Día", "date", &json!({})).unwrap().id;
        let n = databases::add_property(&conn, &db, "N", "number", &json!({})).unwrap().id;
        let calendar = create_view(&conn, &db, "Calendario", "calendar").unwrap().id;
        let timeline = create_view(&conn, &db, "Cronograma", "timeline").unwrap().id;
        let table = create_view(&conn, &db, "Tabla 2", "table").unwrap().id;
        for view in [&calendar, &timeline] {
            assert!(update_view_config(&conn, view, &json!({ "dateProperty": d })).is_ok());
            assert!(update_view_config(&conn, view, &json!({ "dateProperty": n })).is_err()); // not a date
            assert!(update_view_config(&conn, view, &json!({ "dateProperty": "title" })).is_err());
        }
        assert!(update_view_config(&conn, &table, &json!({ "dateProperty": d })).is_err()); // other kinds don't use one
        databases::delete_property(&conn, &d).unwrap();
        let cfg = list_views(&conn, &db).unwrap().into_iter().find(|v| v.id == calendar).unwrap().config;
        assert!(cfg.get("dateProperty").is_none()); // dropped with the property
    }
    #[test]
    fn places_filter_sort_and_group_by_their_label_and_feed_the_map() {
        let (conn, _, db) = fixture();
        let p = databases::add_property(&conn, &db, "Dónde", "place", &json!({})).unwrap().id;
        let n = databases::add_property(&conn, &db, "N", "number", &json!({})).unwrap().id;
        let rows: Vec<String> = (0..3).map(|_| databases::create_row(&conn, &db).unwrap().id).collect();
        databases::set_value(&conn, &rows[0], &p, &json!({ "name": "Plaza Mayor", "lat": 40.4, "lng": -3.7 })).unwrap();
        databases::set_value(&conn, &rows[1], &p, &json!({ "name": "Alhambra" })).unwrap();
        let view = create_view(&conn, &db, "Mapa", "map").unwrap().id;

        let q = |config: Value| {
            update_view_config(&conn, &view, &config).unwrap();
            query_view(&conn, &view).unwrap()
        };
        assert_eq!(q(json!({ "filter": { "rules": [rule(&p, "contains", json!("PLAZA"))] } })).row_ids, [rows[0].clone()]);
        assert_eq!(q(json!({ "filter": { "rules": [{ "property": p, "operator": "is_empty" }] } })).row_ids, [rows[2].clone()]);
        assert_eq!(
            q(json!({ "sorts": [{ "property": p, "direction": "asc" }] })).row_ids,
            [rows[1].clone(), rows[0].clone(), rows[2].clone()]
        );
        let groups = q(json!({ "group": { "property": p } })).groups.unwrap();
        assert_eq!(groups.iter().map(|g| g.label.as_str()).collect::<Vec<_>>(), ["Alhambra", "Plaza Mayor", "Sin valor"]);

        // the map's place property: map views only, place kind only, dropped with the property
        assert!(update_view_config(&conn, &view, &json!({ "placeProperty": p })).is_ok());
        assert!(update_view_config(&conn, &view, &json!({ "placeProperty": n })).is_err());
        let table = list_views(&conn, &db).unwrap().into_iter().find(|v| v.kind == "table").unwrap().id;
        assert!(update_view_config(&conn, &table, &json!({ "placeProperty": p })).is_err());
        assert!(update_view_config(&conn, &view, &json!({ "dateProperty": p })).is_err()); // dates are for calendars
        databases::delete_property(&conn, &p).unwrap();
        assert!(list_views(&conn, &db)
            .unwrap()
            .into_iter()
            .find(|v| v.id == view)
            .unwrap()
            .config
            .get("placeProperty")
            .is_none());
    }
    #[test]
    fn charts_aggregate_each_group() {
        let chart = |group: Value, chart: Value| {
            let config = parse_config(&json!({ "group": group, "chart": chart })).unwrap();
            let result = evaluate(&data(), &config, &titles());
            build_chart(&data(), &result, &config.chart.unwrap())
        };
        let pairs = |c: &ChartResult| c.points.iter().map(|p| (p.label.clone(), p.value)).collect::<Vec<_>>();
        let by_state = json!({ "property": "s" });

        // count per select option, "Sin valor" last
        let counts = chart(by_state.clone(), json!({}));
        assert_eq!(
            pairs(&counts),
            [("Pendiente".to_string(), Some(1.0)), ("Hecho".to_string(), Some(2.0)), ("Sin valor".to_string(), Some(1.0))]
        );
        // sum / avg / min / max of a number; a group with no numbers has no value
        let sum = chart(by_state.clone(), json!({ "aggregate": "sum", "value": "n" }));
        assert_eq!(
            pairs(&sum),
            [
                ("Pendiente".to_string(), Some(12.5)),
                ("Hecho".to_string(), Some(5.0)),
                ("Sin valor".to_string(), Some(-1.0))
            ]
        );
        let avg = chart(json!({ "property": "d", "granularity": "month" }), json!({ "aggregate": "avg", "value": "n" }));
        assert_eq!(avg.points[0].value, Some(8.75)); // (5 + 12.5) / 2 in October
        assert_eq!(avg.points[2].value, None); // the row without a date has no n
        let max = chart(by_state.clone(), json!({ "aggregate": "max", "value": "n" }));
        assert_eq!(max.points[1].value, Some(5.0));
        // sorting by value
        let desc = chart(by_state.clone(), json!({ "sort": "desc" }));
        assert_eq!(desc.points[0].label, "Hecho");
        // ...but never a line's points
        let line = chart(by_state.clone(), json!({ "type": "line", "sort": "desc" }));
        assert_eq!(line.points[0].label, "Pendiente");
        // the number type is one total over every row, no group needed
        let total = chart(Value::Null, json!({ "type": "number", "aggregate": "sum", "value": "n" }));
        assert_eq!(pairs(&total), [("Total".to_string(), Some(16.5))]);
        // no group, no axis
        let config = parse_config(&json!({ "chart": {} })).unwrap();
        let none = build_chart(&data(), &evaluate(&data(), &config, &titles()), &config.chart.unwrap());
        assert!(none.points.is_empty());
    }

    #[test]
    fn chart_config_is_validated_and_follows_the_schema() {
        let (conn, _, db) = fixture();
        let n = databases::add_property(&conn, &db, "N", "number", &json!({})).unwrap().id;
        let t = databases::add_property(&conn, &db, "T", "text", &json!({})).unwrap().id;
        let chart = create_view(&conn, &db, "Gráfico", "chart").unwrap().id;
        let table = create_view(&conn, &db, "Tabla 2", "table").unwrap().id;
        assert!(update_view_config(&conn, &chart, &json!({ "chart": { "type": "donut", "aggregate": "sum", "value": n } })).is_ok());
        assert!(update_view_config(&conn, &chart, &json!({ "chart": { "type": "pie" } })).is_err()); // unknown type
        assert!(update_view_config(&conn, &chart, &json!({ "chart": { "aggregate": "sum" } })).is_err()); // needs a property
        assert!(update_view_config(&conn, &chart, &json!({ "chart": { "aggregate": "sum", "value": t } })).is_err()); // not a number
        assert!(update_view_config(&conn, &chart, &json!({ "chart": { "value": uuid::Uuid::new_v4().to_string() } })).is_err());
        assert!(update_view_config(&conn, &table, &json!({ "chart": {} })).is_err()); // only chart views
                                                                                      // deleting the property falls back to counting
        update_view_config(&conn, &chart, &json!({ "chart": { "aggregate": "avg", "value": n } })).unwrap();
        databases::delete_property(&conn, &n).unwrap();
        let cfg = list_views(&conn, &db).unwrap().into_iter().find(|v| v.id == chart).unwrap().config;
        assert_eq!(cfg["chart"], json!({ "type": "bar", "aggregate": "count", "sort": "x" }));
        assert!(query_view(&conn, &chart).unwrap().chart.is_some());
        assert!(query_view(&conn, &table).unwrap().chart.is_none());
    }

    #[test]
    fn dashboards_compute_each_widget_over_their_own_filtered_rows() {
        let widget = |id: &str, chart: Value, group: Value, filter: Value| json!({ "id": id, "chart": chart, "group": group, "filter": filter });
        let (w1, w2) = ("3f0c2a9e-6b1d-4c1a-9d7e-2b8f5a1c4e01", "3f0c2a9e-6b1d-4c1a-9d7e-2b8f5a1c4e02");
        let config = parse_config(&json!({
            "filter": { "rules": [rule("n", "is_not_empty", Value::Null)] },
            "dashboard": { "widgets": [
                widget(w1, json!({ "type": "number" }), Value::Null, json!({})),
                widget(w2, json!({ "type": "bar" }), json!({ "property": "s" }), json!({ "rules": [rule("n", "gt", json!(4))] })),
            ] }
        }))
        .unwrap();
        let widgets = build_dashboard(&data(), &config, &titles());
        // the view's filter keeps r1, r2, r3 (the ones with a number): the total counts 3
        assert_eq!(widgets[0].points[0].value, Some(3.0));
        // the widget's own filter then keeps r1, r2 (n > 4): Pendiente 1, Hecho 1, nothing without value
        let by_state: Vec<(String, Option<f64>)> = widgets[1].points.iter().map(|p| (p.label.clone(), p.value)).collect();
        assert_eq!(by_state, [("Pendiente".to_string(), Some(1.0)), ("Hecho".to_string(), Some(1.0))]);
        assert!(build_dashboard(&data(), &ViewConfig::default(), &titles()).is_empty());
    }

    #[test]
    fn dashboard_config_is_validated_and_follows_the_schema() {
        let (conn, _, db) = fixture();
        let n = databases::add_property(&conn, &db, "N", "number", &json!({})).unwrap().id;
        let t = databases::add_property(&conn, &db, "T", "text", &json!({})).unwrap().id;
        let board = create_view(&conn, &db, "Panel", "dashboard").unwrap().id;
        let table = create_view(&conn, &db, "Tabla 2", "table").unwrap().id;
        let id = |k: u8| format!("3f0c2a9e-6b1d-4c1a-9d7e-2b8f5a1c4e{k:02}");
        let ok = |widgets: Value| update_view_config(&conn, &board, &json!({ "dashboard": { "widgets": widgets } }));

        assert!(ok(json!([{ "id": id(1), "chart": { "aggregate": "sum", "value": n }, "group": { "property": t }, "wide": true }])).is_ok());
        assert!(ok(json!([{ "id": "nope" }])).is_err()); // not a uuid
        assert!(ok(json!([{ "id": id(1) }, { "id": id(1) }])).is_err()); // duplicate ids
        assert!(ok(json!([{ "id": id(1), "chart": { "aggregate": "sum", "value": t } }])).is_err()); // not a number
        assert!(ok(json!([{ "id": id(1), "filter": { "rules": [{ "property": "gone", "operator": "is_empty" }] } }])).is_err());
        assert!(ok(json!([{ "id": id(1), "colour": "red" }])).is_err()); // unknown field
        let many: Vec<Value> = (0..=MAX_WIDGETS as u8).map(|k| json!({ "id": id(k) })).collect();
        assert!(ok(json!(many)).is_err());
        assert!(update_view_config(&conn, &table, &json!({ "dashboard": { "widgets": [] } })).is_err()); // only dashboards

        // deleting a property cleans every widget that used it
        ok(json!([{ "id": id(1), "chart": { "aggregate": "avg", "value": n }, "group": { "property": n }, "filter": { "rules": [rule(&n, "gt", json!(1))] } }])).unwrap();
        databases::delete_property(&conn, &n).unwrap();
        let cfg = list_views(&conn, &db).unwrap().into_iter().find(|v| v.id == board).unwrap().config;
        let w = &cfg["dashboard"]["widgets"][0];
        assert_eq!(w["chart"], json!({ "type": "bar", "aggregate": "count", "sort": "x" }));
        assert!(w.get("group").is_none());
        assert_eq!(w["filter"]["rules"], json!([]));
        assert_eq!(query_view(&conn, &board).unwrap().widgets.unwrap().len(), 1);
        assert!(query_view(&conn, &table).unwrap().widgets.is_none());
    }

    #[test]
    fn column_widths_are_validated() {
        let schema: Schema = [("a".to_string(), "text".to_string())].into();
        let ok = |c: Value, kind: &str| parse_config(&c).and_then(|c| validate_config(&c, &schema, kind)).is_ok();
        assert!(ok(json!({ "columnWidths": { "title": 320, "a": 60 } }), "table"));
        assert!(ok(json!({ "columnWidths": { "a": 1000 } }), "form"));
        assert!(!ok(json!({ "columnWidths": { "gone": 200 } }), "table")); // no such column
        assert!(!ok(json!({ "columnWidths": { "a": 59 } }), "table"));
        assert!(!ok(json!({ "columnWidths": { "a": 1001 } }), "table"));
        assert!(!ok(json!({ "columnWidths": { "a": -5 } }), "table"));
        assert!(!ok(json!({ "columnWidths": { "a": "200" } }), "table"));
        assert!(!ok(json!({ "columnWidths": { "a": 200 } }), "gallery")); // only tables have columns
    }

    #[test]
    fn calculations_freezing_and_wrapping_are_validated() {
        let schema: Schema = [
            ("t".to_string(), "text".to_string()),
            ("n".to_string(), "number".to_string()),
            ("d".to_string(), "date".to_string()),
            (TITLE.to_string(), "text".to_string()),
        ]
        .into();
        let ok = |c: Value, kind: &str| parse_config(&c).and_then(|c| validate_config(&c, &schema, kind)).is_ok();
        assert!(ok(
            json!({ "calculations": { "title": "count_all", "t": "percent_empty", "n": "sum", "d": "latest" } }),
            "table"
        ));
        assert!(!ok(json!({ "calculations": { "t": "sum" } }), "table")); // sums need numbers
        assert!(!ok(json!({ "calculations": { "n": "earliest" } }), "table")); // earliest needs dates
        assert!(!ok(json!({ "calculations": { "n": "total" } }), "table")); // unknown calculation
        assert!(!ok(json!({ "calculations": { "gone": "count_all" } }), "table"));
        assert!(!ok(json!({ "calculations": { "n": "sum" } }), "board"));
        assert!(ok(json!({ "frozenUpTo": "title", "wrapped": ["t", "title"] }), "table"));
        assert!(!ok(json!({ "frozenUpTo": "gone" }), "table"));
        assert!(!ok(json!({ "wrapped": ["t", "t"] }), "table"));
        assert!(!ok(json!({ "wrapped": ["gone"] }), "table"));
        assert!(!ok(json!({ "frozenUpTo": "t" }), "gallery"));
    }

    #[test]
    fn form_config_is_validated() {
        let schema: Schema = [("a".to_string(), "text".to_string()), ("title".to_string(), "text".to_string())].into();
        let ok = |c: Value, kind: &str| parse_config(&c).and_then(|c| validate_config(&c, &schema, kind)).is_ok();
        let field = |p: &str| json!({ "property": p, "required": true, "label": "¿Cómo te llamas?", "help": "Nombre completo" });
        assert!(ok(
            json!({ "form": { "title": "Contacto", "description": "x", "submitLabel": "Enviar", "successMessage": "¡Gracias!", "fields": [field("title"), field("a")] } }),
            "form"
        ));
        assert!(ok(json!({ "form": {} }), "form")); // everything defaulted
        assert!(!ok(json!({ "form": { "fields": [field("nope")] } }), "form")); // unknown property
        assert!(!ok(json!({ "form": { "fields": [field("a"), field("a")] } }), "form")); // twice
        assert!(!ok(json!({ "form": { "title": "x".repeat(101) } }), "form"));
        assert!(!ok(json!({ "form": { "fields": [{ "property": "a", "colour": 1 }] } }), "form")); // unknown field
        assert!(!ok(json!({ "form": {} }), "table")); // only a form view has a form
        let many: Vec<Value> = (0..=MAX_FORM_FIELDS).map(|_| field("a")).collect();
        assert!(!ok(json!({ "form": { "fields": many } }), "form"));
    }

    #[test]
    fn submitting_a_form_creates_a_row_or_nothing() {
        let (conn, _, db) = fixture();
        let note = databases::add_property(&conn, &db, "Nota", "text", &json!({})).unwrap().id;
        let n = databases::add_property(&conn, &db, "Horas", "number", &json!({})).unwrap().id;
        let form = create_view(&conn, &db, "Formulario", "form").unwrap().id;
        let table = list_views(&conn, &db).unwrap().into_iter().find(|v| v.kind == "table").unwrap().id;
        let rows = |conn: &Connection| databases::get_database(conn, &db).unwrap().unwrap().rows;
        let submit = |values: Value| submit_form(&conn, &form, values.as_object().unwrap());

        // with no form config yet it asks for the title (required) and every property
        let row = submit(json!({ "title": "Mi respuesta", note.clone(): "hola", n.clone(): 3 })).unwrap();
        let data = rows(&conn);
        assert_eq!((data.len(), data[0].title.as_str()), (1, "Mi respuesta"));
        assert_eq!(data[0].values.get(&note), Some(&json!("hola")));
        assert_eq!(data[0].page_id, row.id);

        assert!(submit(json!({ note.clone(): "sin título" })).is_err()); // the title is required by default
        assert!(submit(json!({ "title": "x", n.clone(): "tres" })).is_err()); // a value of the wrong type...
        assert_eq!(rows(&conn).len(), 1); // ...leaves no half-made row behind
        assert!(submit(json!({ "title": "x", "extra": 1 })).is_err()); // not a question of this form
        assert_eq!(rows(&conn).len(), 1);

        // configured: only some questions, one of them required
        update_view_config(
            &conn,
            &form,
            &json!({ "form": { "fields": [
            { "property": "title" }, { "property": note, "required": true, "label": "Tu mensaje" }] } }),
        )
        .unwrap();
        let err = submit(json!({ "title": "t" })).unwrap_err();
        assert!(err.contains("Tu mensaje"), "{err}"); // the error names the question as the form shows it
        assert!(submit(json!({ "title": "t", note.clone(): "   " })).is_err()); // blanks don't count
        assert!(submit(json!({ "title": "t", n.clone(): 1, note.clone(): "ok" })).is_err()); // Horas isn't asked any more
        assert!(submit(json!({ note.clone(): "ok" })).is_ok()); // the title is optional here
        assert_eq!(rows(&conn).len(), 2);

        assert!(submit_form(&conn, &table, json!({}).as_object().unwrap()).is_err());
        // only a form view submits
    }
}
