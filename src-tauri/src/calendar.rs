//! the Gestor's calendar. An entry is a block of time that is either a **scheduled task** (`task_id`:
//! its title is the task's, and the same task can be scheduled as many times as wanted) or a **standalone
//! appointment** (its own title, no task behind it). Times are «floating» local times, `YYYY-MM-DDTHH:MM`, with no
//! time zone: «at 10:00» is 10:00 wherever you are, so there is no daylight-saving trouble; an all-day entry holds
//! only dates (`YYYY-MM-DD`, the end inclusive). Every write is validated here, whoever sends it.
//!
//! A timed entry may run across midnight (its end is on a later day).
//!
//! **Repetition (8.5).** An entry may carry a rule (`Repeat`: daily, weekly on chosen weekdays, monthly or yearly,
//! every N, until a date or after N times). The row is the *series*; `list_entries` expands it into occurrences
//! (the entry shifted to each day, `occurrence` = that day). Editing or deleting one occurrence asks for a **scope**:
//! only this one (the day is skipped in `calendar_exceptions` and, for an edit, a copy of its own is made), this and the
//! following (the series is cut the day before and a new one starts here) or all. Known limit: monthly means the same
//! day of the month (a month without it is skipped, as in iCalendar); it can also be the n-th (or the last) weekday of
//! the month («the third Tuesday»), or the last day of the month.

use crate::databases::{self, COLORS};
use crate::db::{self, is_valid_iso_date};
use crate::tasks;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const MAX_TITLE: usize = 200;
const MAX_LOCATION: usize = 200;
const MAX_NOTE: usize = 2_000;
/// An entry per task and in all (a calendar with more is a calendar nobody reads).
const MAX_PER_TASK: i64 = 200;
const MAX_TOTAL: i64 = 10_000;
/// The longest all-day entry, and the widest range one query reads.
const MAX_DAYS: i64 = 366;

fn sql<E: ToString>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEntry {
    pub id: String,
    /// Set for a scheduled task.
    pub task_id: Option<String>,
    /// The task's title, or the appointment's own.
    pub title: String,
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub color: Option<String>,
    pub location: Option<String>,
    pub note: Option<String>,
    /// The rule of a repeating entry (the same on each of its occurrences).
    pub repeat: Option<Repeat>,
    /// For a repeating entry, the day this occurrence starts on (its identity inside the series).
    pub occurrence: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

/// How an entry repeats: every `interval` days/weeks/months/years; weekly can name the weekdays (0 = Monday … 6 = Sunday,
/// none = the weekday it starts on); it ends never, on `until` (inclusive) or after `count` occurrences.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Repeat {
    pub freq: Freq,
    pub interval: u32,
    #[serde(default)]
    pub weekdays: Vec<u8>,
    #[serde(default)]
    pub until: Option<String>,
    #[serde(default)]
    pub count: Option<u32>,
    /// Monthly or yearly: the 1st–4th (or, with -1, the last) `weekdays[0]` of the month instead of a day number.
    #[serde(default)]
    pub nth: Option<i8>,
    /// Monthly: the last day of the month, whatever its number.
    #[serde(default)]
    pub last_day: bool,
}

/// Which occurrences of a series an edit or a deletion reaches.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    This,
    Following,
    All,
}

/// What the client sends to create or change an entry (the whole entry each time).
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntryInput {
    pub task_id: Option<String>,
    pub title: Option<String>,
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub color: Option<String>,
    pub location: Option<String>,
    pub note: Option<String>,
    #[serde(default)]
    pub repeat: Option<Repeat>,
}

/// A task's due date, to show on its day.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Deadline {
    pub task_id: String,
    pub title: String,
    pub date: String,
}

/// Minutes since midnight of a `YYYY-MM-DDTHH:MM` time, and its date.
fn parse_time(s: &str) -> Result<(&str, u32), String> {
    let bad = || format!("Hora no válida: {s} (AAAA-MM-DDTHH:MM)");
    let (date, time) = s.split_once('T').ok_or_else(bad)?;
    let (h, m) = time.split_once(':').ok_or_else(bad)?;
    if !is_valid_iso_date(date) || h.len() != 2 || m.len() != 2 {
        return Err(bad());
    }
    let (h, m): (u32, u32) = (h.parse().map_err(|_| bad())?, m.parse().map_err(|_| bad())?);
    // `24:00` is how a block that runs to midnight ends (it is never a start)
    if h > 24 || m > 59 || (h == 24 && m > 0) {
        return Err(bad());
    }
    Ok((date, h * 60 + m))
}

/// Days since 1970-01-01 of a civil date (Howard Hinnant's algorithm), the same count the client uses.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub(crate) fn day_number(date: &str) -> i64 {
    // Total on purpose: a day that came from the client may be anything until it is validated, and
    // a panic aborts the whole app (`panic = "abort"` in the release profile).
    let mut parts = date.split('-').map(|n| n.parse().unwrap_or(0));
    let (y, m, d) = (parts.next().unwrap_or(0), parts.next().unwrap_or(0), parts.next().unwrap_or(0));
    days_from_civil(y, m, d)
}

