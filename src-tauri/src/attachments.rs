//! Binary attachments (images, video, audio, files) and web-link previews.
//!
//! Files live in `<app_data>/attachments/<uuid>.<ext>`; Tiptap nodes only
//! store that bare file name. Every command that takes a file name from the
//! frontend re-validates it with `valid_attachment_name` — the name is the
//! only thing standing between the asset protocol / `open` / `save as` and an
//! arbitrary path.

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{self, Read};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::path::{Path, PathBuf};
use std::time::Duration;
use ureq::http::Uri;
use ureq::unversioned::resolver::{DefaultResolver, ResolvedSocketAddrs, Resolver};
use ureq::unversioned::transport::{DefaultConnector, NextTimeout};
use ureq::ResponseExt;
use url::{Host, Url};
use uuid::Uuid;

pub struct AttachmentsDir(pub PathBuf);

pub const MAX_ATTACHMENT_BYTES: u64 = 50 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES: u64 = 5 * 1024 * 1024;
const MAX_HTML_BYTES: u64 = 512 * 1024;
const MAX_URL_LEN: usize = 2048;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const PREVIEW_TIMEOUT: Duration = Duration::from_secs(10);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);
const TMP_PREFIX: &str = ".tmp-";

/// Opening these with the OS default handler could run code (executables,
/// scripts, shortcuts) or render attacker-controlled HTML/SVG with script in a
/// browser. They can still be saved to disk.
const BLOCKED_OPEN_EXT: &[&str] = &[
    // Windows programs, scripts, shortcuts and installers
    "exe",
    "msi",
    "msp",
    "bat",
    "cmd",
    "com",
    "scr",
    "pif",
    "ps1",
    "psm1",
    "ps1xml",
    "psc1",
    "vbs",
    "vbe",
    "vb",
    "js",
    "jse",
    "wsf",
    "wsh",
    "ws",
    "hta",
    "lnk",
    "url",
    "reg",
    "inf",
    "scf",
    "jar",
    "jnlp",
    "dll",
    "cpl",
    "msc",
    "chm",
    "gadget",
    "application",
    "appref-ms",
    "settingcontent-ms",
    "library-ms",
    "search-ms",
    "diagcab",
    "appx",
    "msix",
    "appxbundle",
    "msixbundle",
    // Office files that carry macros, and add-ins
    "docm",
    "dotm",
    "xlsm",
    "xltm",
    "xlam",
    "xll",
    "wll",
    "pptm",
    "potm",
    "ppam",
    "sldm",
    // pages that would run script in the browser
    "html",
    "htm",
    "xhtml",
    "svg",
    "mht",
    "mhtml",
    // Linux and macOS launchers, installers and scripts
    "sh",
    "bash",
    "zsh",
    "command",
    "desktop",
    "app",
    "pkg",
    "dmg",
    "run",
    "py",
    "pyw",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo {
    pub file: String,
    pub size: u64,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreview {
    pub title: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
    /// Attachment file name of the downloaded thumbnail, not a remote URL.
    pub image: Option<String>,
}

fn max_mb(max: u64) -> u64 {
    max / (1024 * 1024)
}

// ---------------------------------------------------------------- names

/// `<uuid v4 lowercase>.<1-8 lowercase alphanumerics>` — nothing else is ever
/// accepted as an attachment reference.
pub fn valid_attachment_name(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else { return false };
    stem.len() == 36
        && stem.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b) || b == b'-')
        && Uuid::parse_str(stem).is_ok()
        && (1..=8).contains(&ext.len())
        && ext.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

fn sanitize_ext(raw: &str) -> String {
    let ext: String = raw
        .trim_start_matches('.')
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_ascii_lowercase();
    if ext.is_empty() {
        "bin".to_string()
    } else {
        ext
    }
}

fn ext_from_content_type(ct: &str) -> Option<&'static str> {
    Some(match ct {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/avif" => "avif",
        "image/svg+xml" => "svg",
        "image/bmp" => "bmp",
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/ogg" => "ogv",
        "video/quicktime" => "mov",
        "audio/mpeg" => "mp3",
        "audio/mp4" => "m4a",
        "audio/aac" => "aac",
        "audio/ogg" => "ogg",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/webm" => "weba",
        "audio/flac" => "flac",
        _ => return None,
    })
}

