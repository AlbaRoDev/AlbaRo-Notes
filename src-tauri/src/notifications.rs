//! System notifications for the calendar: when the time of an entry with an hour arrives (or a few minutes before,
//! as the user chose) the app shows a native notification with its title, time and place, as Notion Calendar does.
//!
//! A thread wakes up every few seconds, reads the entries of today and tomorrow (a repeating one comes once per
//! occurrence) and shows what is due. It runs in Rust, not in the page: a hidden or minimized window has its
//! timers throttled, and nothing here needs a permission for the page (`tauri-plugin-notification` is used only from
//! here, and a test in `lib.rs` checks that no capability grants it).
//!
//! Known limits: it works while the app is running (closed, nothing watches); all-day entries, the «Fecha límite»
//! of the tasks and the date mentions of the pages have no hour, so they do not notify; what was due while the
//! computer slept for longer than `GRACE_MINUTES` is not shown late; clicking a notification only brings the app
//! up (the plugin has no click handler on desktop).

use crate::calendar::{self, CalendarEntry};
use crate::db::DbState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// How early the user may ask to be told, in minutes (0 = when it starts).
pub const LEADS: [u32; 6] = [0, 5, 10, 15, 30, 60];
const CHECK_EVERY: Duration = Duration::from_secs(20);
/// A notice that is this many minutes late is still shown (the thread was busy, the app just started); later it is not.
const GRACE_MINUTES: i64 = 2;
const MINUTES_PER_DAY: i64 = 1_440;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub enabled: bool,
    pub lead_minutes: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { enabled: true, lead_minutes: 0 }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if LEADS.contains(&self.lead_minutes) {
            Ok(())
        } else {
            Err("La antelación del aviso no es válida".to_string())
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("notifications.json"))
}

