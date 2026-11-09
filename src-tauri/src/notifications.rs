//! System notifications for the calendar: when the time of an entry with an hour arrives (or a few minutes before,
//! as the user chose) the app shows a native notification with its title, time and place, as Notion Calendar does.
//!
//! A thread wakes up every few seconds, reads the entries of today and tomorrow (a repeating one comes once per
//! occurrence) and shows what is due. It runs in Rust, not in the page: a hidden or minimized window has its
//! timers throttled, and nothing here needs a permission for the page (`tauri-plugin-notification` is used only from
//! here, and a test in `lib.rs` checks that no capability grants it).
//!
//! On a phone nothing may depend on that thread (the system suspends the app in the background), so there the
//! notices are handed to the system's alarm clock instead (`AlarmManager` through the plugin): while the app runs,
//! the thread keeps the alarms of the next two weeks equal to the calendar (`plan` + `sync`), and the system shows
//! them with the app closed.
//!
//! Known limits: on desktop it works while the app is running (closed, nothing watches); on a phone the alarms
//! cover the next `HORIZON_DAYS` from the last time the app ran, are inexact (a few minutes late) unless the user
//! allows exact alarms for the app, and the ones already set are lost on a reboot until the app is opened;
//! all-day entries, the «Fecha límite»
//! of the tasks and the date mentions of the pages have no hour, so they do not notify; what was due while the
//! computer slept for longer than `GRACE_MINUTES` is not shown late; clicking a notification only brings the app
//! up (the plugin has no click handler on desktop).

use crate::calendar::{self, CalendarEntry};
use crate::db::DbState;
use crate::lang;
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
/// How far ahead a phone's alarms are set, and how many at most (the system limits what an app may schedule).
#[cfg(mobile)]
const HORIZON_DAYS: u64 = 14;
#[cfg(any(mobile, test))]
const MAX_ALARMS: usize = 100;

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
#[derive(Debug, PartialEq, Clone)]
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
#[cfg(any(desktop, test))]
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
        out.push(notice_of(e, start - now));
    }
    out
}

/// What is shown for `e`, `left` minutes before it starts.
fn notice_of(e: &CalendarEntry, left: i64) -> Notice {
    let when = if left <= 0 {
        lang::pick("Ahora", "Now").to_string()
    } else {
        format!("{} {left} min", lang::pick("En", "In"))
    };
    let mut body = format!("{when} · {}–{}", clock(&e.start), clock(&e.end));
    if let Some(place) = e.location.as_deref().filter(|l| !l.is_empty()) {
        body.push_str(&format!(" · {place}"));
    }
    let title = if e.title.is_empty() {
        lang::pick("Cita sin título", "Untitled event").to_string()
    } else {
        e.title.clone()
    };
    Notice { title, body }
}

/// Now as minutes since 1970 (local), today and the day `days_ahead` later (`YYYY-MM-DD`).
fn now_minutes(days_ahead: u64) -> (i64, String, String) {
    let now = chrono::Local::now().naive_local();
    let (today, tomorrow) = (now.date(), now.date() + chrono::Days::new(days_ahead));
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
#[cfg(desktop)]
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut shown: HashMap<String, i64> = HashMap::new();
        loop {
            std::thread::sleep(CHECK_EVERY);
            let settings = settings_path(&app).map(|p| load(&p)).unwrap_or_default();
            if !settings.enabled {
                continue;
            }
            let Some((now, entries)) = calendar_ahead(&app, 1) else { continue };
            for notice in due(&entries, now, settings.lead_minutes, &mut shown) {
                if let Err(e) = show(&app, &notice) {
                    eprintln!("notification failed: {e}");
                }
            }
        }
    });
}

/// Now (minutes since 1970, local) and the entries from today to `days_ahead` days later.
fn calendar_ahead(app: &AppHandle, days_ahead: u64) -> Option<(i64, Vec<CalendarEntry>)> {
    let (now, today, last) = now_minutes(days_ahead);
    let state = app.state::<DbState>();
    let conn = state.0.lock().ok()?;
    let entries = calendar::list_entries(&conn, &today, &last);
    drop(conn); // the notification is shown without holding the database
    Some((now, entries.ok()?))
}

