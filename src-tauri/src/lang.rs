//! The language of the interface, told by the page at start and every time it changes (`set_language`).
//! Rust only needs it for what it writes itself: the notices, the seeds of the task database and the
//! instruction that makes the AI answer in the language of the interface. Errors are translated by the page.

use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

pub fn set(code: &str) {
    ENGLISH.store(code == "en", Ordering::Relaxed);
}

pub fn is_english() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

/// `es` in Spanish, `en` in English.
pub fn pick<'a>(es: &'a str, en: &'a str) -> &'a str {
    if is_english() {
        en
    } else {
        es
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // One test: the language is a process-wide switch, so a second test could race with it.
    #[test]
    fn the_language_picks_the_text() {
        set("en");
        assert_eq!(pick("Hola", "Hello"), "Hello");
        set("es");
        assert_eq!(pick("Hola", "Hello"), "Hola");
        set("fr"); // anything but "en" is Spanish
        assert_eq!(pick("Hola", "Hello"), "Hola");
    }
}
