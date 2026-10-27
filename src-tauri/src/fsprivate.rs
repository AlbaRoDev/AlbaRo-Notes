use std::path::Path;

/// Makes `path` readable by its owner only: 0700 for a folder, 0600 for a file (Linux and macOS).
///
/// Windows has no mode bits to set. The data folder lives under the user's profile
/// (`%APPDATA%`), which inherits an ACL that only the user, SYSTEM and the administrators have, so
/// nothing is done there.
///
/// Failing is not an error: a volume without Unix permissions (FAT, some network shares) must not
/// stop the app from opening the notes.
pub fn keep_private(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if path.is_dir() { 0o700 } else { 0o600 };
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// The data folder (0700) and the files in it that hold private data, once they exist.
pub fn keep_data_private(dir: &Path, files: &[&str]) {
    keep_private(dir);
    for name in files {
        let path = dir.join(name);
        if path.exists() {
            keep_private(&path);
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn mode(path: &Path) -> u32 {
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn folders_and_files_become_owner_only() {
        let dir = std::env::temp_dir().join(format!("albaro-private-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("data.sqlite");
        std::fs::write(&file, b"x").unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();

        keep_data_private(&dir, &["data.sqlite", "missing.json"]);
        assert_eq!(mode(&dir), 0o700);
        assert_eq!(mode(&file), 0o600);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