/// The civil date of a day number, as `YYYY-MM-DD`.
pub(crate) fn iso(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

fn days_in_month(y: i64, m: i64) -> i64 {
    days_from_civil(if m == 12 { y + 1 } else { y }, if m == 12 { 1 } else { m + 1 }, 1) - days_from_civil(y, m, 1)
}

/// 0 = Monday … 6 = Sunday (1970-01-01 was a Thursday).
fn weekday(days: i64) -> i64 {
    (days + 3).rem_euclid(7)
}

/// A time or date moved `days` days, keeping the time of day.
pub(crate) fn shift(time: &str, days: i64) -> String {
    // `get` and not `[..10]`: byte slicing panics on short text and in the middle of a character.
    format!("{}{}", iso(day_number(time.get(..10).unwrap_or(time)) + days), time.get(10..).unwrap_or(""))
}

fn opt_text(v: &Option<String>, what: &str, max: usize) -> Result<Option<String>, String> {
    let t = v.as_deref().map(str::trim).filter(|t| !t.is_empty());
    match t {
        Some(t) if t.chars().count() > max => Err(format!("{what} no puede pasar de {max} caracteres")),
        other => Ok(other.map(str::to_string)),
    }
}

/// Everything about an entry that must hold before it is stored.
struct Clean {
    task_id: Option<String>,
    title: Option<String>,
    start: String,
    end: String,
    all_day: bool,
    color: Option<String>,
    location: Option<String>,
    note: Option<String>,
    repeat: Option<Repeat>,
}

/// The longest a rule may be every-N'd and the most occurrences it may be told to make.
const MAX_INTERVAL: u32 = 99;
const MAX_COUNT: u32 = 999;
/// How far one expansion walks (a rule that never produces in range stops here) and how many occurrences it returns.
const MAX_STEPS: i64 = 100_000;
const MAX_OCCURRENCES: usize = 5_000;

/// A rule's checks, and its normal form (weekdays sorted and unique).
fn check_repeat(rule: &Repeat, start_date: &str) -> Result<Repeat, String> {
    if !(1..=MAX_INTERVAL).contains(&rule.interval) {
        return Err(format!("«Cada» tiene que estar entre 1 y {MAX_INTERVAL}"));
    }
    let mut weekdays = rule.weekdays.clone();
    weekdays.sort_unstable();
    weekdays.dedup();
    if weekdays.iter().any(|w| *w > 6) {
        return Err("Los días de la semana van de 0 (lunes) a 6 (domingo)".to_string());
    }
    let monthish = matches!(rule.freq, Freq::Monthly | Freq::Yearly);
    match rule.nth {
        Some(n) => {
            if !monthish || !matches!(n, 1..=4 | -1) {
                return Err("«El n-ésimo día de la semana» solo vale en una repetición mensual o anual (1.º–4.º o el último)".to_string());
            }
            if rule.last_day {
                return Err("«El último día del mes» no se combina con «el n-ésimo día de la semana»".to_string());
            }
            if weekdays.is_empty() {
                weekdays = vec![weekday(day_number(start_date)) as u8]; // the weekday it starts on
            }
            if weekdays.len() != 1 {
                return Err("«El n-ésimo día de la semana» necesita exactamente un día de la semana".to_string());
            }
        }
        None if rule.freq != Freq::Weekly && !weekdays.is_empty() => {
            return Err("Los días de la semana solo valen en una repetición semanal (o mensual y anual con «el n-ésimo»)".to_string());
        }
        None => {}
    }
    if rule.last_day && rule.freq != Freq::Monthly {
        return Err("«El último día del mes» solo vale en una repetición mensual".to_string());
    }
    if rule.until.is_some() && rule.count.is_some() {
        return Err("Una repetición termina en una fecha o tras un número de veces, no las dos".to_string());
    }
    if let Some(until) = &rule.until {
        if !is_valid_iso_date(until) || until.as_str() < start_date {
            return Err("La fecha en que termina la repetición no es válida o es anterior al inicio".to_string());
        }
    }
    if rule.count.is_some_and(|n| !(1..=MAX_COUNT).contains(&n)) {
        return Err(format!("El número de repeticiones tiene que estar entre 1 y {MAX_COUNT}"));
    }
    Ok(Repeat { weekdays, ..rule.clone() })
}

/// Calls `f` with the start day of each occurrence of a rule that starts on `first`, in order, until the rule ends,
/// `up_to` is passed or `f` says stop. The occurrences are the rule's own: skipped days are the caller's business
/// (and count towards «after N times», as in iCalendar).
pub(crate) fn starts(rule: &Repeat, first: &str, up_to: i64, mut f: impl FnMut(i64) -> bool) {
    let d0 = day_number(first);
    let limit = up_to.min(rule.until.as_deref().map_or(i64::MAX, day_number));
    let max = rule.count.unwrap_or(u32::MAX);
    let mut made = 0u32;
    let step = i64::from(rule.interval);
    // false = stop
    let mut emit = |d: i64| -> bool {
        if d < d0 {
            return true;
        }
        if d > limit || made >= max {
            return false;
        }
        made += 1;
        f(d)
    };
    match rule.freq {
        Freq::Daily => {
            for i in 0..MAX_STEPS {
                if !emit(d0 + i * step) {
                    break;
                }
            }
        }
        Freq::Weekly => {
            let monday = d0 - weekday(d0);
            let days: Vec<i64> = if rule.weekdays.is_empty() {
                vec![weekday(d0)]
            } else {
                rule.weekdays.iter().map(|w| i64::from(*w)).collect()
            };
            'weeks: for w in 0..MAX_STEPS {
                for wd in &days {
                    if !emit(monday + w * 7 * step + wd) {
                        break 'weeks;
                    }
                }
            }
        }
        Freq::Monthly | Freq::Yearly => {
            let p: Vec<i64> = first.split('-').map(|n| n.parse().unwrap_or(0)).collect();
            let (y0, m0, day) = (p[0], p[1], p[2]);
            let by_year = rule.freq == Freq::Yearly;
            let wd = i64::from(rule.weekdays.first().copied().unwrap_or(0));
            // the day of a month the rule lands on, when it has one
            let pick = |y: i64, m: i64| -> Option<i64> {
                let dim = days_in_month(y, m);
                let day = match rule.nth {
                    Some(n) if n > 0 => 1 + (wd - weekday(days_from_civil(y, m, 1))).rem_euclid(7) + 7 * (i64::from(n) - 1),
                    Some(_) => dim - (weekday(days_from_civil(y, m, dim)) - wd).rem_euclid(7),
                    None if rule.last_day => dim,
                    None => day,
                };
                (day <= dim).then(|| days_from_civil(y, m, day))
            };
            for i in 0..MAX_STEPS {
                let (y, m) = if by_year {
                    (y0 + i * step, m0)
                } else {
                    let index = y0 * 12 + (m0 - 1) + i * step;
                    (index.div_euclid(12), index.rem_euclid(12) + 1)
                };
                if days_from_civil(y, m, 1) > limit {
                    break;
                }
                // a month (or a year) that lacks the day is skipped
                if let Some(d) = pick(y, m) {
                    if !emit(d) {
                        break;
                    }
                }
            }
        }
    }
}

fn clean(conn: &Connection, input: &EntryInput) -> Result<Clean, String> {
    let (task_id, title) = match &input.task_id {
        Some(task) => {
            if !tasks::is_task(conn, task)? {
                return Err("La tarea no existe".to_string());
            }
            (Some(task.clone()), None) // a scheduled task takes its title from the task
        }
        None => {
            let title = opt_text(&input.title, "El título", MAX_TITLE)?.ok_or("Una cita necesita un título")?;
            (None, Some(title))
        }
    };
    if input.all_day {
        if !is_valid_iso_date(&input.start) || !is_valid_iso_date(&input.end) {
            return Err("Las fechas no son válidas (AAAA-MM-DD)".to_string());
        }
        let span = day_number(&input.end) - day_number(&input.start);
        if span < 0 {
            return Err("El fin no puede ser anterior al inicio".to_string());
        }
        if span >= MAX_DAYS {
            return Err(format!("Una entrada de día completo no puede pasar de {MAX_DAYS} días"));
        }
    } else {
        let ((start_date, start_min), (end_date, end_min)) = (parse_time(&input.start)?, parse_time(&input.end)?);
        if start_min >= 24 * 60 {
            return Err("La hora de inicio no es válida".to_string());
        }
        let days = day_number(end_date) - day_number(start_date);
        if days < 0 || (days == 0 && end_min <= start_min) {
            return Err("El fin tiene que ser posterior al inicio".to_string());
        }
        if days >= MAX_DAYS {
            return Err(format!("Una entrada no puede pasar de {MAX_DAYS} días"));
        }
    }
    let color = match input.color.as_deref() {
        None => None,
        Some(c) if COLORS.contains(&c) => Some(c.to_string()),
        Some(c) => return Err(format!("Color desconocido: {c}")),
    };
    let repeat = input.repeat.as_ref().map(|r| check_repeat(r, &input.start[..10])).transpose()?;
    Ok(Clean {
        task_id,
        title,
        start: input.start.clone(),
        end: input.end.clone(),
        all_day: input.all_day,
        color,
        location: opt_text(&input.location, "El lugar", MAX_LOCATION)?,
        note: opt_text(&input.note, "La nota", MAX_NOTE)?,
        repeat,
    })
}

