//! Familias: the tasks grouped by what they have in common (a select, tags or a relation column of
//! the task database), each family sized by its number of tasks or by the sum of a number column. Rust does the
//! grouping with the same code views use (`views::evaluate`), so a task with two tags is in both families; the
//! page only draws bubbles or a ranked list and never groups by itself.

use crate::databases::{self, PropertyInfo, RowInfo, COLORS};
use crate::tasks;
use crate::views::{self, Aggregate, GroupRule, ViewConfig};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;

/// Property kinds a family can be made of.
const GROUPABLE: [&str; 3] = ["select", "tags", "relation"];
/// Most families shown (the rest would be bubbles too small to see).
const MAX_FAMILIES: usize = 100;

#[derive(Serialize, Debug, PartialEq)]
pub struct FamilyTask {
    pub id: String,
    pub title: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Family {
    pub key: String,
    pub label: String,
    /// The option's colour (select and tags), as a name from `databases::COLORS`.
    pub color: Option<String>,
    /// Tasks counted, or the sum of the measure column over them.
    pub size: f64,
    pub tasks: Vec<FamilyTask>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct PropertyRef {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Families {
    /// The column the families come from (the first tags, select or relation column when none is asked for).
    pub property: Option<String>,
    /// The columns that can make families, for the picker.
    pub groupable: Vec<PropertyRef>,
    /// The number columns a family can be sized by.
    pub measurable: Vec<PropertyRef>,
    /// Biggest first.
    pub families: Vec<Family>,
    /// Families before the cap.
    pub total: usize,
}

fn refs(properties: &[PropertyInfo], kinds: &[&str]) -> Vec<PropertyRef> {
    properties
        .iter()
        .filter(|p| kinds.contains(&p.kind.as_str()))
        .map(|p| PropertyRef {
            id: p.id.clone(),
            name: p.name.clone(),
        })
        .collect()
}

/// The colour an option wears: the one picked for it, or the one its position gives (as the table does).
fn option_color(property: &PropertyInfo, option: &str) -> Option<String> {
    if !matches!(property.kind.as_str(), "select" | "tags") {
        return None;
    }
    let chosen = property.config.get("colors").and_then(|c| c.get(option)).and_then(Value::as_str);
    let position = property.config.get("options").and_then(Value::as_array)?.iter().position(|o| o.as_str() == Some(option))?;
    Some(chosen.unwrap_or(COLORS[position % COLORS.len()]).to_string())
}

/// The families of the task database. `property` (a groupable column) and `measure` (a number column; none = count)
/// are checked here, whoever asks.
pub fn list_families(conn: &Connection, property: Option<&str>, measure: Option<&str>) -> Result<Families, String> {
    let nothing = |groupable, measurable| Families {
        property: None,
        groupable,
        measurable,
        families: Vec::new(),
        total: 0,
    };
    let Some(base) = tasks::existing(conn)? else {
        return Ok(nothing(Vec::new(), Vec::new()));
    };
    let Some(data) = databases::get_database(conn, &base.database_id)? else {
        return Ok(nothing(Vec::new(), Vec::new()));
    };
    let groupable = refs(&data.properties, &GROUPABLE);
    let measurable = refs(&data.properties, &["number"]);

    let chosen = match property {
        Some(id) => {
            if !groupable.iter().any(|p| p.id == id) {
                return Err("Las familias se agrupan por una columna de selección, etiquetas o relación".to_string());
            }
            id.to_string()
        }
        // tags are what «categories» are, so they come first
        None => match data
            .properties
            .iter()
            .find(|p| p.kind == "tags")
            .or_else(|| data.properties.iter().find(|p| GROUPABLE.contains(&p.kind.as_str())))
        {
            Some(p) => p.id.clone(),
            None => return Ok(nothing(groupable, measurable)),
        },
    };
    if let Some(id) = measure {
        if !measurable.iter().any(|p| p.id == id) {
            return Err("Las familias solo se miden con una columna numérica".to_string());
        }
    }
    let aggregate = if measure.is_some() { Aggregate::Sum } else { Aggregate::Count };

    let titles = views::target_titles(conn, &data)?;
    let config = ViewConfig {
        group: Some(GroupRule {
            property: chosen.clone(),
            granularity: None,
            hide_empty: true,
        }),
        ..Default::default()
    };
    let result = views::evaluate(&data, &config, &titles);
    let property_info = data.properties.iter().find(|p| p.id == chosen);
    let mut families: Vec<Family> = result
        .groups
        .unwrap_or_default()
        .into_iter()
        .map(|group| {
            let rows: Vec<&RowInfo> = group.row_ids.iter().filter_map(|id| data.rows.iter().find(|r| &r.page_id == id)).collect();
            Family {
                size: views::aggregate(&rows, aggregate, measure).unwrap_or(0.0),
                color: property_info.and_then(|p| option_color(p, &group.key)),
                tasks: rows
                    .iter()
                    .map(|r| FamilyTask {
                        id: r.page_id.clone(),
                        title: r.title.clone(),
                    })
                    .collect(),
                key: group.key,
                label: group.label,
            }
        })
        .filter(|f| !f.tasks.is_empty())
        .collect();
    families.sort_by(|a, b| {
        b.size
            .partial_cmp(&a.size)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.tasks.len().cmp(&a.tasks.len()))
    });
    let total = families.len();
    families.truncate(MAX_FAMILIES);
    Ok(Families {
        property: Some(chosen),
        groupable,
        measurable,
        families,
        total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use serde_json::json;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        db::run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn without_tasks_or_a_task_base_there_are_no_families() {
        let conn = conn();
        assert_eq!(list_families(&conn, None, None).unwrap().families.len(), 0);
        tasks::ensure_task_base(&conn).unwrap();
        let none = list_families(&conn, None, None).unwrap();
        assert!(none.families.is_empty());
        assert_eq!(none.groupable.len(), 2, "Estado and Categorías");
    }

    #[test]
    fn tasks_group_by_tags_into_families_biggest_first_and_a_task_can_be_in_two() {
        let conn = conn();
        let base = tasks::ensure_task_base(&conn).unwrap();
        let data = databases::get_database(&conn, &base.database_id).unwrap().unwrap();
        let tags = data.properties.iter().find(|p| p.kind == "tags").unwrap().id.clone();
        databases::set_select_options(&conn, &tags, &json!(["Casa", "Trabajo"])).unwrap();
        let a = tasks::add_task(&conn, "a").unwrap().id;
        let b = tasks::add_task(&conn, "b").unwrap().id;
        let c = tasks::add_task(&conn, "c").unwrap().id;
        let loose = tasks::add_task(&conn, "sin").unwrap().id;
        databases::set_value(&conn, &a, &tags, &json!(["Trabajo"])).unwrap();
        databases::set_value(&conn, &b, &tags, &json!(["Trabajo", "Casa"])).unwrap();
        databases::set_value(&conn, &c, &tags, &json!(["Casa"])).unwrap();

        let found = list_families(&conn, None, None).unwrap();
        assert_eq!(found.property.as_deref(), Some(tags.as_str()), "tags by default");
        let with = |label: &str| found.families.iter().find(|f| f.label == label).unwrap();
        assert_eq!((with("Casa").tasks.len(), with("Trabajo").tasks.len()), (2, 2));
        assert_eq!(with("Casa").size, 2.0, "sized by count");
        assert!(found.families.windows(2).all(|w| w[0].size >= w[1].size), "biggest first");
        // «b» is in both families; the task with no tag still belongs somewhere
        assert!(with("Casa").tasks.iter().any(|t| t.id == b) && with("Trabajo").tasks.iter().any(|t| t.id == b));
        assert!(found.families.iter().any(|f| f.tasks.iter().any(|t| t.id == loose)));
        assert!(with("Casa").color.is_some(), "options keep their colour");
    }

    #[test]
    fn families_can_be_sized_by_a_number_and_grouped_by_another_column() {
        let conn = conn();
        let base = tasks::ensure_task_base(&conn).unwrap();
        let data = databases::get_database(&conn, &base.database_id).unwrap().unwrap();
        let state = data.properties.iter().find(|p| p.kind == "select").unwrap().id.clone();
        let effort = databases::add_property(&conn, &base.database_id, "Esfuerzo", "number", &json!({})).unwrap().id;
        let a = tasks::add_task(&conn, "a").unwrap().id;
        let b = tasks::add_task(&conn, "b").unwrap().id;
        databases::set_value(&conn, &a, &state, &json!("En curso")).unwrap();
        databases::set_value(&conn, &b, &state, &json!("Por hacer")).unwrap();
        databases::set_value(&conn, &a, &effort, &json!(8)).unwrap();
        databases::set_value(&conn, &b, &effort, &json!(3)).unwrap();
        let found = list_families(&conn, Some(&state), Some(&effort)).unwrap();
        assert_eq!(found.families[0].label, "En curso");
        assert_eq!(found.families[0].size, 8.0);
        assert_eq!(found.families[1].size, 3.0);
        assert_eq!(found.measurable.len(), 1);
        // bad choices are refused
        assert!(list_families(&conn, Some(&effort), None).is_err(), "a number is not a family");
        assert!(list_families(&conn, Some("nope"), None).is_err());
        assert!(list_families(&conn, Some(&state), Some(&state)).is_err(), "only numbers measure");
    }
}
