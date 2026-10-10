// Settings are stored as JSON in <picturama_home_dir>/settings.json.
// Legacy format (pre-2019-08-18) with `directories.photos` is also handled for backwards compatibility.

use std::path::Path;

use crate::types::common_types::Settings;

pub fn fetch_settings(settings_path: &Path) -> Result<Settings, String> {
    if !settings_path.exists() {
        return Ok(Settings { photo_dirs: vec![], export_options: None });
    }

    let raw = std::fs::read_to_string(settings_path).map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    // Current format: { photoDirs: [...] }
    if let Some(photo_dirs) = json.get("photoDirs").and_then(|v| v.as_array()) {
        let dirs: Vec<String> = photo_dirs
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .map(|d| normalise_path(&d))
            .collect();
        return Ok(Settings { photo_dirs: dirs, export_options: None });
    }

    // Legacy format (before 2019-08-18): { directories: { photos: "..." } }
    if let Some(photos_dir) = json
        .get("directories")
        .and_then(|d| d.get("photos"))
        .and_then(|p| p.as_str())
    {
        return Ok(Settings {
            photo_dirs:     vec![normalise_path(photos_dir)],
            export_options: None,
        });
    }

    // Unrecognised format → return empty settings
    Ok(Settings { photo_dirs: vec![], export_options: None })
}

pub fn store_settings(settings_path: &Path, settings: &Settings) -> Result<(), String> {
    // Normalise on write too, so a settings file handed in from the web view cannot reintroduce the
    // backslash form that older settings files (and thereby older DB rows) were written with.
    let normalised = Settings {
        photo_dirs: settings.photo_dirs.iter().map(|d| normalise_path(d)).collect(),
        export_options: settings.export_options.clone(),
    };

    if let Some(parent) = settings_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let json = serde_json::to_string_pretty(&normalised).map_err(|e| e.to_string())?;
    std::fs::write(settings_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

/// Replaces `\` with `/` and drops trailing separators, so the same directory always compares and
/// persists the same way. The import scanner joins paths with '/', and photos.master_dir is
/// normalised to that form too (migration 004) — settings must match.
fn normalise_path(path: &str) -> String {
    let trimmed = path.trim_end_matches(['/', '\\']);
    if trimmed.contains('\\') {
        trimmed.replace('\\', "/")
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {

    use super::*;

    fn write_settings(dir: &Path, json: &str) -> std::path::PathBuf {
        let path = dir.join("settings.json");
        std::fs::write(&path, json).unwrap();
        path
    }

    /// A fresh temp dir per call: tests run in parallel threads and must not share a settings file.
    fn test_dir(tag: &str) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir()
            .join(format!("picturama-settings-{}-{}", tag, n));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn fetches_settings_with_normalised_photo_dirs() {
        let dir = test_dir("fetch");
        // The JSON text needs `\\\\` per backslash, so this decodes to the single-backslash
        // Windows form `D:\photos\2025` — what a real settings file holds.
        let path = write_settings(&dir, r#"{ "photoDirs": ["D:\\photos\\2025", "E:/archive/"] }"#);

        let settings = fetch_settings(&path).unwrap();
        assert_eq!(settings.photo_dirs, vec!["D:/photos/2025", "E:/archive"]);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn stores_settings_with_normalised_photo_dirs() {
        let dir = test_dir("store");
        let path = dir.join("settings.json");

        store_settings(&path, &Settings {
            photo_dirs: vec!["D:\\photos\\2025".to_string()],
            export_options: None,
        }).unwrap();

        let settings = fetch_settings(&path).unwrap();
        assert_eq!(settings.photo_dirs, vec!["D:/photos/2025"]);

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
