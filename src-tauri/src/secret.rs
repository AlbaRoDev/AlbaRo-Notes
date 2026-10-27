//! Where the AI service's API key lives.
//!
//! In the operating system's credential store when there is one (Windows Credential Manager, macOS
//! Keychain). Then the key is not in the data folder, so it does not travel with a copy of it: a
//! backup, moving the notes to another computer, sending the folder to ask for help. Where there is
//! no store (Linux, for now: the Secret Service backend has not been tried) it stays in
//! `ai-config.json`, readable by its owner only, and the settings say so.

/// One secret, in some place that is not the notes' data folder.
pub trait Store {
    /// The secret, or `None` if there is none. An error means the store could not be asked (locked, missing).
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, secret: &str) -> Result<(), String>;
    /// Removing what is not there is not an error.
    fn delete(&self) -> Result<(), String>;
}

/// The operating system's credential store. `service` is the app identifier, so a second copy of the
/// app with another identifier (a test instance) never touches this one's key.
pub struct OsStore {
    #[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
    service: String,
}

impl OsStore {
    pub fn new(service: &str) -> Self {
        OsStore { service: service.to_string() }
    }
}

#[cfg(any(windows, target_os = "macos"))]
impl OsStore {
    fn entry(&self) -> Result<keyring::Entry, String> {
        keyring::Entry::new(&self.service, "ai-api-key").map_err(|e| e.to_string())
    }
}

#[cfg(any(windows, target_os = "macos"))]
impl Store for OsStore {
    fn get(&self) -> Result<Option<String>, String> {
        match self.entry()?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, secret: &str) -> Result<(), String> {
        self.entry()?.set_password(secret).map_err(|e| e.to_string())
    }

    fn delete(&self) -> Result<(), String> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// No store here: nothing is ever kept, and asking to keep something says so.
#[cfg(not(any(windows, target_os = "macos")))]
impl Store for OsStore {
    fn get(&self) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn set(&self, _secret: &str) -> Result<(), String> {
        Err("Este sistema no ofrece un almacén de credenciales".to_string())
    }

    fn delete(&self) -> Result<(), String> {
        Ok(())
    }
}