type Row = (
    String,
    Option<String>,
    Option<String>,
    String,
    String,
    bool,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

const COLUMNS: &str = "id, task_id, title, starts_at, ends_at, all_day, color, location, note, recurrence";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Row> {
    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?))
}

fn recurrence_json(rule: &Option<Repeat>) -> Option<String> {
    rule.as_ref().map(|r| serde_json::to_string(r).unwrap_or_default())
}

fn entry_of(conn: &Connection, r: Row) -> Result<CalendarEntry, String> {
    let (id, task_id, own_title, start, end, all_day, color, location, note, recurrence) = r;
    let repeat = recurrence.and_then(|json| serde_json::from_str::<Repeat>(&json).ok());
    let occurrence = repeat.as_ref().map(|_| start[..10].to_string());
    let title = match (&task_id, own_title) {
        (Some(task), _) => db::derive_page_title(conn, task).map_err(sql)?,
        (None, title) => title.unwrap_or_default(),
    };
    Ok(CalendarEntry {
        id,
        task_id,
        title,
        start,
        end,
        all_day,
        color,
        location,
        note,
        repeat,
        occurrence,
    })
}

pub fn get_entry(conn: &Connection, id: &str) -> Result<CalendarEntry, String> {
    let r = conn
        .query_row(&format!("SELECT {COLUMNS} FROM calendar_entries WHERE id = ?1"), [id], row)
        .optional()
        .map_err(sql)?
        .ok_or("La entrada no existe")?;
    entry_of(conn, r)
}

fn check_room(conn: &Connection, task_id: Option<&str>, replacing: Option<&str>) -> Result<(), String> {
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM calendar_entries", [], |r| r.get(0)).map_err(sql)?;
    if replacing.is_none() && total >= MAX_TOTAL {
        return Err(format!("El calendario admite como mucho {MAX_TOTAL} entradas"));
    }
    if let Some(task) = task_id {
        let own: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM calendar_entries WHERE task_id = ?1 AND (?2 IS NULL OR id <> ?2)",
                params![task, replacing],
                |r| r.get(0),
            )
            .map_err(sql)?;
        if own >= MAX_PER_TASK {
            return Err(format!("Una tarea admite como mucho {MAX_PER_TASK} entradas en el calendario"));
        }
    }
    Ok(())
}

pub fn create_entry(conn: &Connection, input: &EntryInput) -> Result<CalendarEntry, String> {
    let c = clean(conn, input)?;
    check_room(conn, c.task_id.as_deref(), None)?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO calendar_entries (id, task_id, title, starts_at, ends_at, all_day, color, location, note, recurrence) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![id, c.task_id, c.title, c.start, c.end, c.all_day, c.color, c.location, c.note, recurrence_json(&c.repeat)],
    )
    .map_err(sql)?;
    get_entry(conn, &id)
}

pub fn update_entry(conn: &Connection, id: &str, input: &EntryInput) -> Result<CalendarEntry, String> {
    get_entry(conn, id)?; // exists
    let c = clean(conn, input)?;
    check_room(conn, c.task_id.as_deref(), Some(id))?;
    conn.execute(
        "UPDATE calendar_entries SET task_id = ?2, title = ?3, starts_at = ?4, ends_at = ?5, all_day = ?6, color = ?7, location = ?8, note = ?9, recurrence = ?10 WHERE id = ?1",
        params![id, c.task_id, c.title, c.start, c.end, c.all_day, c.color, c.location, c.note, recurrence_json(&c.repeat)],
    )
    .map_err(sql)?;
    if c.repeat.is_none() {
        conn.execute("DELETE FROM calendar_exceptions WHERE entry_id = ?1", [id]).map_err(sql)?;
    }
    get_entry(conn, id)
}

pub fn delete_entry(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM calendar_entries WHERE id = ?1", [id]).map_err(sql)?;
    Ok(())
}

pub(crate) fn exceptions(conn: &Connection, id: &str) -> Result<HashSet<String>, String> {
    let mut stmt = conn.prepare("SELECT day FROM calendar_exceptions WHERE entry_id = ?1").map_err(sql)?;
    let rows = stmt.query_map([id], |r| r.get(0)).map_err(sql)?;
    rows.collect::<rusqlite::Result<_>>().map_err(sql)
}

fn add_exception(conn: &Connection, id: &str, day: &str) -> Result<(), String> {
    conn.execute("INSERT OR IGNORE INTO calendar_exceptions (entry_id, day) VALUES (?1, ?2)", [id, day])
        .map_err(sql)?;
    Ok(())
}

/// One occurrence of a repeating entry: the series' entry moved to `date`.
fn entry_at(master: &CalendarEntry, date: &str) -> CalendarEntry {
    let by = day_number(date) - day_number(&master.start[..10]);
    CalendarEntry {
        start: shift(&master.start, by),
        end: shift(&master.end, by),
        occurrence: Some(date.to_string()),
        ..master.clone()
    }
}

/// `occurrence` must be a day the series really has an occurrence on (and not one already skipped).
fn require_occurrence(conn: &Connection, master: &CalendarEntry, rule: &Repeat, occurrence: &str) -> Result<(), String> {
    if !is_valid_iso_date(occurrence) {
        return Err("La ocurrencia no es una fecha válida".to_string());
    }
    let target = day_number(occurrence);
    let mut found = false;
    starts(rule, &master.start[..10], target, |d| {
        found = d == target;
        d < target
    });
    if found && !exceptions(conn, &master.id)?.contains(occurrence) {
        Ok(())
    } else {
        Err("Esa ocurrencia no existe".to_string())
    }
}