/// Starts the thread that keeps the system's alarms equal to the calendar. It sets them at once and checks again
/// every few seconds (a change, a new language or a new lead is a different plan); the system fires them.
#[cfg(mobile)]
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut scheduled = Scheduled::new();
        loop {
            let settings = settings_path(&app).map(|p| load(&p)).unwrap_or_default();
            let wanted = match calendar_ahead(&app, HORIZON_DAYS) {
                Some((now, entries)) if settings.enabled => Some(plan(&entries, now, settings.lead_minutes)),
                _ if !settings.enabled => Some(Vec::new()),
                _ => None, // the calendar could not be read this time: leave the alarms as they are
            };
            if let Some(wanted) = wanted {
                sync(&app, &wanted, &mut scheduled);
            }
            std::thread::sleep(CHECK_EVERY);
        }
    });
}

/// One alarm to set: the system fires it at `at` (minutes since 1970, local) whatever the app is doing.
#[cfg(any(mobile, test))]
#[derive(Debug, PartialEq, Clone)]
struct Alarm {
    id: i32,
    at: i64,
    notice: Notice,
}

/// A number for an occurrence that stays the same between runs and versions (so setting it again replaces the
/// alarm instead of adding another, and a removed one can be cancelled): FNV-1a, never 0 and never negative.
#[cfg(any(mobile, test))]
fn alarm_id(key: &str) -> i32 {
    let hash = key.bytes().fold(0x811c_9dc5_u32, |h, b| (h ^ u32::from(b)).wrapping_mul(0x0100_0193));
    ((hash & 0x7fff_ffff) as i32).max(1)
}

/// The alarms the calendar asks for: each entry with an hour, `lead` minutes before it, that is still to come, soonest
/// first and at most `MAX_ALARMS`. The same entries and lead always give the same alarms.
#[cfg(any(mobile, test))]
fn plan(entries: &[CalendarEntry], now: i64, lead: u32) -> Vec<Alarm> {
    let mut out: Vec<Alarm> = entries
        .iter()
        .filter(|e| !e.all_day)
        .filter_map(|e| {
            let at = minutes_of(&e.start)? - i64::from(lead);
            (at > now).then(|| Alarm {
                id: alarm_id(&format!("{}@{}", e.id, e.start)),
                at,
                notice: notice_of(e, i64::from(lead)),
            })
        })
        .collect();
    out.sort_by_key(|a| (a.at, a.id));
    out.dedup_by_key(|a| a.id);
    out.truncate(MAX_ALARMS);

    out
}

/// What the alarms were last set to (by id), to touch only what changed.
#[cfg(mobile)]
type Scheduled = HashMap<i32, Alarm>;

/// Sets what is new or different and cancels what is no longer wanted (deleted, moved or beyond the horizon). What
/// has already gone off is only forgotten: cancelling it would also take its notice out of the shade.
#[cfg(mobile)]
fn sync(app: &AppHandle, wanted: &[Alarm], scheduled: &mut Scheduled) {
    use tauri_plugin_notification::Schedule;
    let (now, ..) = now_minutes(0);
    scheduled.retain(|_, a| a.at > now);
    let gone: Vec<i32> = scheduled.keys().copied().filter(|id| !wanted.iter().any(|w| w.id == *id)).collect();
    if !gone.is_empty() {
        match app.notification().cancel(gone.clone()) {
            Ok(()) => gone.iter().for_each(|id| drop(scheduled.remove(id))),
            Err(e) => eprintln!("cancelling alarms failed: {e}"),
        }
    }
    for alarm in wanted {
        if scheduled.get(&alarm.id) == Some(alarm) {
            continue;
        }
        let Some(date) = local_time(alarm.at) else { continue };
        let set = app
            .notification()
            .builder()
            .id(alarm.id)
            .title(&alarm.notice.title)
            .body(&alarm.notice.body)
            .schedule(Schedule::At {
                date,
                repeating: false,
                allow_while_idle: true,
            })
            .show();
        match set {
            Ok(()) => drop(scheduled.insert(alarm.id, alarm.clone())),
            Err(e) => eprintln!("setting an alarm failed: {e}"),
        }
    }
}