fn ext_for(url: &Url, content_type: &str) -> String {
    if let Some(ext) = ext_from_content_type(content_type) {
        return ext.to_string();
    }
    let last = url.path_segments().and_then(|mut s| s.next_back()).unwrap_or("");
    last.rsplit_once('.').map(|(_, e)| sanitize_ext(e)).unwrap_or_else(|| "bin".to_string())
}

// -------------------------------------------------------------- storage

/// Streams `reader` into a temp file, then renames it to its final
/// `<uuid>.<ext>` name — a crash or an over-limit upload never leaves a
/// half-written file under a name something could reference.
fn copy_limited(mut reader: impl Read, dir: &Path, ext: &str, max: u64) -> Result<AttachmentInfo, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    crate::fsprivate::keep_private(dir);
    let file = format!("{}.{}", Uuid::new_v4(), sanitize_ext(ext));
    let tmp = dir.join(format!("{TMP_PREFIX}{}", Uuid::new_v4()));

    let copied = fs::File::create(&tmp).and_then(|mut f| io::copy(&mut (&mut reader).take(max + 1), &mut f)).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("No se pudo guardar el archivo: {e}")
    })?;

    if copied > max {
        let _ = fs::remove_file(&tmp);
        return Err(format!("El archivo supera el límite de {} MB", max_mb(max)));
    }
    fs::rename(&tmp, dir.join(&file)).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })?;
    crate::fsprivate::keep_private(&dir.join(&file));
    Ok(AttachmentInfo { file, size: copied })
}

pub fn store_bytes(dir: &Path, bytes: &[u8], ext: &str) -> Result<AttachmentInfo, String> {
    if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err(format!("El archivo supera el límite de {} MB", max_mb(MAX_ATTACHMENT_BYTES)));
    }
    copy_limited(bytes, dir, ext, MAX_ATTACHMENT_BYTES)
}

pub fn resolve(dir: &Path, file: &str) -> Result<PathBuf, String> {
    if !valid_attachment_name(file) {
        return Err("Referencia de archivo no válida".to_string());
    }
    let path = dir.join(file);
    if !path.is_file() {
        return Err("El archivo ya no existe".to_string());
    }
    Ok(path)
}

pub fn ensure_openable(file: &str) -> Result<(), String> {
    let ext = file.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    if BLOCKED_OPEN_EXT.contains(&ext) {
        return Err("Por seguridad este tipo de archivo no se abre desde la app; usa «Guardar como…»".to_string());
    }
    Ok(())
}

/// Deletes attachments no block references any more (block deleted, page
/// deleted by cascade) plus leftover temp files. Runs once at startup, before
/// any command is served: sweeping at runtime could delete a just-uploaded
/// file whose save is still in the 800 ms debounce, or one an Undo is about
/// to bring back.
pub fn sweep_orphans(conn: &Connection, dir: &Path) -> rusqlite::Result<usize> {
    let Ok(entries) = fs::read_dir(dir) else { return Ok(0) };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let orphan = if name.starts_with(TMP_PREFIX) {
            true
        } else if valid_attachment_name(&name) {
            !is_referenced(conn, &name)?
        } else {
            false
        };
        if orphan && fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Whether any page document, synced block, page cover or trashed page still points at this attachment.
fn is_referenced(conn: &Connection, name: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM blocks WHERE instr(content, ?1) > 0)
             OR EXISTS(SELECT 1 FROM synced_blocks WHERE instr(content, ?1) > 0)
             OR EXISTS(SELECT 1 FROM pages WHERE cover = 'image:' || ?1)
             OR EXISTS(SELECT 1 FROM trash WHERE instr(snapshot, ?1) > 0)",
        [name],
        |r| r.get::<_, bool>(0),
    )
}