/// Edits an entry. For a repeating one `occurrence` says which, and `scope` how far the edit reaches; the result is the
/// entry as it now stands on that occurrence (a copy of its own for «this», the new series for «this and following»).
pub fn update_series(conn: &Connection, id: &str, input: &EntryInput, scope: Scope, occurrence: Option<&str>) -> Result<CalendarEntry, String> {
    let master = get_entry(conn, id)?;
    let Some(rule) = master.repeat.clone() else {
        return update_entry(conn, id, input);
    };
    // The edit is validated before anything slices its dates: this path used to cut `input.start[..10]`
    // first and let the check run later inside `update_entry`, so `start: "x"` aborted the app.
    clean(conn, input)?;
    let occ = occurrence.ok_or("Falta la ocurrencia que se edita")?;
    require_occurrence(conn, &master, &rule, occ)?;
    let first = master.start[..10] == *occ;
    let tx = conn.unchecked_transaction().map_err(sql)?;
    let result = match scope {
        // the occurrence leaves the series and becomes an entry of its own
        Scope::This => {
            let made = create_entry(&tx, &EntryInput { repeat: None, ..input.clone() })?;
            add_exception(&tx, id, occ)?;
            made
        }
        Scope::Following if !first => {
            let before = {
                let mut n = 0u32;
                starts(&rule, &master.start[..10], day_number(occ) - 1, |_| {
                    n += 1;
                    true
                });
                n
            };
            // what is left of an «after N times» rule starts counting again here
            let tail = Repeat {
                count: rule.count.map(|c| c.saturating_sub(before).max(1)),
                ..rule.clone()
            };
            let new_rule = if input.repeat.is_some() && input.repeat != master.repeat {
                input.repeat.clone()
            } else {
                Some(tail)
            };
            let made = create_entry(
                &tx,
                &EntryInput {
                    repeat: new_rule,
                    ..input.clone()
                },
            )?;
            let cut = Repeat {
                until: Some(iso(day_number(occ) - 1)),
                count: None,
                ..rule
            };
            tx.execute("UPDATE calendar_entries SET recurrence = ?1 WHERE id = ?2", params![recurrence_json(&Some(cut)), id])
                .map_err(sql)?;
            tx.execute("UPDATE calendar_exceptions SET entry_id = ?1 WHERE entry_id = ?2 AND day > ?3", params![made.id, id, occ])
                .map_err(sql)?;
            made
        }
        // the whole series (or its very first occurrence, which is the same): the block as it was edited, shifted back to
        // where the series starts
        _ => {
            let back = day_number(occ) - day_number(&master.start[..10]);
            let moved_days = day_number(&input.start[..10]) - day_number(occ);
            let mut series = EntryInput {
                start: shift(&input.start, -back),
                end: shift(&input.end, -back),
                ..input.clone()
            };
            if series.repeat == master.repeat && moved_days != 0 {
                // the block was moved to another weekday: the weekdays move with it
                if let Some(r) = series.repeat.as_mut() {
                    r.weekdays = r.weekdays.iter().map(|w| (i64::from(*w) + moved_days).rem_euclid(7) as u8).collect();
                }
            }
            update_entry(&tx, id, &series)?;
            if series.repeat.is_some() && moved_days != 0 {
                for day in exceptions(&tx, id)? {
                    tx.execute(
                        "UPDATE calendar_exceptions SET day = ?1 WHERE entry_id = ?2 AND day = ?3",
                        params![shift(&day, moved_days), id, day],
                    )
                    .map_err(sql)?;
                }
            }
            let now = get_entry(&tx, id)?;
            match &now.repeat {
                Some(r) => {
                    let target = day_number(occ) + moved_days;
                    let mut hit = false;
                    starts(r, &now.start[..10], target, |d| {
                        hit = d == target;
                        d < target
                    });
                    if hit {
                        entry_at(&now, &iso(target))
                    } else {
                        now
                    }
                }
                None => now,
            }
        }
    };
    tx.commit().map_err(sql)?;
    Ok(result)
}

/// Deletes an entry. For a repeating one `scope` says how much of the series goes.
pub fn delete_series(conn: &Connection, id: &str, scope: Scope, occurrence: Option<&str>) -> Result<(), String> {
    let master = get_entry(conn, id)?;
    let Some(rule) = master.repeat.clone() else {
        return delete_entry(conn, id);
    };
    let occ = occurrence.ok_or("Falta la ocurrencia que se borra")?;
    require_occurrence(conn, &master, &rule, occ)?;
    let first = master.start[..10] == *occ;
    match scope {
        Scope::This => add_exception(conn, id, occ),
        Scope::Following if !first => {
            let cut = Repeat {
                until: Some(iso(day_number(occ) - 1)),
                count: None,
                ..rule
            };
            conn.execute("UPDATE calendar_entries SET recurrence = ?1 WHERE id = ?2", params![recurrence_json(&Some(cut)), id])
                .map_err(sql)?;
            Ok(())
        }
        _ => delete_entry(conn, id),
    }
}

fn check_range(from: &str, to: &str) -> Result<(), String> {
    if !is_valid_iso_date(from) || !is_valid_iso_date(to) {
        return Err("Las fechas no son válidas (AAAA-MM-DD)".to_string());
    }
    let span = day_number(to) - day_number(from);
    if !(0..=MAX_DAYS + 62).contains(&span) {
        return Err("El intervalo pedido no es válido".to_string());
    }
    Ok(())
}

/// Every entry that touches the days `from..=to`, in time order; a repeating one comes once per occurrence in range.
pub fn list_entries(conn: &Connection, from: &str, to: &str) -> Result<Vec<CalendarEntry>, String> {
    check_range(from, to)?;
    let rows: Vec<Row> = {
        // a series is read whenever it has started by `to`; its occurrences are worked out below
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {COLUMNS} FROM calendar_entries WHERE substr(starts_at, 1, 10) <= ?2 AND (recurrence IS NOT NULL OR substr(ends_at, 1, 10) >= ?1) ORDER BY all_day DESC, starts_at, rowid"
            ))
            .map_err(sql)?;
        let found = stmt.query_map([from, to], row).map_err(sql)?;
        found.collect::<rusqlite::Result<_>>().map_err(sql)?
    };
    let (from_day, to_day) = (day_number(from), day_number(to));
    let mut out = Vec::new();
    for r in rows {
        let entry = entry_of(conn, r)?;
        let Some(rule) = entry.repeat.clone() else {
            out.push(entry);
            continue;
        };
        let skipped = exceptions(conn, &entry.id)?;
        let length = day_number(&entry.end[..10]) - day_number(&entry.start[..10]);
        starts(&rule, &entry.start[..10], to_day, |d| {
            let date = iso(d);
            if d + length >= from_day && !skipped.contains(&date) {
                out.push(entry_at(&entry, &date));
            }
            out.len() < MAX_OCCURRENCES
        });
    }
    out.sort_by(|a, b| b.all_day.cmp(&a.all_day).then_with(|| a.start.cmp(&b.start)));
    Ok(out)
}

/// Turns a standalone appointment into a task (with its title) so it can be linked to notes, put on boards and
/// grouped; the entry stays where it is, now scheduling that task.
pub fn entry_to_task(conn: &Connection, id: &str) -> Result<CalendarEntry, String> {
    let entry = get_entry(conn, id)?;
    if entry.task_id.is_some() {
        return Err("La entrada ya es una tarea".to_string());
    }
    // the task is made in its own transaction (the entry was just read, so the link that follows can't fail)
    let task = tasks::add_task(conn, &entry.title)?;
    conn.execute("UPDATE calendar_entries SET task_id = ?1, title = NULL WHERE id = ?2", [&task.id, id])
        .map_err(sql)?;
    get_entry(conn, id)
}

/// The other way: the entry stops scheduling its task and becomes a standalone appointment with the task's title.
pub fn entry_unlink_task(conn: &Connection, id: &str) -> Result<CalendarEntry, String> {
    let entry = get_entry(conn, id)?;
    if entry.task_id.is_none() {
        return Err("La entrada no es una tarea".to_string());
    }
    let title: String = entry.title.chars().take(MAX_TITLE).collect();
    conn.execute("UPDATE calendar_entries SET task_id = NULL, title = ?1 WHERE id = ?2", [&title, id])
        .map_err(sql)?;
    get_entry(conn, id)
}