/// What is saved, or the defaults if there is nothing (or nothing valid): a broken file must never silence the app for good.
pub fn load(path: &Path) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str::<Settings>(&t).ok())
        .filter(|s| s.validate().is_ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, settings: &Settings) -> Result<(), String> {
    settings.validate()?;
    std::fs::create_dir_all(path.parent().ok_or("Ruta no válida")?).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

pub fn get_settings(app: &AppHandle) -> Result<Settings, String> {
    Ok(load(&settings_path(app)?))
}

pub fn set_settings(app: &AppHandle, settings: &Settings) -> Result<Settings, String> {
    save(&settings_path(app)?, settings)?;
    Ok(*settings)
}

/// What is shown.
#[derive(Debug, PartialEq)]
pub struct Notice {
    pub title: String,
    pub body: String,
}

/// Minutes since 1970-01-01 of `YYYY-MM-DDTHH:MM`; `None` if it is not one (a stored value is validated, but this
/// thread must never panic over one: `panic = "abort"`).
fn minutes_of(stamp: &str) -> Option<i64> {
    let (date, time) = (stamp.get(..10)?, stamp.get(11..16)?);
    let (h, m) = time.split_once(':')?;
    let (h, m): (i64, i64) = (h.parse().ok()?, m.parse().ok()?);
    if !(0..=24).contains(&h) || !(0..60).contains(&m) {
        return None;
    }
    Some(calendar::day_number(date) * MINUTES_PER_DAY + h * 60 + m)
}

fn clock(stamp: &str) -> &str {
    stamp.get(11..16).unwrap_or("")
}

/// The notices due at `now` (minutes since 1970, local), each at most once: `shown` remembers `entry@start` with
/// the minute it was due and forgets what is more than a day old.
fn due(entries: &[CalendarEntry], now: i64, lead: u32, shown: &mut HashMap<String, i64>) -> Vec<Notice> {
    shown.retain(|_, due_at| *due_at > now - MINUTES_PER_DAY);
    let mut out = Vec::new();
    for e in entries.iter().filter(|e| !e.all_day) {
        let Some(start) = minutes_of(&e.start) else { continue };
        let due_at = start - i64::from(lead);
        if now < due_at || now >= due_at + GRACE_MINUTES {
            continue;
        }
        if shown.insert(format!("{}@{}", e.id, e.start), due_at).is_some() {
            continue;
        }
        let left = start - now;
        let when = if left <= 0 { "Ahora".to_string() } else { format!("En {left} min") };
        let mut body = format!("{when} · {}–{}", clock(&e.start), clock(&e.end));
        if let Some(place) = e.location.as_deref().filter(|l| !l.is_empty()) {
            body.push_str(&format!(" · {place}"));
        }
        let title = if e.title.is_empty() { "Cita sin título".to_string() } else { e.title.clone() };
        out.push(Notice { title, body });
    }
    out
}

fn now_minutes() -> (i64, String, String) {
    let now = chrono::Local::now().naive_local();
    let (today, tomorrow) = (now.date(), now.date() + chrono::Days::new(1));
    let minutes =
        calendar::day_number(&today.format("%Y-%m-%d").to_string()) * MINUTES_PER_DAY + i64::from(chrono::Timelike::hour(&now)) * 60 + i64::from(chrono::Timelike::minute(&now));
    (minutes, today.format("%Y-%m-%d").to_string(), tomorrow.format("%Y-%m-%d").to_string())
}

fn show(app: &AppHandle, notice: &Notice) -> Result<(), String> {
    app.notification().builder().title(&notice.title).body(&notice.body).show().map_err(|e| e.to_string())
}

/// A sample, so the user can see what the notices look like (and that the system lets them through).
pub fn send_test(app: &AppHandle) -> Result<(), String> {
    show(
        app,
        &Notice {
            title: "Así se verá un aviso".to_string(),
            body: "En 10 min · 10:00–11:00 · Sala de reuniones".to_string(),
        },
    )
}

/// Starts the thread that watches the calendar.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut shown: HashMap<String, i64> = HashMap::new();
        loop {
            std::thread::sleep(CHECK_EVERY);
            let settings = settings_path(&app).map(|p| load(&p)).unwrap_or_default();
            if !settings.enabled {
                continue;
            }
            let (now, today, tomorrow) = now_minutes();
            let state = app.state::<DbState>();
            let Ok(conn) = state.0.lock() else { continue };
            let entries = calendar::list_entries(&conn, &today, &tomorrow);
            drop(conn); // the notification is shown without holding the database
            let Ok(entries) = entries else { continue };
            for notice in due(&entries, now, settings.lead_minutes, &mut shown) {
                if let Err(e) = show(&app, &notice) {
                    eprintln!("notification failed: {e}");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, start: &str, end: &str, all_day: bool) -> CalendarEntry {
        CalendarEntry {
            id: id.to_string(),
            task_id: None,
            title: format!("Cita {id}"),
            start: start.to_string(),
            end: end.to_string(),
            all_day,
            color: None,
            location: None,
            note: None,
            repeat: None,
            occurrence: None,
        }
    }

    fn at(stamp: &str) -> i64 {
        minutes_of(stamp).unwrap()
    }

    #[test]
    fn a_notice_is_due_at_the_time_once_and_not_before_or_long_after() {
        let entries = [entry("a", "2026-11-04T10:00", "2026-11-04T11:00", false)];
        let mut shown = HashMap::new();
        assert!(due(&entries, at("2026-11-04T09:59"), 0, &mut shown).is_empty(), "not yet");
        let first = due(&entries, at("2026-11-04T10:00"), 0, &mut shown);
        assert_eq!(
            first,
            [Notice {
                title: "Cita a".into(),
                body: "Ahora · 10:00–11:00".into()
            }]
        );
        assert!(due(&entries, at("2026-11-04T10:00"), 0, &mut shown).is_empty(), "only once");
        assert!(due(&entries, at("2026-11-04T10:01"), 0, &mut shown).is_empty(), "only once");
        // a fresh start (nothing remembered) a few minutes late does not show an old notice
        assert!(due(&entries, at("2026-11-04T10:02"), 0, &mut HashMap::new()).is_empty());
        // a minute late (the thread was busy) still does
        assert_eq!(due(&entries, at("2026-11-04T10:01"), 0, &mut HashMap::new()).len(), 1);
    }

    #[test]
    fn the_lead_moves_it_earlier_and_says_how_long_is_left() {
        let entries = [entry("a", "2026-11-04T10:00", "2026-11-04T11:00", false)];
        let mut shown = HashMap::new();
        assert!(due(&entries, at("2026-11-04T09:49"), 10, &mut shown).is_empty());
        let n = due(&entries, at("2026-11-04T09:50"), 10, &mut shown);
        assert_eq!(n[0].body, "En 10 min · 10:00–11:00");
        // a lead that crosses midnight
        let late = [entry("b", "2026-11-05T00:30", "2026-11-05T01:00", false)];
        assert_eq!(due(&late, at("2026-11-04T23:45"), 45, &mut HashMap::new()).len(), 1);
    }

    #[test]
    fn all_day_entries_and_broken_stamps_are_skipped_and_the_place_is_shown() {
        let mut with_place = entry("p", "2026-11-04T10:00", "2026-11-04T11:00", false);
        with_place.location = Some("Sala 2".into());
        with_place.title = String::new();
        let entries = [
            entry("d", "2026-11-04", "2026-11-04", true),
            entry("x", "garbage", "garbage", false),
            entry("y", "2026-11-04Té", "", false),
            with_place,
        ];
        let n = due(&entries, at("2026-11-04T10:00"), 0, &mut HashMap::new());
        assert_eq!(
            n,
            [Notice {
                title: "Cita sin título".into(),
                body: "Ahora · 10:00–11:00 · Sala 2".into()
            }]
        );
    }

    #[test]
    fn moving_an_entry_notifies_again_and_old_marks_are_forgotten() {
        let mut shown = HashMap::new();
        let a = [entry("a", "2026-11-04T10:00", "2026-11-04T11:00", false)];
        assert_eq!(due(&a, at("2026-11-04T10:00"), 0, &mut shown).len(), 1);
        let moved = [entry("a", "2026-11-04T10:30", "2026-11-04T11:30", false)];
        assert_eq!(due(&moved, at("2026-11-04T10:30"), 0, &mut shown).len(), 1);
        due(&[], at("2026-11-06T10:00"), 0, &mut shown);
        assert!(shown.is_empty());
    }

    #[test]
    fn settings_are_validated_and_a_broken_file_falls_back_to_the_defaults() {
        let dir = std::env::temp_dir().join(format!("albaro-notif-{}", std::process::id()));
        let path = dir.join("notifications.json");
        assert_eq!(load(&path), Settings::default());
        save(&path, &Settings { enabled: false, lead_minutes: 15 }).unwrap();
        assert_eq!(load(&path), Settings { enabled: false, lead_minutes: 15 });
        assert!(save(&path, &Settings { enabled: true, lead_minutes: 7 }).is_err());
        std::fs::write(&path, "{ not json").unwrap();
        assert_eq!(load(&path), Settings::default());
        std::fs::write(&path, r#"{"enabled":false,"leadMinutes":9999}"#).unwrap();
        assert_eq!(load(&path), Settings::default(), "an invalid lead is not trusted");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_real_calendar_feeds_it_including_a_repeating_entry() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        crate::db::run_migrations(&conn).unwrap();
        let input: calendar::EntryInput = serde_json::from_value(serde_json::json!({
            "title": "Ejercicio", "start": "2026-11-02T08:00", "end": "2026-11-02T09:00", "allDay": false,
            "repeat": { "freq": "daily", "interval": 1 }
        }))
        .unwrap();
        calendar::create_entry(&conn, &input).unwrap();
        let entries = calendar::list_entries(&conn, "2026-11-04", "2026-11-05").unwrap();
        let n = due(&entries, at("2026-11-05T08:00"), 0, &mut HashMap::new());
        assert_eq!(n.len(), 1, "the occurrence of the 5th");
        assert_eq!(n[0].title, "Ejercicio");
    }
}