/// Deletes the attachments named in `texts` (snapshots of what was deleted) that nothing points at now.
/// Deleting a page does not call this: its files wait in the trash with the rest of it (`is_referenced`
/// counts the trash) and go when the trash entry does (trash::purge). Only the files named there are looked
/// at: one uploaded a moment ago and not saved into any page yet is not touched.
///
/// Known limit: removing a file does not overwrite its bytes, and on an SSD or a journaling file system
/// it could not be relied on if it did; full-disk encryption is the answer to that, not this.
pub fn remove_unreferenced(conn: &Connection, dir: &Path, texts: &[String]) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(dir) else { return Ok(()) };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if valid_attachment_name(&name) && texts.iter().any(|t| t.contains(&name)) && !is_referenced(conn, &name).map_err(|e| e.to_string())? {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

// ----------------------------------------------------------- validation

pub fn parse_http_url(s: &str) -> Result<Url, String> {
    if s.len() > MAX_URL_LEN {
        return Err("La URL es demasiado larga".to_string());
    }
    let url = Url::parse(s.trim()).map_err(|_| "La URL no es válida".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
        return Err("Solo se admiten URLs http o https".to_string());
    }
    Ok(url)
}

/// Walks the doc depth-first rejecting attachment references that aren't
/// well-formed file names and bookmark URLs that aren't http(s) — the JSON
/// arrives untyped, and the frontend builds asset URLs / links from it.
pub fn validate_refs(node: &Value) -> Result<(), String> {
    let attrs = node.get("attrs");
    let attr_str = |key: &str| -> Result<Option<&str>, String> {
        match attrs.and_then(|a| a.get(key)) {
            None | Some(Value::Null) => Ok(None),
            Some(v) => v.as_str().map(Some).ok_or_else(|| format!("{key} must be a string or null")),
        }
    };
    let check_file = |key: &str| -> Result<(), String> {
        match attr_str(key)? {
            Some(f) if !valid_attachment_name(f) => Err(format!("Invalid attachment reference: {f}")),
            _ => Ok(()),
        }
    };
    match node.get("type").and_then(|t| t.as_str()) {
        Some("image" | "video" | "audio" | "fileBlock") => check_file("file")?,
        Some("webBookmark") => {
            check_file("image")?;
            if let Some(u) = attr_str("url")? {
                parse_http_url(u)?;
            }
        }
        _ => {}
    }
    if let Some(children) = node.get("content").and_then(|c| c.as_array()) {
        for child in children {
            validate_refs(child)?;
        }
    }
    Ok(())
}

// ----------------------------------------------------------------- http

/// Whether an address belongs to the internet, and not to this machine, the local network or a
/// reserved range. IPv6 forms that embed an IPv4 address (mapped, NAT64, 6to4) are judged by it.
fn ip_is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => v4_public(ip),
        IpAddr::V6(ip) => v6_public(ip),
    }
}

fn v4_public(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    !(ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
        || o[0] == 0
        || o[0] >= 240
        || (o[0] == 100 && (o[1] & 0xC0) == 64)
        || (o[0] == 198 && (o[1] & 0xFE) == 18))
}

fn v6_public(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return v4_public(v4);
    }
    let s = ip.segments();
    let embedded = |hi: u16, lo: u16| Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8);
    // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) carry an IPv4 address that decides where the packet really goes
    if s[..6] == [0x64, 0xff9b, 0, 0, 0, 0] && !v4_public(embedded(s[6], s[7])) {
        return false;
    }
    if s[0] == 0x2002 && !v4_public(embedded(s[1], s[2])) {
        return false;
    }
    !(ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() || (s[0] & 0xfe00) == 0xfc00 || (s[0] & 0xffc0) == 0xfe80)
}

/// Refuses loopback / private / link-local targets, by the literal host. A name is only checked
/// for the obvious local ones: what it *resolves* to is the job of [`PublicOnly`], at connect time.
/// Kept for the thumbnail URL we pull out of third-party HTML, as a first, cheap filter.
fn is_public_http_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && match url.host() {
            Some(Host::Domain(d)) => !is_local_name(d),
            Some(Host::Ipv4(ip)) => v4_public(ip),
            Some(Host::Ipv6(ip)) => v6_public(ip),
            None => false,
        }
}

/// A name only this machine or a home or office network can answer: `localhost`, `*.local`,
/// `*.lan`…, or no dot at all (`nas`, `router`).
fn is_local_name(domain: &str) -> bool {
    let d = domain.trim_end_matches('.').to_ascii_lowercase();
    !d.contains('.')
        || [".localhost", ".local", ".internal", ".lan", ".home", ".home.arpa", ".intranet", ".corp"]
            .iter()
            .any(|suffix| d.ends_with(suffix))
}

/// Whether the user, typing this address, plainly meant their own machine or network: an IP
/// address of one, or one of those local names. Only then may a request reach a private address.
/// A name that looks public (`localtest.me`, `127.0.0.1.nip.io`) never gets there, whatever DNS
/// says: the typed text is the only thing that can be trusted to show the intent.
fn is_visibly_local(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(d)) => is_local_name(d),
        Some(Host::Ipv4(ip)) => !v4_public(ip),
        Some(Host::Ipv6(ip)) => !v6_public(ip),
        None => false,
    }
}