/// The tasks that have at least one entry (the tray's «Por programar» is the others).
pub fn scheduled_tasks(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn.prepare("SELECT DISTINCT task_id FROM calendar_entries WHERE task_id IS NOT NULL").map_err(sql)?;
    let rows = stmt.query_map([], |r| r.get(0)).map_err(sql)?;
    rows.collect::<rusqlite::Result<_>>().map_err(sql)
}

/// The due dates in `from..=to`: the end of the first date property of the task database (its «Fecha límite»).
pub fn deadlines(conn: &Connection, from: &str, to: &str) -> Result<Vec<Deadline>, String> {
    check_range(from, to)?;
    Ok(all_deadlines(conn)?.into_iter().filter(|d| d.date.as_str() >= from && d.date.as_str() <= to).collect())
}

/// Every due date, in date order.
pub fn all_deadlines(conn: &Connection) -> Result<Vec<Deadline>, String> {
    let Some(base) = tasks::existing(conn)? else { return Ok(Vec::new()) };
    let Some(data) = databases::get_database(conn, &base.database_id)? else {
        return Ok(Vec::new());
    };
    let Some(prop) = data.properties.iter().find(|p| p.kind == "date") else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for task in &data.rows {
        let Some(value) = task.values.get(&prop.id).and_then(|v| v.as_str()) else { continue };
        let (start, end) = databases::split_date_range(value);
        let date = end.unwrap_or(start);
        out.push(Deadline {
            task_id: task.page_id.clone(),
            title: task.title.clone(),
            date: date.to_string(),
        });
    }
    out.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(out)
}

