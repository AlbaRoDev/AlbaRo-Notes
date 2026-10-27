//! the calendar as an iCalendar file (`.ics`, RFC 5545), to open in any other calendar app.
//!
//! Times are «floating» local times, as in the app, so they are written without a zone (`DTSTART:20261021T100000`) and every
//! calendar shows them at the same wall-clock time; an all-day entry is a `VALUE=DATE` whose `DTEND` is the day after
//! its last day (iCalendar's end is exclusive). A repeating entry is one `VEVENT` with its `RRULE`, and the days that
//! were skipped are `EXDATE`s; an occurrence that was edited on its own is an event of its own. Because iCalendar counts
//! `DTSTART` as the first occurrence whether or not the rule lands on it, a series is written to start on its first real
//! occurrence. The due dates of the tasks can be added as all-day events. Importing is not done (it comes later).

use crate::calendar::{self, CalendarEntry, Freq, Repeat};
use rusqlite::Connection;

const CRLF: &str = "\r\n";

/// A text value: backslash, semicolon, comma and line breaks are escaped.
fn escape(text: &str) -> String {
    let mut out = String::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\\' | ';' | ',' => {
                out.push('\\');
                out.push(ch);
            }
            '\r' => {
                chars.next_if_eq(&'\n'); // CRLF is one break
                out.push_str("\\n");
            }
            '\n' => out.push_str("\\n"),
            _ => out.push(ch),
        }
    }
    out
}

/// A content line folded to at most 75 octets per line, never inside a character.
fn fold(line: &str) -> String {
    let mut out = String::new();
    let mut used = 0;
    for ch in line.chars() {
        let len = ch.len_utf8();
        if used + len > 75 {
            out.push_str(CRLF);
            out.push(' ');
            used = 1;
        }
        out.push(ch);
        used += len;
    }
    out
}

/// `2026-10-21` → `20261021`.
fn date_value(date: &str) -> String {
    date.replace('-', "")
}

/// `2026-10-21T10:30` → `20261021T103000`; an end at `24:00` is midnight of the next day.
fn time_value(time: &str) -> String {
    let (date, clock) = (&time[..10], &time[11..]);
    if clock == "24:00" {
        return format!("{}T000000", date_value(&calendar::iso(calendar::day_number(date) + 1)));
    }
    format!("{}T{}{}00", date_value(date), &clock[..2], &clock[3..5])
}

/// `2026-10-21 10:30:00` (SQLite) → `20261021T103000Z`.
fn stamp_value(sqlite: &str) -> String {
    let digits: String = sqlite.chars().filter(char::is_ascii_digit).collect();
    format!("{}T{}Z", &digits[..8], &digits[8..14])
}

const DAYS: [&str; 7] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/// The `RRULE` of a rule, for a series whose first occurrence is on `first` (`YYYY-MM-DD`).
fn rrule(rule: &Repeat, first: &str, all_day: bool) -> String {
    let mut parts = vec![format!(
        "FREQ={}",
        match rule.freq {
            Freq::Daily => "DAILY",
            Freq::Weekly => "WEEKLY",
            Freq::Monthly => "MONTHLY",
            Freq::Yearly => "YEARLY",
        }
    )];
    if rule.interval > 1 {
        parts.push(format!("INTERVAL={}", rule.interval));
    }
    let weekday_of_first = (calendar::day_number(first) + 3).rem_euclid(7) as usize;
    match (rule.freq, rule.nth) {
        (Freq::Weekly, _) => {
            let days: Vec<&str> = if rule.weekdays.is_empty() {
                vec![DAYS[weekday_of_first]]
            } else {
                rule.weekdays.iter().map(|d| DAYS[*d as usize % 7]).collect()
            };
            parts.push(format!("BYDAY={}", days.join(",")));
        }
        (Freq::Monthly | Freq::Yearly, Some(n)) => {
            if rule.freq == Freq::Yearly {
                parts.push(format!("BYMONTH={}", first[5..7].trim_start_matches('0')));
            }
            let day = DAYS[rule.weekdays.first().copied().unwrap_or(weekday_of_first as u8) as usize % 7];
            parts.push(format!("BYDAY={n}{day}"));
        }
        (Freq::Monthly, None) if rule.last_day => parts.push("BYMONTHDAY=-1".to_string()),
        _ => {}
    }
    if let Some(count) = rule.count {
        parts.push(format!("COUNT={count}"));
    }
    if let Some(until) = &rule.until {
        // the end must be of the same kind as DTSTART: a date, or a local time (the end of that day)
        parts.push(if all_day {
            format!("UNTIL={}", date_value(until))
        } else {
            format!("UNTIL={}T235959", date_value(until))
        });
    }
    format!("RRULE:{}", parts.join(";"))
}