/// The moment of `minutes` (local time of day since 1970) as the instant the plugin wants, with the offset the clock
/// has then (a change of summer time in between is respected). `None` for a time that does not exist.
#[cfg(mobile)]
fn local_time(minutes: i64) -> Option<time::OffsetDateTime> {
    use chrono::TimeZone;
    let naive = chrono::DateTime::from_timestamp(minutes.checked_mul(60)?, 0)?.naive_utc();
    let instant = chrono::Local.from_local_datetime(&naive).earliest()?;
    time::OffsetDateTime::from_unix_timestamp(instant.timestamp()).ok()
}

/// Whether the system lets the app show notices; on Android 13+ `ask` shows the system's question (once). Always
/// true on desktop.
pub fn permission(app: &AppHandle, ask: bool) -> Result<bool, String> {
    #[cfg(mobile)]
    {
        use tauri_plugin_notification::PermissionState;
        let notification = app.notification();
        let state = if ask { notification.request_permission() } else { notification.permission_state() };
        Ok(state.map_err(|e| e.to_string())? == PermissionState::Granted)
    }
    #[cfg(desktop)]
    {
        let _ = (app, ask);
        Ok(true)
    }
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
    fn the_phone_sets_an_alarm_per_future_entry_with_an_hour_and_the_same_one_every_time() {
        let entries = [
            entry("past", "2026-11-04T09:00", "2026-11-04T10:00", false),
            entry("next", "2026-11-04T12:00", "2026-11-04T13:00", false),
            entry("day", "2026-11-04", "2026-11-04", true),
            entry("later", "2026-11-05T08:00", "2026-11-05T09:00", false),
            entry("x", "garbage", "garbage", false),
        ];
        let now = at("2026-11-04T10:00");
        let alarms = plan(&entries, now, 15);
        assert_eq!(alarms.iter().map(|a| a.at).collect::<Vec<_>>(), [at("2026-11-04T11:45"), at("2026-11-05T07:45")]);
        assert_eq!(alarms[0].notice.body, "En 15 min · 12:00–13:00", "the lead is said as it is, not as the minutes left");
        assert_eq!(alarms, plan(&entries, now, 15), "same calendar, same alarms (same ids: setting again replaces)");
        assert_ne!(alarms[0].id, alarms[1].id);
        assert!(alarms.iter().all(|a| a.id > 0));
        // an alarm whose time has already come is not set (the system refuses a past time)
        assert_eq!(plan(&entries, at("2026-11-04T11:45"), 15).len(), 1);
        // moving an entry is another occurrence: another alarm
        let moved = [entry("next", "2026-11-04T12:30", "2026-11-04T13:30", false)];
        assert_ne!(plan(&moved, now, 0)[0].id, alarm_id("next@2026-11-04T12:00"));
    }

    #[test]
    fn the_phone_never_sets_more_alarms_than_the_cap_and_keeps_the_soonest() {
        let entries: Vec<_> = (0..MAX_ALARMS + 20)
            .map(|i| entry(&format!("e{i}"), &format!("2026-11-05T{:02}:{:02}", 8 + i / 60, i % 60), "2026-11-05T23:00", false))
            .collect();
        let alarms = plan(&entries, at("2026-11-04T10:00"), 0);
        assert_eq!(alarms.len(), MAX_ALARMS);
        assert_eq!(alarms[0].at, at("2026-11-05T08:00"));
        assert!(alarms.windows(2).all(|w| w[0].at <= w[1].at));
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