/// Resolves like the default resolver but drops every address that is not public, so a request
/// that began on the internet cannot end on this machine or the local network. It sits in the
/// resolution itself, which runs again for every redirect, and the address it returns is the one
/// ureq connects to: there is no gap between checking a name and using it (DNS rebinding).
#[derive(Debug)]
struct PublicOnly;

impl Resolver for PublicOnly {
    fn resolve(&self, uri: &Uri, config: &ureq::config::Config, timeout: NextTimeout) -> Result<ResolvedSocketAddrs, ureq::Error> {
        let all = DefaultResolver::default().resolve(uri, config, timeout)?;
        let mut kept = self.empty();
        for addr in all.iter().filter(|a| ip_is_public(a.ip())) {
            kept.push(*addr);
        }
        if kept.is_empty() {
            Err(ureq::Error::HostNotFound)
        } else {
            Ok(kept)
        }
    }
}

type Response = ureq::http::Response<ureq::Body>;

/// `public_only`: refuse to connect to anything that is not on the internet, at any hop of the chain.
fn http_get(url: &Url, redirects: u32, timeout: Duration, public_only: bool) -> Result<Response, String> {
    let config = ureq::Agent::config_builder()
        .timeout_connect(Some(CONNECT_TIMEOUT))
        .timeout_global(Some(timeout))
        .max_redirects(redirects)
        // with redirects(0) the 3xx comes back as the response, and check_kind refuses it
        .max_redirects_will_error(false)
        .http_status_as_error(false)
        .user_agent("AlbaRoNotes/0.1")
        .build();
    let agent = if public_only {
        ureq::Agent::with_parts(config, DefaultConnector::default(), PublicOnly)
    } else {
        config.into()
    };
    match agent.get(url.as_str()).call() {
        Ok(resp) if resp.status().as_u16() >= 400 => Err(format!("El servidor respondió con el error {}", resp.status().as_u16())),
        Ok(resp) => Ok(resp),
        Err(_) => Err("No se pudo conectar (sin red, dirección inexistente o tiempo de espera agotado)".to_string()),
    }
}

/// The response's media type, lowercase and without parameters; `text/plain` if the server sent none.
pub fn content_type(resp: &Response) -> String {
    resp.body().mime_type().unwrap_or("text/plain").to_ascii_lowercase()
}

fn check_kind(resp: &Response, kind: &str) -> Result<(), String> {
    if kind == "file" {
        return Ok(());
    }
    let ct = content_type(resp);
    if ct.starts_with(&format!("{kind}/")) {
        Ok(())
    } else {
        Err(format!("La URL no apunta a un archivo de tipo {kind} (el servidor devuelve «{ct}»)"))
    }
}

fn check_length(resp: &Response, max: u64) -> Result<(), String> {
    match resp.body().content_length() {
        Some(len) if len > max => Err(format!("El archivo supera el límite de {} MB", max_mb(max))),
        _ => Ok(()),
    }
}

/// Downloads a user-typed URL into the attachments folder. `kind` is
/// "image" | "video" | "audio" | "file"; for the first three the server's
/// content-type must match, so a page URL in an Image block fails cleanly.
pub fn download(dir: &Path, url: &str, kind: &str) -> Result<AttachmentInfo, String> {
    if !matches!(kind, "image" | "video" | "audio" | "file") {
        return Err("Tipo de adjunto desconocido".to_string());
    }
    let url = parse_http_url(url)?;
    let resp = http_get(&url, 5, DOWNLOAD_TIMEOUT, !is_visibly_local(&url))?;
    check_kind(&resp, kind)?;
    check_length(&resp, MAX_ATTACHMENT_BYTES)?;
    let ext = ext_for(&url, &content_type(&resp));
    copy_limited(resp.into_body().into_reader(), dir, &ext, MAX_ATTACHMENT_BYTES)
}

fn fetch_thumbnail(dir: &Path, url: &Url) -> Result<AttachmentInfo, String> {
    // redirects(0): a redirect could point at an address is_public_http_url
    // would have refused.
    // third-party HTML chose this address: never a private one, whatever the name resolves to
    let resp = http_get(url, 0, PREVIEW_TIMEOUT, true)?;
    check_kind(&resp, "image")?;
    check_length(&resp, MAX_THUMBNAIL_BYTES)?;
    let ext = ext_for(url, &content_type(&resp));
    copy_limited(resp.into_body().into_reader(), dir, &ext, MAX_THUMBNAIL_BYTES)
}