/// The lines of one entry's `VEVENT`; `None` when a rule never produces an occurrence.
fn event(conn: &Connection, entry: &CalendarEntry, created: &str) -> Result<Option<Vec<String>>, String> {
    let (mut start, mut end) = (entry.start.clone(), entry.end.clone());
    let mut first_day = start[..10].to_string();
    if let Some(rule) = &entry.repeat {
        // the series starts on its first real occurrence, wherever the stored start was
        let from = calendar::day_number(&start[..10]);
        let mut first = None;
        calendar::starts(rule, &start[..10], from + 3_660, |d| {
            first = Some(d);
            false
        });
        let Some(day) = first else { return Ok(None) };
        let by = day - from;
        start = calendar::shift(&start, by);
        end = calendar::shift(&end, by);
        first_day = calendar::iso(day);
    }
    let mut lines = vec![
        "BEGIN:VEVENT".to_string(),
        format!("UID:{}@albaro-notes", entry.id),
        format!("DTSTAMP:{}", stamp_value(created)),
    ];
    if entry.all_day {
        lines.push(format!("DTSTART;VALUE=DATE:{}", date_value(&start)));
        lines.push(format!("DTEND;VALUE=DATE:{}", date_value(&calendar::iso(calendar::day_number(&end) + 1))));
    } else {
        lines.push(format!("DTSTART:{}", time_value(&start)));
        lines.push(format!("DTEND:{}", time_value(&end)));
    }
    if let Some(rule) = &entry.repeat {
        lines.push(rrule(rule, &first_day, entry.all_day));
        let mut skipped: Vec<String> = calendar::exceptions(conn, &entry.id)?.into_iter().filter(|d| d.as_str() >= first_day.as_str()).collect();
        skipped.sort();
        for day in skipped {
            lines.push(if entry.all_day {
                format!("EXDATE;VALUE=DATE:{}", date_value(&day))
            } else {
                format!("EXDATE:{}T{}", date_value(&day), &time_value(&start)[9..])
            });
        }
    }
    lines.push(format!("SUMMARY:{}", escape(&entry.title)));
    if let Some(place) = &entry.location {
        lines.push(format!("LOCATION:{}", escape(place)));
    }
    if let Some(note) = &entry.note {
        lines.push(format!("DESCRIPTION:{}", escape(note)));
    }
    lines.push("END:VEVENT".to_string());
    Ok(Some(lines))
}