/// Every stored entry (a series once, not expanded) with the UTC time it was created, in creation order.
pub fn all_entries(conn: &Connection) -> Result<Vec<(CalendarEntry, String)>, String> {
    let ids: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT id, created_at FROM calendar_entries ORDER BY rowid").map_err(sql)?;
        let found = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(sql)?;
        found.collect::<rusqlite::Result<_>>().map_err(sql)?
    };
    ids.into_iter().map(|(id, created)| Ok((get_entry(conn, &id)?, created))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        db::run_migrations(&conn).unwrap();
        conn
    }

    fn input(task: Option<&str>, title: Option<&str>, start: &str, end: &str, all_day: bool) -> EntryInput {
        EntryInput {
            task_id: task.map(str::to_string),
            title: title.map(str::to_string),
            start: start.to_string(),
            end: end.to_string(),
            all_day,
            color: None,
            location: None,
            note: None,
            repeat: None,
        }
    }

    fn rule(freq: Freq, interval: u32) -> Repeat {
        Repeat {
            freq,
            interval,
            weekdays: Vec::new(),
            until: None,
            count: None,
            nth: None,
            last_day: false,
        }
    }

    fn repeating(title: &str, start: &str, end: &str, all_day: bool, repeat: Repeat) -> EntryInput {
        EntryInput {
            repeat: Some(repeat),
            ..input(None, Some(title), start, end, all_day)
        }
    }

    fn days_of(conn: &Connection, from: &str, to: &str) -> Vec<String> {
        list_entries(conn, from, to).unwrap().into_iter().map(|e| e.start[..10].to_string()).collect()
    }

    #[test]
    fn rules_expand_into_occurrences_and_are_checked() {
        let conn = conn();
        // every 2 days
        create_entry(&conn, &repeating("Cada 2", "2026-10-21T10:00", "2026-10-21T11:00", false, rule(Freq::Daily, 2))).unwrap();
        assert_eq!(days_of(&conn, "2026-10-21", "2026-10-28"), ["2026-10-21", "2026-10-23", "2026-10-25", "2026-10-27"]);
        let occ = list_entries(&conn, "2026-10-23", "2026-10-23").unwrap().remove(0);
        assert_eq!(
            (occ.start.as_str(), occ.end.as_str(), occ.occurrence.as_deref()),
            ("2026-10-23T10:00", "2026-10-23T11:00", Some("2026-10-23"))
        );

        // weekly on Monday and Wednesday, three times
        let conn2 = self::conn();
        let mut weekly = rule(Freq::Weekly, 1);
        weekly.weekdays = vec![2, 0, 0]; // out of order and repeated
        weekly.count = Some(3);
        create_entry(&conn2, &repeating("Clase", "2026-10-21", "2026-10-21", true, weekly)).unwrap(); // a Wednesday
        assert_eq!(days_of(&conn2, "2026-10-01", "2026-12-31"), ["2026-10-21", "2026-10-26", "2026-10-28"]);

        // every other week, with no weekday: the weekday it starts on, until a date (inclusive)
        let conn3 = self::conn();
        let mut biweekly = rule(Freq::Weekly, 2);
        biweekly.until = Some("2026-11-18".to_string());
        create_entry(&conn3, &repeating("Revisión", "2026-10-21", "2026-10-21", true, biweekly)).unwrap();
        assert_eq!(days_of(&conn3, "2026-10-01", "2026-12-31"), ["2026-10-21", "2026-11-04", "2026-11-18"]);

        // monthly on the 31st skips the months that lack it; yearly on 29 February only comes in leap years
        let conn4 = self::conn();
        create_entry(&conn4, &repeating("Fin de mes", "2026-01-31", "2026-01-31", true, rule(Freq::Monthly, 1))).unwrap();
        assert_eq!(days_of(&conn4, "2026-01-01", "2026-06-30"), ["2026-01-31", "2026-03-31", "2026-05-31"]);
        create_entry(&conn4, &repeating("Bisiesto", "2024-02-29", "2024-02-29", true, rule(Freq::Yearly, 1))).unwrap();
        assert!(!days_of(&conn4, "2027-01-01", "2027-12-31").iter().any(|d| d.ends_with("02-29")));
        assert!(days_of(&conn4, "2028-01-01", "2028-12-31").contains(&"2028-02-29".to_string()));

        // a multi-day entry that began before the range still shows its tail
        let conn5 = self::conn();
        create_entry(&conn5, &repeating("Retiro", "2026-10-19", "2026-10-21", true, rule(Freq::Weekly, 1))).unwrap();
        assert_eq!(days_of(&conn5, "2026-10-26", "2026-10-26"), ["2026-10-26"], "the Monday of the second week");
        assert_eq!(days_of(&conn5, "2026-10-28", "2026-10-28"), ["2026-10-26"], "the third day of that occurrence");

        // the rule is checked
        let bad = |r: Repeat| create_entry(&conn, &repeating("x", "2026-10-21", "2026-10-21", true, r)).is_err();
        assert!(bad(rule(Freq::Daily, 0)));
        assert!(bad(rule(Freq::Daily, 100)));
        let mut r = rule(Freq::Daily, 1);
        r.weekdays = vec![1];
        assert!(bad(r), "weekdays only for weekly");
        let mut r = rule(Freq::Weekly, 1);
        r.weekdays = vec![7];
        assert!(bad(r));
        let mut r = rule(Freq::Daily, 1);
        r.count = Some(0);
        assert!(bad(r));
        let mut r = rule(Freq::Daily, 1);
        r.count = Some(1000);
        assert!(bad(r));
        let mut r = rule(Freq::Daily, 1);
        r.until = Some("2026-10-20".to_string());
        assert!(bad(r), "until before the start");
        let mut r = rule(Freq::Daily, 1);
        r.until = Some("2026-12-01".to_string());
        r.count = Some(3);
        assert!(bad(r), "until and count together");
        let raw = json!({ "freq": "daily", "interval": 1, "extra": true });
        assert!(serde_json::from_value::<Repeat>(raw).is_err());
    }

    #[test]
    fn monthly_and_yearly_rules_can_name_the_nth_weekday_or_the_last_day() {
        let conn = conn();
        // the third Tuesday of every month, from 20 October 2026 (it is one)
        let mut third_tuesday = rule(Freq::Monthly, 1);
        third_tuesday.nth = Some(3);
        third_tuesday.weekdays = vec![1];
        create_entry(&conn, &repeating("Comité", "2026-10-20", "2026-10-20", true, third_tuesday)).unwrap();
        assert_eq!(days_of(&conn, "2026-10-01", "2027-01-31"), ["2026-10-20", "2026-11-17", "2026-12-15", "2027-01-19"]);

        // the last Friday, every 2 months; the weekday defaults to the one it starts on
        let conn2 = self::conn();
        let mut last_friday = rule(Freq::Monthly, 2);
        last_friday.nth = Some(-1);
        create_entry(&conn2, &repeating("Cierre", "2026-10-30", "2026-10-30", true, last_friday)).unwrap();
        assert_eq!(days_of(&conn2, "2026-10-01", "2027-03-31"), ["2026-10-30", "2026-12-25", "2027-02-26"]);
        let stored = get_entry(&conn2, &list_entries(&conn2, "2026-10-30", "2026-10-30").unwrap()[0].id).unwrap();
        assert_eq!(stored.repeat.unwrap().weekdays, [4], "Friday, filled in from the start date");

        // the last day of the month, whatever it is called
        let conn3 = self::conn();
        let mut last = rule(Freq::Monthly, 1);
        last.last_day = true;
        create_entry(&conn3, &repeating("Cuentas", "2026-01-31", "2026-01-31", true, last)).unwrap();
        assert_eq!(
            days_of(&conn3, "2026-01-01", "2026-05-31"),
            ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]
        );

        // the fourth Thursday of November, every year
        let conn4 = self::conn();
        let mut thanksgiving = rule(Freq::Yearly, 1);
        thanksgiving.nth = Some(4);
        thanksgiving.weekdays = vec![3];
        create_entry(&conn4, &repeating("Cena", "2026-11-26", "2026-11-26", true, thanksgiving)).unwrap();
        assert_eq!(days_of(&conn4, "2026-11-01", "2026-11-30"), ["2026-11-26"]);
        assert_eq!(days_of(&conn4, "2027-11-01", "2027-11-30"), ["2027-11-25"]);

        // the rule is checked
        let bad = |r: Repeat| create_entry(&conn, &repeating("x", "2026-10-20", "2026-10-20", true, r)).is_err();
        let mut r = rule(Freq::Monthly, 1);
        r.nth = Some(5);
        assert!(bad(r), "there is no fifth");
        let mut r = rule(Freq::Weekly, 1);
        r.nth = Some(1);
        assert!(bad(r), "weekly has no n-th");
        let mut r = rule(Freq::Monthly, 1);
        r.nth = Some(2);
        r.weekdays = vec![1, 2];
        assert!(bad(r), "one weekday for an n-th");
        let mut r = rule(Freq::Monthly, 1);
        r.nth = Some(2);
        r.last_day = true;
        assert!(bad(r));
        let mut r = rule(Freq::Yearly, 1);
        r.last_day = true;
        assert!(bad(r), "last day only monthly");
        let mut r = rule(Freq::Daily, 1);
        r.weekdays = vec![1];
        assert!(bad(r), "weekdays still only for weekly or an n-th");
    }

    #[test]
    fn editing_and_deleting_one_occurrence_follow_the_scope() {
        let conn = conn();
        let series = create_entry(&conn, &repeating("Standup", "2026-10-19T09:00", "2026-10-19T09:15", false, rule(Freq::Daily, 1))).unwrap();
        let on = |day: &str| list_entries(&conn, day, day).unwrap();
        assert_eq!(on("2026-10-22").len(), 1);

        // only this one: it becomes an entry of its own (moved), and its day is skipped in the series
        let edited = EntryInput {
            title: Some("Standup largo".to_string()),
            ..input(None, None, "2026-10-22T10:00", "2026-10-22T11:00", false)
        };
        let alone = update_series(&conn, &series.id, &edited, Scope::This, Some("2026-10-22")).unwrap();
        assert_eq!((alone.title.as_str(), alone.repeat.clone(), alone.occurrence.clone()), ("Standup largo", None, None));
        let that_day: Vec<String> = on("2026-10-22").into_iter().map(|e| e.title).collect();
        assert_eq!(that_day, ["Standup largo"], "the day of the series is skipped");
        assert_eq!(on("2026-10-23")[0].title, "Standup");
        assert!(
            update_series(&conn, &series.id, &edited, Scope::This, Some("2026-10-22")).is_err(),
            "that occurrence is gone now"
        );
        assert!(update_series(&conn, &series.id, &edited, Scope::This, None).is_err());
        assert!(update_series(&conn, &series.id, &edited, Scope::This, Some("2026-10-20X")).is_err());

        // this and the following: the series is cut the day before and a new one starts here
        let later = EntryInput {
            title: Some("Standup nuevo".to_string()),
            repeat: Some(rule(Freq::Daily, 1)),
            ..input(None, None, "2026-10-25T09:30", "2026-10-25T09:45", false)
        };
        let tail = update_series(&conn, &series.id, &later, Scope::Following, Some("2026-10-25")).unwrap();
        assert_eq!((tail.title.as_str(), tail.occurrence.as_deref()), ("Standup nuevo", Some("2026-10-25")));
        assert_eq!(on("2026-10-24")[0].title, "Standup");
        assert_eq!(
            (on("2026-10-25")[0].title.as_str(), on("2026-10-25")[0].start.as_str()),
            ("Standup nuevo", "2026-10-25T09:30")
        );
        assert_eq!(on("2026-10-30")[0].title, "Standup nuevo");
        assert_eq!(on("2026-10-25").len(), 1, "never both series on a day");

        // all: the first block moved an hour later moves the whole series (the already-edited day keeps its own)
        // (the client sends the rule the series has now: it was cut at the 24th)
        let current = get_entry(&conn, &series.id).unwrap().repeat;
        let hour_later = EntryInput {
            repeat: current,
            ..input(None, Some("Standup"), "2026-10-20T10:00", "2026-10-20T10:15", false)
        };
        update_series(&conn, &series.id, &hour_later, Scope::All, Some("2026-10-20")).unwrap();
        assert_eq!(on("2026-10-21")[0].start, "2026-10-21T10:00");
        assert_eq!(on("2026-10-24")[0].start, "2026-10-24T10:00");
        assert_eq!(on("2026-10-25")[0].start, "2026-10-25T09:30", "the later series is not touched");

        // deleting: this one only, this and the following, all
        delete_series(&conn, &series.id, Scope::This, Some("2026-10-21")).unwrap();
        assert!(on("2026-10-21").is_empty());
        assert_eq!(on("2026-10-22")[0].title, "Standup largo");
        delete_series(&conn, &series.id, Scope::Following, Some("2026-10-23")).unwrap();
        assert!(on("2026-10-23").is_empty() && on("2026-10-24").is_empty());
        assert_eq!(on("2026-10-20")[0].title, "Standup");
        delete_series(&conn, &series.id, Scope::All, Some("2026-10-20")).unwrap();
        assert!(get_entry(&conn, &series.id).is_err());
        assert!(on("2026-10-20").is_empty());
    }

    #[test]
    fn a_counted_series_split_in_two_keeps_the_count_and_moving_a_weekly_one_moves_its_weekdays() {
        let conn = conn();
        let mut r = rule(Freq::Daily, 1);
        r.count = Some(5);
        let series = create_entry(&conn, &repeating("Cinco", "2026-10-19", "2026-10-19", true, r)).unwrap();
        // cut at the 3rd occurrence: the head has 2, the tail the remaining 3
        let at = input(None, Some("Cinco"), "2026-10-21", "2026-10-21", true);
        let tail = update_series(&conn, &series.id, &at, Scope::Following, Some("2026-10-21")).unwrap();
        assert_eq!(tail.repeat.unwrap().count, Some(3));
        assert_eq!(days_of(&conn, "2026-10-01", "2026-12-31").len(), 5);

        let conn2 = self::conn();
        let mut weekly = rule(Freq::Weekly, 1);
        weekly.weekdays = vec![0, 2]; // Monday and Wednesday
        let class = create_entry(&conn2, &repeating("Clase", "2026-10-19", "2026-10-19", true, weekly.clone())).unwrap();
        // dragging the Wednesday 21st to Thursday 22nd, for all of them: Tuesday and Thursday from now on
        let moved = EntryInput {
            repeat: Some(weekly),
            ..input(None, Some("Clase"), "2026-10-22", "2026-10-22", true)
        };
        let now = update_series(&conn2, &class.id, &moved, Scope::All, Some("2026-10-21")).unwrap();
        assert_eq!(now.occurrence.as_deref(), Some("2026-10-22"));
        assert_eq!(days_of(&conn2, "2026-10-19", "2026-10-30"), ["2026-10-20", "2026-10-22", "2026-10-27", "2026-10-29"]);
    }

    #[test]
    fn entries_are_a_task_or_an_appointment_and_times_are_checked() {
        let conn = conn();
        let task = tasks::add_task(&conn, "Escribir ideas").unwrap();
        let other = db::create_page(&conn, None).unwrap();

        let a = create_entry(&conn, &input(Some(&task.id), None, "2026-10-21T10:00", "2026-10-21T11:30", false)).unwrap();
        assert_eq!(a.title, "Escribir ideas", "a scheduled task takes its title from the task");
        // the same task can be scheduled again, and a title passed with a task is ignored
        let b = create_entry(&conn, &input(Some(&task.id), Some("otro"), "2026-10-22T09:00", "2026-10-22T09:15", false)).unwrap();
        assert_eq!(b.title, "Escribir ideas");
        // a block can run to midnight and across it
        create_entry(&conn, &input(None, Some("Guardia"), "2026-10-21T22:00", "2026-10-22T06:30", false)).unwrap();
        create_entry(&conn, &input(None, Some("Tarde"), "2026-10-21T23:00", "2026-10-21T24:00", false)).unwrap();
        let meet = create_entry(&conn, &input(None, Some("  Dentista "), "2026-10-21", "2026-10-23", true)).unwrap();
        assert_eq!((meet.title.as_str(), meet.task_id.clone()), ("Dentista", None));

        let bad = |i: EntryInput| create_entry(&conn, &i).is_err();
        assert!(bad(input(None, None, "2026-10-21", "2026-10-21", true)), "an appointment needs a title");
        assert!(bad(input(None, Some("  "), "2026-10-21", "2026-10-21", true)));
        assert!(bad(input(None, Some(&"x".repeat(201)), "2026-10-21", "2026-10-21", true)));
        assert!(bad(input(Some(&other.id), None, "2026-10-21", "2026-10-21", true)), "not a task");
        assert!(bad(input(Some("no-existe"), None, "2026-10-21", "2026-10-21", true)));
        for (s, e) in [
            ("2026-10-21T11:00", "2026-10-21T10:00"), // ends before it starts
            ("2026-10-21T10:00", "2026-10-21T10:00"), // no length
            ("2026-10-22T10:00", "2026-10-21T11:00"), // ends a day before it starts
            ("2026-10-21T10:00", "2027-10-22T11:00"), // more than a year
            ("2026-10-21T24:00", "2026-10-22T10:00"), // 24:00 is never a start
            ("2026-10-21T25:00", "2026-10-21T26:00"),
            ("2026-10-21T24:00", "2026-10-21T24:00"),
            ("2026-10-21T24:15", "2026-10-21T24:30"),
            ("2026-10-21T10:60", "2026-10-21T11:00"),
            ("2026-02-30T10:00", "2026-02-30T11:00"),
            ("2026-10-21 10:00", "2026-10-21 11:00"),
            ("2026-10-21", "2026-10-21"), // a date where a time is needed
        ] {
            assert!(bad(input(None, Some("x"), s, e, false)), "{s} → {e}");
        }
        for (s, e) in [
            ("2026-10-23", "2026-10-21"),
            ("2026-02-30", "2026-03-01"),
            ("2026-10-21T10:00", "2026-10-21T11:00"),
            ("2026-01-01", "2027-06-01"),
        ] {
            assert!(bad(input(None, Some("x"), s, e, true)), "all day {s} → {e}");
        }
        let mut with_color = input(None, Some("c"), "2026-10-21", "2026-10-21", true);
        with_color.color = Some("fucsia".to_string());
        assert!(create_entry(&conn, &with_color).is_err());
        let mut long_note = input(None, Some("c"), "2026-10-21", "2026-10-21", true);
        long_note.note = Some("n".repeat(2001));
        assert!(create_entry(&conn, &long_note).is_err());

        // the client sends nothing it was not meant to
        let raw = json!({ "taskId": null, "title": "x", "start": "2026-10-21", "end": "2026-10-21", "allDay": true, "extra": 1 });
        assert!(serde_json::from_value::<EntryInput>(raw).is_err());
    }

    #[test]
    fn entries_are_listed_by_day_changed_and_deleted_with_their_task() {
        let conn = conn();
        let task = tasks::add_task(&conn, "Tarea").unwrap();
        let a = create_entry(&conn, &input(Some(&task.id), None, "2026-10-21T10:00", "2026-10-21T11:00", false)).unwrap();
        let wide = create_entry(&conn, &input(None, Some("Viaje"), "2026-10-19", "2026-10-25", true)).unwrap();
        let later = create_entry(&conn, &input(None, Some("Después"), "2026-11-03", "2026-11-03", true)).unwrap();

        let ids = |from: &str, to: &str| list_entries(&conn, from, to).unwrap().into_iter().map(|e| e.id).collect::<Vec<_>>();
        assert_eq!(ids("2026-10-21", "2026-10-21"), [wide.id.clone(), a.id.clone()], "all-day first, then by time");
        assert_eq!(ids("2026-10-26", "2026-11-02"), Vec::<String>::new());
        assert_eq!(ids("2026-10-25", "2026-11-03"), [wide.id.clone(), later.id.clone()], "a range touching the edge counts");
        assert!(list_entries(&conn, "2026-10-21", "2026-10-20").is_err());
        assert!(list_entries(&conn, "2000-01-01", "2030-01-01").is_err(), "a range is limited");

        assert_eq!(scheduled_tasks(&conn).unwrap(), std::slice::from_ref(&task.id));
        let moved = update_entry(&conn, &a.id, &input(Some(&task.id), None, "2026-10-22T15:15", "2026-10-22T16:00", false)).unwrap();
        assert_eq!(moved.start, "2026-10-22T15:15");
        assert!(update_entry(&conn, &a.id, &input(Some(&task.id), None, "2026-10-22T16:00", "2026-10-22T15:00", false)).is_err());
        assert_eq!(get_entry(&conn, &a.id).unwrap().start, "2026-10-22T15:15", "a refused change leaves the entry as it was");
        assert!(update_entry(&conn, "no-existe", &input(None, Some("x"), "2026-10-22", "2026-10-22", true)).is_err());

        delete_entry(&conn, &later.id).unwrap();
        assert!(get_entry(&conn, &later.id).is_err());
        db::delete_page(&conn, &task.id).unwrap();
        assert!(get_entry(&conn, &a.id).is_err(), "deleting a task takes its entries with it");
        assert!(get_entry(&conn, &wide.id).is_ok(), "an appointment has no task to lose");
    }

    #[test]
    fn an_appointment_becomes_a_task_and_back() {
        let conn = conn();
        let meet = create_entry(&conn, &input(None, Some("Llamar a Ana"), "2026-10-21T10:00", "2026-10-21T10:30", false)).unwrap();
        let task = entry_to_task(&conn, &meet.id).unwrap();
        let task_id = task.task_id.clone().unwrap();
        assert_eq!(task.title, "Llamar a Ana");
        assert!(tasks::is_task(&conn, &task_id).unwrap());
        assert!(entry_to_task(&conn, &meet.id).is_err(), "it already is one");
        // the task can be scheduled again and linked to notes like any
        create_entry(&conn, &input(Some(&task_id), None, "2026-10-22T10:00", "2026-10-22T10:30", false)).unwrap();

        let back = entry_unlink_task(&conn, &meet.id).unwrap();
        assert_eq!((back.task_id, back.title.as_str()), (None, "Llamar a Ana"));
        assert!(entry_unlink_task(&conn, &meet.id).is_err());
        assert!(tasks::is_task(&conn, &task_id).unwrap(), "the task stays");
    }

    #[test]
    fn a_task_takes_a_limited_number_of_entries() {
        let conn = conn();
        let task = tasks::add_task(&conn, "Mucho").unwrap();
        for _ in 0..MAX_PER_TASK {
            create_entry(&conn, &input(Some(&task.id), None, "2026-10-21", "2026-10-21", true)).unwrap();
        }
        assert!(create_entry(&conn, &input(Some(&task.id), None, "2026-10-21", "2026-10-21", true)).is_err());
        // an appointment is not that task's
        assert!(create_entry(&conn, &input(None, Some("Otra"), "2026-10-21", "2026-10-21", true)).is_ok());
    }

    #[test]
    fn due_dates_come_from_the_task_databases_first_date_column() {
        let conn = conn();
        assert!(deadlines(&conn, "2026-10-01", "2026-10-31").unwrap().is_empty(), "no task database yet");
        let a = tasks::add_task(&conn, "Entregar").unwrap();
        let b = tasks::add_task(&conn, "Después").unwrap();
        let _none = tasks::add_task(&conn, "Sin fecha").unwrap();
        let base = tasks::ensure_task_base(&conn).unwrap();
        let date = databases::get_database(&conn, &base.database_id)
            .unwrap()
            .unwrap()
            .properties
            .into_iter()
            .find(|p| p.kind == "date")
            .unwrap();
        databases::set_value(&conn, &a.id, &date.id, &json!("2026-10-21")).unwrap();
        databases::set_value(&conn, &b.id, &date.id, &json!("2026-11-02/2026-11-05")).unwrap();
        let found = deadlines(&conn, "2026-10-01", "2026-10-31").unwrap();
        assert_eq!(
            found,
            [Deadline {
                task_id: a.id.clone(),
                title: "Entregar".to_string(),
                date: "2026-10-21".to_string()
            }]
        );
        let range = deadlines(&conn, "2026-11-01", "2026-11-30").unwrap();
        assert_eq!(range[0].date, "2026-11-05", "a range is due on its last day");
    }

    /// A malformed edit of one occurrence is an error, never a panic: the release profile aborts on
    /// panic, so this killed the whole app (found by fuzzing the commands with `start: "x"`).
    #[test]
    fn malformed_dates_in_a_series_edit_are_refused_not_fatal() {
        let conn = conn();
        let series = create_entry(&conn, &repeating("Clase", "2026-10-20T10:00", "2026-10-20T11:00", false, rule(Freq::Weekly, 1))).unwrap();
        for scope in [Scope::This, Scope::Following, Scope::All] {
            for bad in ["x", "", "2026-10-2", "ñññññññññññ", "2026-10-2ñ", "2026-10-27T", "2026-13-40T10:00", "-----"] {
                let edited = input(None, Some("Clase"), bad, "2026-10-27T11:00", false);
                for occurrence in ["2026-10-20", "2026-10-27"] {
                    assert!(
                        update_series(&conn, &series.id, &edited, scope, Some(occurrence)).is_err(),
                        "{scope:?} {bad:?} {occurrence}"
                    );
                }
            }
        }
        // the helpers underneath do not panic on anything either
        for text in ["", "x", "ñ", "2026", "2026-1", "ñññññññññññ", "a-b-c-d"] {
            let _ = (day_number(text), shift(text, 3));
        }
        // and the series is untouched
        assert_eq!(get_entry(&conn, &series.id).unwrap().start, "2026-10-20T10:00");
    }

    #[test]
    fn day_numbers_agree_with_the_client() {
        assert_eq!(day_number("1970-01-01"), 0);
        assert_eq!(day_number("2026-10-21") - day_number("2026-10-20"), 1);
        assert_eq!(day_number("2028-03-01") - day_number("2028-02-28"), 2, "2028 is a leap year");
        assert_eq!(day_number("2027-01-01") - day_number("2026-01-01"), 365);
    }
}
