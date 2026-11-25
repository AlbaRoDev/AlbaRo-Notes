// Reading GitHub's "latest release" answer for the phone app, which cannot replace itself the way the
// desktop one does (see `app_update_mobile.rs`). Pure functions, so they are tested on any machine.

/// Where releases are downloaded from. The address of the APK is built here from the version, never
/// taken from the reply, so a strange reply cannot make the app open a stranger's address.
const DOWNLOADS: &str = "https://github.com/Alvraco/Alvraco-Notes/releases/download";

/// A newer release that has an APK for phones.
#[derive(Debug, PartialEq)]
pub struct Found {
    pub version: String,
    pub url: String,
}

/// `v1.2.3` or `1.2.3` as numbers; anything else (a pre-release tag, a missing part) is `None`.
pub fn parse_version(text: &str) -> Option<[u64; 3]> {
    let mut parts = text.strip_prefix('v').unwrap_or(text).split('.');
    let mut out = [0u64; 3];
    for slot in &mut out {
        let part = parts.next()?;
        if part.is_empty() || part.len() > 6 || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        *slot = part.parse().ok()?;
    }
    parts.next().is_none().then_some(out)
}

/// The latest release in `reply` (GitHub's JSON), if it is newer than `current` and carries the APK.
pub fn newer_release(reply: &str, current: &str) -> Result<Option<Found>, String> {
    let json: serde_json::Value = serde_json::from_str(reply).map_err(|_| "unreadable reply from the release server".to_string())?;
    let tag = json.get("tag_name").and_then(|t| t.as_str()).ok_or("unexpected reply from the release server")?;
    let (Some(latest), Some(mine)) = (parse_version(tag), parse_version(current)) else {
        return Err("unexpected version in the release reply".to_string());
    };
    if latest <= mine {
        return Ok(None);
    }
    let version = tag.strip_prefix('v').unwrap_or(tag);
    let apk = format!("Alvraco-Notes_{version}_android-arm64.apk");
    let has_apk = json
        .get("assets")
        .and_then(|a| a.as_array())
        .is_some_and(|assets| assets.iter().any(|a| a.get("name").and_then(|n| n.as_str()) == Some(apk.as_str())));
    if !has_apk {
        // The Windows installer can be published first; the phone version is offered once its APK is there.
        return Ok(None);
    }
    Ok(Some(Found {
        version: version.to_string(),
        url: format!("{DOWNLOADS}/v{version}/{apk}"),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reply(tag: &str, assets: &[&str]) -> String {
        let assets: Vec<String> = assets.iter().map(|n| format!(r#"{{"name":"{n}"}}"#)).collect();
        format!(r#"{{"tag_name":"{tag}","assets":[{}]}}"#, assets.join(","))
    }

    #[test]
    fn versions_are_three_numbers() {
        assert_eq!(parse_version("v1.1.2"), Some([1, 1, 2]));
        assert_eq!(parse_version("1.10.0"), Some([1, 10, 0]));
        for bad in ["", "v1.1", "1.1.2.3", "v1.1.x", "1.1.2-beta", "v1..2", "1.1.-2", "1.1.9999999"] {
            assert_eq!(parse_version(bad), None, "{bad}");
        }
        // numbers, not text: 1.10.0 is later than 1.9.0
        assert!(parse_version("1.10.0") > parse_version("1.9.0"));
    }

    #[test]
    fn offers_only_a_newer_release_with_its_apk() {
        let apk = "Alvraco-Notes_1.1.3_android-arm64.apk";
        let found = newer_release(&reply("v1.1.3", &[apk, "latest.json"]), "1.1.2").unwrap();
        assert_eq!(
            found,
            Some(Found {
                version: "1.1.3".into(),
                url: "https://github.com/Alvraco/Alvraco-Notes/releases/download/v1.1.3/Alvraco-Notes_1.1.3_android-arm64.apk".into()
            })
        );
        // the same or an older release: nothing to offer
        assert_eq!(newer_release(&reply("v1.1.2", &[apk]), "1.1.2").unwrap(), None);
        assert_eq!(newer_release(&reply("v1.0.9", &[apk]), "1.1.2").unwrap(), None);
        // newer, but the APK is not up yet
        assert_eq!(newer_release(&reply("v1.1.3", &["latest.json"]), "1.1.2").unwrap(), None);
        // an APK of another version does not count
        assert_eq!(newer_release(&reply("v1.1.3", &["Alvraco-Notes_1.1.2_android-arm64.apk"]), "1.1.2").unwrap(), None);
    }

    #[test]
    fn a_strange_reply_is_an_error_and_never_an_address() {
        assert!(newer_release("not json", "1.1.2").is_err());
        assert!(newer_release("{}", "1.1.2").is_err());
        // a tag that is not a plain version cannot smuggle text into the address
        assert!(newer_release(&reply("v1.1.3/../../evil", &["x"]), "1.1.2").is_err());
        assert!(newer_release(&reply("v1.1.3?x=1", &["x"]), "1.1.2").is_err());
    }
}
