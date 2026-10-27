//! what the map view needs from the network. The app is offline
//! first, so the frontend never contacts anything itself (the CSP only allows
//! IPC and the asset protocol): Rust fetches map tiles from a fixed host,
//! caches them under `attachments/map-tiles/` — covered by the asset
//! protocol's scope and ignored by the orphan sweep — and the map then works
//! offline for every area already viewed. Place search goes through Rust too.

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::Duration;

const TILE_HOST: &str = "https://tile.openstreetmap.org";
const GEOCODE_URL: &str = "https://nominatim.openstreetmap.org/search";
const MAX_ZOOM: u32 = 19;
const MAX_TILE_BYTES: u64 = 512 * 1024;
const MAX_GEOCODE_BYTES: u64 = 256 * 1024;
const MAX_QUERY_CHARS: usize = 200;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const TIMEOUT: Duration = Duration::from_secs(10);
/// OSM's usage policy asks for an identifying user agent.
const USER_AGENT: &str = "AlbaRoNotes/0.1 (desktop notes app)";

#[derive(Serialize, Debug, PartialEq)]
pub struct GeocodeResult {
    pub name: String,
    pub lat: f64,
    pub lng: f64,
}

/// `z/x/y` of a real tile: zoom in range and x, y inside the 2^z grid.
pub fn valid_tile(z: u32, x: u32, y: u32) -> bool {
    z <= MAX_ZOOM && x < (1 << z) && y < (1 << z)
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(CONNECT_TIMEOUT))
        .timeout_global(Some(TIMEOUT))
        .user_agent(USER_AGENT)
        .build()
        .into()
}

fn read_limited(resp: ureq::http::Response<ureq::Body>, max: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    resp.into_body().into_reader().take(max + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > max {
        return Err("La respuesta es demasiado grande".to_string());
    }
    Ok(bytes)
}

fn offline<E>(_: E) -> String {
    "No se pudo conectar (sin red o tiempo de espera agotado)".to_string()
}

/// Returns the tile's path relative to the attachments folder (what the frontend
/// turns into an asset URL), downloading it first if it isn't cached.
pub fn fetch_tile(attachments: &Path, z: u32, x: u32, y: u32) -> Result<String, String> {
    if !valid_tile(z, x, y) {
        return Err("Mosaico fuera de rango".to_string());
    }
    let relative = format!("map-tiles/{z}/{x}/{y}.png");
    let path = attachments.join(&relative);
    if path.is_file() {
        return Ok(relative);
    }

    let resp = agent().get(&format!("{TILE_HOST}/{z}/{x}/{y}.png")).call().map_err(offline)?;
    if crate::attachments::content_type(&resp) != "image/png" {
        return Err("El servidor no devolvió una imagen".to_string());
    }
    let bytes = read_limited(resp, MAX_TILE_BYTES)?;
    fs::create_dir_all(path.parent().expect("a tile path always has a parent")).map_err(|e| e.to_string())?;
    // write-then-rename so a half-written tile is never mistaken for a cached one
    let tmp = path.with_extension("png.part");
    fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(relative)
}

/// Turns Nominatim's JSON array into results, dropping anything malformed.
pub fn parse_geocode(body: &str) -> Vec<GeocodeResult> {
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(body) else { return vec![] };
    items
        .iter()
        .filter_map(|item| {
            let name = item.get("display_name")?.as_str()?.trim().to_string();
            // Nominatim sends coordinates as strings
            let lat: f64 = item.get("lat")?.as_str()?.parse().ok()?;
            let lng: f64 = item.get("lon")?.as_str()?.parse().ok()?;
            ((-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lng) && !name.is_empty()).then_some(GeocodeResult { name, lat, lng })
        })
        .collect()
}

/// Looks a place up by name. Only ever called from an explicit «Buscar» click
/// (Nominatim's policy: no autocomplete, at most one request a second).
pub fn geocode(query: &str) -> Result<Vec<GeocodeResult>, String> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > MAX_QUERY_CHARS {
        return Err(format!("La búsqueda debe tener entre 1 y {MAX_QUERY_CHARS} caracteres"));
    }
    let mut url = url::Url::parse(GEOCODE_URL).expect("a constant URL");
    url.query_pairs_mut()
        .append_pair("format", "jsonv2")
        .append_pair("limit", "5")
        .append_pair("accept-language", "es")
        .append_pair("q", query);
    let resp = agent().get(url.as_str()).call().map_err(offline)?;
    let bytes = read_limited(resp, MAX_GEOCODE_BYTES)?;
    Ok(parse_geocode(&String::from_utf8_lossy(&bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_real_tiles_are_requested() {
        assert!(valid_tile(0, 0, 0));
        assert!(valid_tile(2, 3, 3));
        assert!(valid_tile(MAX_ZOOM, (1 << MAX_ZOOM) - 1, 0));
        assert!(!valid_tile(2, 4, 0)); // x outside the 2^z grid
        assert!(!valid_tile(2, 0, 4));
        assert!(!valid_tile(MAX_ZOOM + 1, 0, 0));
        assert!(!valid_tile(40, 0, 0)); // would overflow a shift
    }

    #[test]
    fn a_cached_tile_needs_no_network_and_a_bad_one_is_refused_before_it() {
        let dir = std::env::temp_dir().join(format!("albaro-tiles-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("map-tiles/3/2")).unwrap();
        std::fs::write(dir.join("map-tiles/3/2/5.png"), b"png").unwrap();
        assert_eq!(fetch_tile(&dir, 3, 2, 5).unwrap(), "map-tiles/3/2/5.png");
        assert!(fetch_tile(&dir, 3, 9, 5).is_err()); // out of range: refused, no request, nothing written
        assert!(!dir.join("map-tiles/3/9").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn geocode_results_are_parsed_defensively() {
        let body = r#"[
            {"display_name": "Madrid, España", "lat": "40.4167", "lon": "-3.7033"},
            {"display_name": "Sin coordenadas"},
            {"display_name": "Fuera de rango", "lat": "95", "lon": "0"},
            {"display_name": "Texto", "lat": "norte", "lon": "0"},
            {"display_name": "  ", "lat": "1", "lon": "1"}
        ]"#;
        assert_eq!(
            parse_geocode(body),
            vec![GeocodeResult {
                name: "Madrid, España".into(),
                lat: 40.4167,
                lng: -3.7033
            }]
        );
        assert!(parse_geocode("not json").is_empty());
        assert!(parse_geocode(r#"{"error": "x"}"#).is_empty());
        assert!(geocode("   ").is_err());
        assert!(geocode(&"x".repeat(201)).is_err());
    }
}