/// The whole calendar as an iCalendar document (CRLF line endings, folded lines). `now` is a UTC SQLite-style
/// timestamp for the events that have no creation time of their own (the due dates).
pub fn export(conn: &Connection, include_deadlines: bool, now: &str) -> Result<String, String> {
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        "PRODID:-//AlbaRo Notes//Calendario//ES".to_string(),
        "CALSCALE:GREGORIAN".to_string(),
        "X-WR-CALNAME:AlbaRo Notes".to_string(),
    ];
    for (entry, created) in calendar::all_entries(conn)? {
        if let Some(event_lines) = event(conn, &entry, &created)? {
            lines.extend(event_lines);
        }
    }
    if include_deadlines {
        for due in calendar::all_deadlines(conn)? {
            lines.extend([
                "BEGIN:VEVENT".to_string(),
                format!("UID:deadline-{}@albaro-notes", due.task_id),
                format!("DTSTAMP:{}", stamp_value(now)),
                format!("DTSTART;VALUE=DATE:{}", date_value(&due.date)),
                format!("DTEND;VALUE=DATE:{}", date_value(&calendar::iso(calendar::day_number(&due.date) + 1))),
                format!("SUMMARY:{}", escape(&format!("Fecha límite: {}", due.title))),
                "TRANSP:TRANSPARENT".to_string(),
                "END:VEVENT".to_string(),
            ]);
        }
    }
    lines.push("END:VCALENDAR".to_string());
    Ok(lines.iter().map(|l| fold(l) + CRLF).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calendar::{create_entry, delete_series, update_series, EntryInput, Scope};
    use crate::{databases, db, tasks};
    use serde_json::json;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        db::run_migrations(&conn).unwrap();
        conn
    }

    fn entry(title: &str, start: &str, end: &str, all_day: bool, repeat: Option<Repeat>) -> EntryInput {
        EntryInput {
            task_id: None,
            title: Some(title.to_string()),
            start: start.to_string(),
            end: end.to_string(),
            all_day,
            color: None,
            location: None,
            note: None,
            repeat,
        }
    }

    fn rule(freq: Freq) -> Repeat {
        Repeat {
            freq,
            interval: 1,
            weekdays: Vec::new(),
            until: None,
            count: None,
            nth: None,
            last_day: false,
        }
    }

    const NOW: &str = "2026-10-20 12:00:00";

    /// The unfolded lines of the document.
    fn lines(conn: &Connection, deadlines: bool) -> Vec<String> {
        export(conn, deadlines, NOW)
            .unwrap()
            .replace("\r\n ", "")
            .split("\r\n")
            .map(str::to_string)
            .filter(|l| !l.is_empty())
            .collect()
    }

    fn has(lines: &[String], line: &str) -> bool {
        lines.iter().any(|l| l == line)
    }

    #[test]
    fn a_calendar_is_exported_with_floating_times_exclusive_all_day_ends_and_escaped_text() {
        let conn = conn();
        let mut a = entry("Reunión; con, comas\\y", "2026-10-21T10:00", "2026-10-21T11:30", false, None);
        a.location = Some("Sala 2".to_string());
        a.note = Some("Primera línea\nSegunda".to_string());
        create_entry(&conn, &a).unwrap();
        create_entry(&conn, &entry("Tarde", "2026-10-21T23:00", "2026-10-21T24:00", false, None)).unwrap();
        create_entry(&conn, &entry("Guardia", "2026-10-21T22:00", "2026-10-22T06:30", false, None)).unwrap();
        create_entry(&conn, &entry("Viaje", "2026-10-19", "2026-10-21", true, None)).unwrap();

        let text = export(&conn, false, NOW).unwrap();
        assert!(text.starts_with("BEGIN:VCALENDAR\r\n") && text.ends_with("END:VCALENDAR\r\n"));
        assert!(!text.replace("\r\n", "").contains('\n'), "every line ends in CRLF");
        let l = lines(&conn, false);
        assert!(has(&l, "VERSION:2.0") && has(&l, "PRODID:-//AlbaRo Notes//Calendario//ES"));
        assert!(has(&l, "DTSTART:20261021T100000") && has(&l, "DTEND:20261021T113000"), "no zone: floating");
        assert!(has(&l, "SUMMARY:Reunión\\; con\\, comas\\\\y"));
        assert!(has(&l, "LOCATION:Sala 2") && has(&l, "DESCRIPTION:Primera línea\\nSegunda"));
        assert!(has(&l, "DTSTART:20261021T230000") && has(&l, "DTEND:20261022T000000"), "24:00 is midnight of the next day");
        assert!(has(&l, "DTSTART:20261021T220000") && has(&l, "DTEND:20261022T063000"), "across midnight");
        assert!(
            has(&l, "DTSTART;VALUE=DATE:20261019") && has(&l, "DTEND;VALUE=DATE:20261022"),
            "an all-day end is the day after"
        );
        assert_eq!(l.iter().filter(|x| *x == "BEGIN:VEVENT").count(), 4);
        assert!(l.iter().all(|x| !x.starts_with("UID:") || x.ends_with("@albaro-notes")));
    }

    #[test]
    fn long_lines_fold_at_75_octets_without_cutting_a_character() {
        let conn = conn();
        create_entry(&conn, &entry(&"ñandú ".repeat(30), "2026-10-21", "2026-10-21", true, None)).unwrap();
        let text = export(&conn, false, NOW).unwrap();
        for line in text.split("\r\n") {
            assert!(line.len() <= 75, "{} octets: {line}", line.len());
        }
        assert!(text.contains("\r\n "), "something was folded");
        assert!(text.replace("\r\n ", "").contains("ñandú ".repeat(30).trim_end()), "and it unfolds to the original text");
    }

    #[test]
    fn rules_become_rrules_and_skipped_days_exdates() {
        let conn = conn();
        let mut every_two_days = rule(Freq::Daily);
        every_two_days.interval = 2;
        every_two_days.count = Some(5);
        create_entry(&conn, &entry("Cada 2", "2026-10-21T10:00", "2026-10-21T11:00", false, Some(every_two_days))).unwrap();

        let mut weekdays = rule(Freq::Weekly);
        weekdays.weekdays = vec![0, 2, 4];
        weekdays.until = Some("2026-12-31".to_string());
        let gym = create_entry(&conn, &entry("Gimnasio", "2026-10-21T18:00", "2026-10-21T19:00", false, Some(weekdays))).unwrap(); // a Wednesday
                                                                                                                                   // a day skipped, and one edited on its own (an event of its own)
        delete_series(&conn, &gym.id, Scope::This, Some("2026-10-23")).unwrap();
        let moved = entry("Gimnasio largo", "2026-10-26T18:00", "2026-10-26T20:00", false, None);
        update_series(&conn, &gym.id, &moved, Scope::This, Some("2026-10-26")).unwrap();

        let mut third_tuesday = rule(Freq::Monthly);
        third_tuesday.nth = Some(3);
        third_tuesday.weekdays = vec![1];
        create_entry(&conn, &entry("Comité", "2026-10-20", "2026-10-20", true, Some(third_tuesday))).unwrap();
        let mut last_friday = rule(Freq::Monthly);
        last_friday.nth = Some(-1);
        last_friday.weekdays = vec![4];
        create_entry(&conn, &entry("Cierre", "2026-10-30", "2026-10-30", true, Some(last_friday))).unwrap();
        let mut last_day = rule(Freq::Monthly);
        last_day.last_day = true;
        create_entry(&conn, &entry("Cuentas", "2026-10-31", "2026-10-31", true, Some(last_day))).unwrap();
        let mut thanksgiving = rule(Freq::Yearly);
        thanksgiving.nth = Some(4);
        thanksgiving.weekdays = vec![3];
        create_entry(&conn, &entry("Cena", "2026-11-26", "2026-11-26", true, Some(thanksgiving))).unwrap();
        create_entry(&conn, &entry("Cumple", "2026-10-22", "2026-10-22", true, Some(rule(Freq::Yearly)))).unwrap();

        let l = lines(&conn, false);
        assert!(has(&l, "RRULE:FREQ=DAILY;INTERVAL=2;COUNT=5"));
        assert!(has(&l, "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261231T235959"), "a timed series ends on a local time");
        assert!(has(&l, "EXDATE:20261023T180000"), "the skipped Friday, at the series' time");
        assert!(has(&l, "EXDATE:20261026T180000"), "the Monday that became its own event");
        assert!(has(&l, "SUMMARY:Gimnasio largo") && has(&l, "DTSTART:20261026T180000") && has(&l, "DTEND:20261026T200000"));
        assert!(has(&l, "RRULE:FREQ=MONTHLY;BYDAY=3TU"));
        assert!(has(&l, "RRULE:FREQ=MONTHLY;BYDAY=-1FR"));
        assert!(has(&l, "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1"));
        assert!(has(&l, "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH"));
        assert!(has(&l, "RRULE:FREQ=YEARLY"));
        // an all-day series ends on a date
        let conn2 = self::conn();
        let mut until = rule(Freq::Daily);
        until.until = Some("2026-11-05".to_string());
        create_entry(&conn2, &entry("Curso", "2026-10-21", "2026-10-22", true, Some(until))).unwrap();
        let l2 = lines(&conn2, false);
        assert!(has(&l2, "RRULE:FREQ=DAILY;UNTIL=20261105") && has(&l2, "DTEND;VALUE=DATE:20261023"));
    }

    #[test]
    fn a_series_starts_on_its_first_real_occurrence() {
        let conn = conn();
        // stored from a Wednesday but only on Mondays: iCalendar would count the Wednesday, so the file starts on the Monday
        let mut mondays = rule(Freq::Weekly);
        mondays.weekdays = vec![0];
        create_entry(&conn, &entry("Lunes", "2026-10-21T09:00", "2026-10-21T10:00", false, Some(mondays))).unwrap();
        let l = lines(&conn, false);
        assert!(has(&l, "DTSTART:20261026T090000") && has(&l, "DTEND:20261026T100000"));
        assert!(has(&l, "RRULE:FREQ=WEEKLY;BYDAY=MO"));
        // a rule that never lands (the 31st of a 30-day rule start is fine, but 30 February cannot exist) is not written at all
    }

    #[test]
    fn scheduled_tasks_use_the_tasks_title_and_due_dates_are_optional_all_day_events() {
        let conn = conn();
        let task = tasks::add_task(&conn, "Entregar informe").unwrap();
        create_entry(
            &conn,
            &EntryInput {
                task_id: Some(task.id.clone()),
                title: None,
                ..entry("", "2026-10-21T10:00", "2026-10-21T11:00", false, None)
            },
        )
        .unwrap();
        let base = tasks::ensure_task_base(&conn).unwrap();
        let date = databases::get_database(&conn, &base.database_id)
            .unwrap()
            .unwrap()
            .properties
            .into_iter()
            .find(|p| p.kind == "date")
            .unwrap();
        databases::set_value(&conn, &task.id, &date.id, &json!("2026-10-30")).unwrap();

        let without = lines(&conn, false);
        assert!(has(&without, "SUMMARY:Entregar informe"));
        assert!(!without.iter().any(|l| l.contains("Fecha límite")));
        let with = lines(&conn, true);
        assert!(has(&with, "SUMMARY:Fecha límite: Entregar informe"));
        assert!(has(&with, "DTSTART;VALUE=DATE:20261030") && has(&with, "DTEND;VALUE=DATE:20261031"));
        assert!(has(&with, &format!("UID:deadline-{}@albaro-notes", task.id)));
        assert!(has(&with, "DTSTAMP:20261020T120000Z"));
    }

    #[test]
    fn an_empty_calendar_is_still_a_valid_file() {
        let conn = conn();
        assert_eq!(
            export(&conn, true, NOW).unwrap(),
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AlbaRo Notes//Calendario//ES\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:AlbaRo Notes\r\nEND:VCALENDAR\r\n"
        );
    }
}