/// Fetches a page and extracts title / description / site name / thumbnail.
/// The HTML is only ever treated as text to scan for `<meta>`/`<title>` —
/// nothing in it is executed, rendered or followed except one image URL.
pub fn link_preview(dir: &Path, url: &str) -> Result<LinkPreview, String> {
    let url = parse_http_url(url)?;
    let resp = http_get(&url, 5, PREVIEW_TIMEOUT, !is_visibly_local(&url))?;
    let ct = content_type(&resp);
    if ct != "text/html" && ct != "application/xhtml+xml" {
        return Ok(LinkPreview::default());
    }
    let base = Url::parse(&resp.get_uri().to_string()).unwrap_or_else(|_| url.clone());

    let mut buf = Vec::new();
    resp.into_body().into_reader().take(MAX_HTML_BYTES).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    // Known limit: assumes UTF-8; a page in another charset gets mangled
    // accents in its title. Sniff <meta charset> + encoding_rs if it matters.
    let meta = parse_meta(&String::from_utf8_lossy(&buf));

    let image = meta
        .image
        .and_then(|src| base.join(&src).ok())
        .filter(is_public_http_url)
        .and_then(|u| fetch_thumbnail(dir, &u).ok())
        .map(|info| info.file);

    Ok(LinkPreview {
        title: meta.title,
        description: meta.description,
        site_name: meta.site_name,
        image,
    })
}

// ------------------------------------------------------------ html meta

#[derive(Default, Debug, PartialEq)]
struct Meta {
    title: Option<String>,
    description: Option<String>,
    site_name: Option<String>,
    image: Option<String>,
}

fn decode_entity(name: &str) -> Option<char> {
    match name {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        "nbsp" => Some(' '),
        _ => {
            let n = name.strip_prefix('#')?;
            let code = match n.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => n.parse().ok()?,
            };
            char::from_u32(code)
        }
    }
}

fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(p) = rest.find('&') {
        out.push_str(&rest[..p]);
        rest = &rest[p..];
        let decoded = rest.find(';').filter(|&end| end <= 10).and_then(|end| decode_entity(&rest[1..end]).map(|c| (c, end)));
        match decoded {
            Some((c, end)) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Collapses whitespace and caps the length; empty -> None.
fn clean(s: &str, max_chars: usize) -> Option<String> {
    let collapsed = decode_entities(s).split_whitespace().collect::<Vec<_>>().join(" ");
    let truncated: String = collapsed.chars().take(max_chars).collect();
    if truncated.is_empty() {
        None
    } else {
        Some(truncated)
    }
}

/// Parses attributes of one tag, starting just after the tag name; returns
/// them plus how many bytes were consumed (through the closing `>`).
fn parse_tag_attrs(s: &str) -> (Vec<(String, String)>, usize) {
    let b = s.as_bytes();
    let mut i = 0;
    let mut out = Vec::new();
    loop {
        while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b'/') {
            i += 1;
        }
        if i >= b.len() {
            return (out, i);
        }
        if b[i] == b'>' {
            return (out, i + 1);
        }
        let name_start = i;
        while i < b.len() && !b[i].is_ascii_whitespace() && !matches!(b[i], b'=' | b'>' | b'/') {
            i += 1;
        }
        let name = s[name_start..i].to_ascii_lowercase();
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        let mut value = String::new();
        if i < b.len() && b[i] == b'=' {
            i += 1;
            while i < b.len() && b[i].is_ascii_whitespace() {
                i += 1;
            }
            if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
                let quote = b[i];
                i += 1;
                let start = i;
                while i < b.len() && b[i] != quote {
                    i += 1;
                }
                value = s[start..i].to_string();
                if i < b.len() {
                    i += 1;
                }
            } else {
                let start = i;
                while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'>' {
                    i += 1;
                }
                value = s[start..i].to_string();
            }
        }
        if !name.is_empty() {
            out.push((name, value));
        }
    }
}

fn parse_meta(html: &str) -> Meta {
    // to_ascii_lowercase keeps byte offsets identical, so indices found in
    // `lower` are valid in `html`.
    let lower = html.to_ascii_lowercase();
    let end = lower.find("</head>").unwrap_or(lower.len());
    let (html, lower) = (&html[..end], &lower[..end]);

    let mut og_title = None;
    let mut tw_title = None;
    let mut description = None;
    let mut og_description = None;
    let mut site_name = None;
    let mut og_image = None;
    let mut tw_image = None;

    let mut i = 0;
    while let Some(rel) = lower[i..].find("<meta") {
        let start = i + rel + "<meta".len();
        let (attrs, consumed) = parse_tag_attrs(&html[start..]);
        i = start + consumed;
        // "<metadata>" etc. share the prefix but aren't meta tags.
        if !html[start..].starts_with(|c: char| c.is_ascii_whitespace() || c == '/') {
            continue;
        }
        let get = |k: &str| attrs.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
        let (Some(key), Some(content)) = (get("property").or(get("name")), get("content")) else {
            continue;
        };
        let slot = match key.to_ascii_lowercase().as_str() {
            "og:title" => &mut og_title,
            "twitter:title" => &mut tw_title,
            "description" => &mut description,
            "og:description" => &mut og_description,
            "og:site_name" => &mut site_name,
            "og:image" | "og:image:url" => &mut og_image,
            "twitter:image" => &mut tw_image,
            _ => continue,
        };
        slot.get_or_insert_with(|| content.to_string());
    }

    let doc_title = lower.find("<title").and_then(|t| {
        let after = t + "<title".len();
        // "<titlefoo" isn't <title>.
        if !lower[after..].starts_with(|c: char| c == '>' || c.is_ascii_whitespace()) {
            return None;
        }
        let open_end = after + lower[after..].find('>')? + 1;
        let close = open_end + lower[open_end..].find("</title")?;
        Some(html[open_end..close].to_string())
    });

    Meta {
        title: og_title.or(tw_title).or(doc_title).and_then(|t| clean(&t, 200)),
        description: og_description.or(description).and_then(|d| clean(&d, 300)),
        site_name: site_name.and_then(|s| clean(&s, 100)),
        image: og_image.or(tw_image).map(|s| s.trim().to_string()).filter(|s| !s.is_empty() && s.len() <= MAX_URL_LEN),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const UUID: &str = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

    #[test]
    fn attachment_names() {
        assert!(valid_attachment_name(&format!("{UUID}.png")));
        assert!(valid_attachment_name(&format!("{UUID}.bin")));
        for bad in [
            "../secret.png".to_string(),
            "a.png".to_string(),
            UUID.to_string(),
            format!("{UUID}.PNG"),
            format!("{UUID}.toolongext"),
            format!("{}.png", UUID.to_uppercase()),
            format!("..\\{UUID}.png"),
            format!("{UUID}.png/../x"),
            format!("{UUID}."),
        ] {
            assert!(!valid_attachment_name(&bad), "should reject {bad}");
        }
        assert_eq!(sanitize_ext(".Tar.GZ"), "targz");
        assert_eq!(sanitize_ext("../../x"), "x");
        assert_eq!(sanitize_ext("é"), "bin");
    }

    #[test]
    fn refs_validation() {
        let ok = serde_json::json!({"type":"doc","content":[
            {"type":"image","attrs":{"file":format!("{UUID}.png"),"name":"año nuevo.png"}},
            {"type":"image","attrs":{"file":null}},
            {"type":"webBookmark","attrs":{"url":"https://example.com/a?b=1","image":null}}
        ]});
        assert!(validate_refs(&ok).is_ok());
        for bad in [
            serde_json::json!({"type":"image","attrs":{"file":"../../etc/passwd"}}),
            serde_json::json!({"type":"fileBlock","attrs":{"file":42}}),
            serde_json::json!({"type":"doc","content":[{"type":"video","attrs":{"file":"C:\\x.mp4"}}]}),
            serde_json::json!({"type":"webBookmark","attrs":{"url":"javascript:alert(1)"}}),
            serde_json::json!({"type":"webBookmark","attrs":{"url":"https://a.com","image":"x.png"}}),
        ] {
            assert!(validate_refs(&bad).is_err(), "should reject {bad}");
        }
    }

    #[test]
    fn public_urls() {
        let p = |s: &str| is_public_http_url(&Url::parse(s).unwrap());
        assert!(p("https://example.com/a.png"));
        assert!(p("http://8.8.8.8/x"));
        for bad in [
            "http://localhost/x",
            "http://foo.localhost/x",
            "http://127.0.0.1/x",
            "http://2130706433/x",
            "http://10.0.0.5/x",
            "http://192.168.1.1/x",
            "http://169.254.169.254/x",
            "http://100.64.0.1/x",
            "http://[::1]/x",
            "http://[fd00::1]/x",
            "http://[::ffff:127.0.0.1]/x",
            "http://printer.local/x",
            "ftp://example.com/x",
        ] {
            assert!(!p(bad), "should refuse {bad}");
        }
    }

    #[test]
    fn meta_parsing() {
        let html = r#"<!doctype html><html><head>
            <title>  Fallback
              title </title>
            <metadata foo="x">
            <META PROPERTY="og:title" content='Título &amp; más &#233; &#x41;'>
            <meta name="description" content="plain desc">
            <meta property="og:description" content="OG &quot;desc&quot;">
            <meta property=og:image content=/img/a.png>
            <meta property="og:site_name" content="Sitio">
            <meta content="<script>alert(1)</script>" name="twitter:title">
            </head><body><meta property="og:title" content="body, ignored"></body>"#;
        assert_eq!(
            parse_meta(html),
            Meta {
                title: Some("Título & más é A".into()),
                description: Some("OG \"desc\"".into()),
                site_name: Some("Sitio".into()),
                image: Some("/img/a.png".into()),
            }
        );
        let only_title = parse_meta("<head><title>Solo\ttítulo</title></head>");
        assert_eq!(only_title.title.as_deref(), Some("Solo título"));
        assert_eq!(parse_meta("<head><meta name='x"), Meta::default());
        assert_eq!(parse_meta(""), Meta::default());
        assert_eq!(clean(&"é".repeat(500), 200).unwrap().chars().count(), 200);
    }

    #[test]
    fn storage_limits_and_orphans() {
        let dir = std::env::temp_dir().join(format!("albaro-test-{}", Uuid::new_v4()));
        let info = store_bytes(&dir, b"hola", "TXT").unwrap();
        assert!(valid_attachment_name(&info.file) && info.file.ends_with(".txt") && info.size == 4);
        assert_eq!(fs::read(dir.join(&info.file)).unwrap(), b"hola");

        let big = copy_limited(io::repeat(0), &dir, "bin", 10);
        assert!(big.is_err());
        let leftovers: Vec<_> = fs::read_dir(&dir).unwrap().flatten().collect();
        assert_eq!(leftovers.len(), 1, "failed upload must not leave a temp file behind");

        assert!(resolve(&dir, "../x.txt").is_err());
        assert!(resolve(&dir, &info.file).is_ok());

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE blocks (id TEXT, content TEXT); CREATE TABLE synced_blocks (id TEXT, content TEXT); CREATE TABLE pages (id TEXT, cover TEXT); CREATE TABLE trash (snapshot TEXT);")
            .unwrap();
        fs::write(dir.join(format!("{TMP_PREFIX}abc")), b"x").unwrap();
        let orphan = store_bytes(&dir, b"o", "png").unwrap();
        conn.execute("INSERT INTO blocks VALUES ('1', ?1)", [format!("{{\"file\":\"{}\"}}", info.file)]).unwrap();
        // referenced only from a synced block's document: must survive too
        let synced_only = store_bytes(&dir, b"s", "png").unwrap();
        conn.execute("INSERT INTO synced_blocks VALUES ('1', ?1)", [format!("{{\"file\":\"{}\"}}", synced_only.file)])
            .unwrap();
        // used only as a page's cover: must survive too
        let cover_only = store_bytes(&dir, b"c", "png").unwrap();
        conn.execute("INSERT INTO pages VALUES ('p', ?1)", [format!("image:{}", cover_only.file)]).unwrap();
        assert_eq!(sweep_orphans(&conn, &dir).unwrap(), 2);
        assert!(dir.join(&cover_only.file).exists());
        assert!(dir.join(&synced_only.file).exists());
        assert!(dir.join(&info.file).exists());
        assert!(!dir.join(&orphan.file).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_blocklist() {
        assert!(ensure_openable(&format!("{UUID}.pdf")).is_ok());
        assert!(ensure_openable(&format!("{UUID}.exe")).is_err());
        assert!(ensure_openable(&format!("{UUID}.html")).is_err());
    }

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn only_internet_addresses_are_public() {
        let public = |s: &str| ip_is_public(s.parse().unwrap());
        for ok in ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700::1111", "2001:4860:4860::8888"] {
            assert!(public(ok), "{ok}");
        }
        for private in [
            "127.0.0.1",
            "127.255.255.254",
            "10.0.0.1",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "0.1.2.3",
            "224.0.0.1",
            "240.0.0.1",
            "255.255.255.255",
            "198.18.0.1",
            "192.0.2.1",
            "::1",
            "::",
            "fe80::1",
            "fc00::1",
            "fd12:3456::1",
            "ff02::1",
            // IPv6 forms that carry an IPv4 address
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "64:ff9b::7f00:1",
            "64:ff9b::a00:1",
            "2002:7f00:1::",
            "2002:c0a8:101::",
        ] {
            assert!(!public(private), "{private}");
        }
    }

    #[test]
    fn a_typed_address_reaches_the_private_network_only_when_it_looks_local() {
        for local in [
            "http://localhost:11434/",
            "http://LOCALHOST/",
            "http://localhost./",
            "http://nas/",
            "http://nas.local/x",
            "http://printer.lan/",
            "http://192.168.1.5/",
            "http://10.0.0.2:8080/",
            "http://127.0.0.1/",
            "http://[::1]/",
            "http://[fe80::1]/",
            // the URL parser turns these spellings into the loopback address
            "http://2130706433/",
            "http://0x7f.1/",
            "http://0177.0.0.1/",
        ] {
            assert!(is_visibly_local(&url(local)), "{local}");
        }
        for other in [
            "http://example.com/",
            "https://api.github.com/x",
            "http://8.8.8.8/",
            "http://[2606:4700::1111]/",
            // public-looking names that resolve to this machine: no
            "http://localtest.me/",
            "http://127.0.0.1.nip.io/",
            "http://localhost.evil.test/",
            "http://evil.test/localhost",
        ] {
            assert!(!is_visibly_local(&url(other)), "{other}");
        }
        // the literal-host check used on third-party thumbnail URLs
        for refused in [
            "http://localhost/a.png",
            "http://127.0.0.1/a.png",
            "http://[::1]/a.png",
            "http://nas/a.png",
            "ftp://example.com/a.png",
            "file:///etc/passwd",
        ] {
            assert!(!is_public_http_url(&url(refused)), "{refused}");
        }
        assert!(is_public_http_url(&url("https://example.com/a.png")));
    }

    /// A real listener on this machine and a request that must not reach it. `localhost` is the
    /// stand-in for a public-looking name that resolves to a private address (`localtest.me`): the
    /// name check alone passes it, the resolver does not.
    #[test]
    fn the_resolver_refuses_private_addresses_when_connecting() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();

        for host in ["localhost", "127.0.0.1"] {
            let target = url(&format!("http://{host}:{port}/"));
            assert!(http_get(&target, 0, Duration::from_secs(3), true).is_err(), "{host} was reached");
            assert!(listener.accept().is_err(), "a connection to {host} got through the public-only resolver");
        }

        // the same address is fine when the caller says the user meant it
        listener.set_nonblocking(false).unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            // read the request first: closing with it unread makes Windows reset the connection
            let _ = stream.read(&mut [0u8; 1024]);
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nhi");
        });
        let response = http_get(&url(&format!("http://127.0.0.1:{port}/")), 0, Duration::from_secs(3), false).unwrap();
        assert_eq!(response.status().as_u16(), 200);
        server.join().unwrap();
    }

    #[test]
    fn programs_scripts_and_launchers_are_never_opened() {
        for ext in [
            "exe", "msi", "bat", "cmd", "ps1", "vbs", "js", "hta", "lnk", "url", "reg", "jar", "dll", "scf", "chm", "docm", "xlsm", "pptm", "html", "svg", "sh", "desktop",
            "command", "app", "pkg", "py",
        ] {
            assert!(ensure_openable(&format!("11111111-2222-4333-8444-555555555555.{ext}")).is_err(), "{ext}");
        }
        for ext in ["png", "jpg", "pdf", "txt", "docx", "xlsx", "zip", "mp4", "mp3", "bin"] {
            assert!(ensure_openable(&format!("11111111-2222-4333-8444-555555555555.{ext}")).is_ok(), "{ext}");
        }
    }
}
