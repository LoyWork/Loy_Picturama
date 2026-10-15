// Edited photos have an individual `<original filename>.picturama.yml` sidecar beside the original.
// Unedited photos create no sidecar. Directory-level `picturama.yml` remains a legacy read fallback.
// The legacy `ansel.json` format (Picturama v1.0.0 and earlier, when the app was named Ansel) is read but not written.
// Photos with no `picturama.yml` entry fall back to imported Picasa metadata (see `picasa_reader`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde_yaml;

use crate::store::picasa_reader::{self, PicasaData};
use crate::types::common_types::{Photo, PhotoWork};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
struct DirectoryWorkData {
    #[serde(default)]
    photos: HashMap<String, PhotoWork>,
}

/// All work data cached for one directory: the Picturama sidecar data (`picturama.yml` / `ansel.json`) plus
/// the read-only Picasa fallback (`.picasa.ini` / `Picasa.ini`), if any.
struct DirectoryData {
    picturama_data: DirectoryWorkData,
    picasa_data: Option<PicasaData>,
}

struct DirectoryCache {
    data: HashMap<PathBuf, DirectoryData>,
}

static CACHE: Lazy<Mutex<DirectoryCache>> = Lazy::new(|| {
    Mutex::new(DirectoryCache { data: HashMap::new() })
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

pub fn fetch_photo_work_of_photo(photo: &Photo) -> Result<PhotoWork, String> {
    fetch_photo_work(Path::new(&photo.master_dir), &photo.master_filename,
        photo.master_width, photo.master_height)
}

pub fn fetch_photo_work(photo_dir: &Path, filename: &str, master_width: u32, master_height: u32)
    -> Result<PhotoWork, String>
{
    let mut cache = CACHE.lock().unwrap();
    let sidecar = photo_sidecar_path(photo_dir, filename)?;
    if sidecar.exists() {
        let contents = std::fs::read_to_string(&sidecar).map_err(|e| e.to_string())?;
        return serde_yaml::from_str(&contents)
            .map_err(|e| format!("Failed to parse {:?}: {}", sidecar, e));
    }
    if !cache.data.contains_key(photo_dir) {
        let data = read_directory_data(photo_dir)?;
        cache.data.insert(photo_dir.to_path_buf(), data);
    }

    let data = cache.data.get(photo_dir).unwrap();

    // A `picturama.yml` entry always wins; only if absent do we convert imported Picasa rules.
    if let Some(photo_work) = data.picturama_data.photos.get(filename) {
        return Ok(photo_work.clone());
    }
    if let Some(picasa_data) = &data.picasa_data {
        if let Some(rules) = picasa_data.photos.get(filename) {
            return Ok(picasa_reader::create_photo_work_from_picasa_rules(
                rules, photo_dir, filename, master_width, master_height));
        }
    }
    Ok(PhotoWork::default())
}

pub fn store_photo_work(photo_dir: &Path, filename: &str, photo_work: &PhotoWork) -> Result<(), String> {
    let sidecar = photo_sidecar_path(photo_dir, filename)?;
    let mut cache = CACHE.lock().unwrap();

    // Load any existing sidecar data first, so a store before the first fetch doesn't clobber it.
    if !cache.data.contains_key(photo_dir) {
        let data = read_directory_data(photo_dir)?;
        cache.data.insert(photo_dir.to_path_buf(), data);
    }
    let data = cache.data.get_mut(photo_dir).unwrap();

    let mut work = photo_work.clone();
    if work.rotation_turns.unwrap_or(0) % 4 == 0 { work.rotation_turns = None; }
    if work.tilt.unwrap_or(0.0) == 0.0 { work.tilt = None; }
    if work.color_grading.as_ref().map_or(true, |g| [g.shadows, g.midtones, g.highlights, g.global]
        .iter().all(|w| w.map_or(true, |w| w.sat.unwrap_or(0.0) == 0.0 && w.lum.unwrap_or(0.0) == 0.0))) {
        work.color_grading = None;
    }
    if work.develop.as_ref().map_or(true, |d| neutral_develop(d, "")) { work.develop = None; }
    let has_adjustments = work.rotation_turns.is_some() || work.tilt.is_some() || work.crop_rect.is_some() ||
        work.color_grading.is_some() || work.develop.is_some();

    if has_adjustments {
        let mut value = serde_json::to_value(&work).map_err(|e| e.to_string())?;
        if let Some(object) = value.as_object_mut() { object.retain(|_, v| !v.is_null()); }
        let yml = serde_yaml::to_string(&value).map_err(|e| e.to_string())?;
        write_atomic(&sidecar, &format!("# Picturama photo adjustments. The original image is unchanged.\n{}", yml))?;
    } else {
        match std::fs::remove_file(&sidecar) {
            Ok(()) => {},
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
            Err(e) => return Err(e.to_string()),
        }
    }

    // Migrate just this image's legacy entry. Other photos in the directory are untouched.
    let mut legacy = read_picturama_data(photo_dir)?;
    if legacy.photos.remove(filename).is_some() { persist_directory_data(photo_dir, &legacy)?; }
    // Cache even an empty work as an override for legacy/Picasa rules during this session.
    data.picturama_data.photos.insert(filename.to_string(), work);
    Ok(())
}

pub fn remove_photo_work(photo_dir: &Path, filename: &str) -> Result<(), String> {
    store_photo_work(photo_dir, filename, &PhotoWork::default())
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn photo_sidecar_path(photo_dir: &Path, filename: &str) -> Result<PathBuf, String> {
    if filename.is_empty() || filename == "." || filename == ".." || filename.contains(['/', '\\']) ||
        Path::new(filename).file_name() != Some(std::ffi::OsStr::new(filename)) {
        return Err("Expected a photo filename, not a path".into());
    }
    Ok(photo_dir.join(format!("{}.picturama.yml", filename)))
}

fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let temp = path.with_extension(format!("tmp-{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed)));
    let result = std::fs::write(&temp, contents).and_then(|_| std::fs::rename(&temp, path));
    if result.is_err() { let _ = std::fs::remove_file(&temp); }
    result.map_err(|e| e.to_string())
}

// Keep explicit neutral values from creating a file (e.g. exposure=0, white balance=6500).
fn neutral_develop(value: &serde_json::Value, path: &str) -> bool {
    use serde_json::Value;
    match value {
        Value::Null => true,
        Value::Object(values) => values.iter().all(|(key, v)| {
            let child = if path.is_empty() { key.clone() } else { format!("{}.{}", path, key) };
            if path == "grading" && ["blending", "balance"].contains(&key.as_str()) { return true; }
            if path.starts_with("grading.") && key == "hue" { return true; }
            neutral_develop(v, &child)
        }),
        Value::Number(number) => {
            let default = match path {
                "wb.temp" => 6500.0,
                "vignette.midpoint" | "vignette.feather" | "grain.roughness" | "detail.nrDetail" |
                "detail.nrColorDetail" | "detail.nrColorSmoothness" => 50.0,
                "grain.size" | "detail.sharpenDetail" => 25.0,
                "detail.sharpenRadius" => 1.0,
                _ => 0.0,
            };
            number.as_f64() == Some(default)
        },
        Value::String(text) => text.is_empty() || (path == "treatment" && text == "color"),
        _ => false,
    }
}

fn read_directory_data(photo_dir: &Path) -> Result<DirectoryData, String> {
    let picturama_data = read_picturama_data(photo_dir)?;
    // Picasa data is a read-only fallback used only for photos without a Picturama sidecar entry.
    let picasa_data = picasa_reader::read_picasa_ini(photo_dir);
    Ok(DirectoryData { picturama_data, picasa_data })
}

fn read_picturama_data(photo_dir: &Path) -> Result<DirectoryWorkData, String> {
    // 1. Try picturama.yml (current format)
    let yml_path = photo_dir.join("picturama.yml");
    if yml_path.exists() {
        let contents = std::fs::read_to_string(&yml_path).map_err(|e| e.to_string())?;
        let data: DirectoryWorkData = serde_yaml::from_str(&contents)
            .map_err(|e| format!("Failed to parse {:?}: {}", yml_path, e))?;
        log::debug!("Loaded {:?}", yml_path);
        return Ok(data);
    }

    // 2. Try ansel.json (legacy format from v1.0.0 and earlier)
    let ansel_path = photo_dir.join("ansel.json");
    if ansel_path.exists() {
        let contents = std::fs::read_to_string(&ansel_path).map_err(|e| e.to_string())?;
        let data: DirectoryWorkData = serde_json::from_str(&contents)
            .map_err(|e| format!("Failed to parse {:?}: {}", ansel_path, e))?;
        log::debug!("Loaded {:?}", ansel_path);
        return Ok(data);
    }

    Ok(DirectoryWorkData::default())
}

fn persist_directory_data(photo_dir: &Path, data: &DirectoryWorkData) -> Result<(), String> {
    let yml_path = photo_dir.join("picturama.yml");
    let ansel_path = photo_dir.join("ansel.json");

    if data.photos.is_empty() {
        // Remove the file if it exists
        if yml_path.exists() {
            std::fs::remove_file(&yml_path).map_err(|e| e.to_string())?;
            log::debug!("Removed empty {:?}", yml_path);
        }
        // Also clean up legacy ansel.json if present
        if ansel_path.exists() {
            std::fs::remove_file(&ansel_path).map_err(|e| e.to_string())?;
        }
    } else {
        let header = "# This file contains the changes applied to photos in this directory using Picturama.\n\
                      # See: https://picturama.github.io/\n\n";
        let yml = serde_yaml::to_string(data)
            .map_err(|e| format!("Failed to serialise YAML: {}", e))?;
        std::fs::write(&yml_path, format!("{}{}", header, yml))
            .map_err(|e| e.to_string())?;
        log::debug!("Stored {:?}", yml_path);
        // Clean up legacy file if it still exists
        if ansel_path.exists() {
            let _ = std::fs::remove_file(&ansel_path);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!("picturama-sidecar-{}-{}-{}",
                std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
                COUNTER.fetch_add(1, Ordering::Relaxed)));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn forget_cache(&self) { CACHE.lock().unwrap().data.remove(&self.0); }
    }
    impl Drop for TestDir {
        fn drop(&mut self) { self.forget_cache(); let _ = std::fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn photo_work_browsing_or_saving_neutral_values_creates_no_sidecar() {
        let dir = TestDir::new();
        fetch_photo_work(&dir.0, "original.jpg", 100, 100).unwrap();
        let work: PhotoWork = serde_json::from_value(json!({
            "rotationTurns": 0, "tilt": 0, "flagged": true, "tags": ["test"],
            "colorGrading": {"shadows": {"hue": 90, "sat": 0, "lum": 0}},
            "develop": {"light": {"exposure": 0}, "wb": {"temp": 6500, "tint": 0},
                "grain": {"amount": 0, "size": 25, "roughness": 50}}
        })).unwrap();
        store_photo_work(&dir.0, "original.jpg", &work).unwrap();
        assert_eq!(std::fs::read_dir(&dir.0).unwrap().count(), 0);
    }

    #[test]
    fn photo_work_develop_round_trips_from_ipc_through_disk_after_cache_clear() {
        let dir = TestDir::new();
        std::fs::write(dir.0.join("original.jpg"), b"original image bytes").unwrap();
        let work: PhotoWork = serde_json::from_value(json!({"develop": {
            "light": {"exposure": 1.25, "contrast": 14}, "wb": {"temp": 5400, "tint": 8},
            "mixer": {"red": {"hue": 12}}, "detail": {"sharpenAmount": 30}
        }})).unwrap();
        store_photo_work(&dir.0, "original.jpg", &work).unwrap();
        let sidecar = dir.0.join("original.jpg.picturama.yml");
        assert!(sidecar.is_file());
        assert!(!dir.0.join("picturama.yml").exists());
        dir.forget_cache();
        let loaded = fetch_photo_work(&dir.0, "original.jpg", 100, 100).unwrap();
        assert_eq!(loaded.develop, work.develop);
        assert_eq!(std::fs::read(dir.0.join("original.jpg")).unwrap(), b"original image bytes");
        // Replacing an existing sidecar also works (including on Windows).
        store_photo_work(&dir.0, "original.jpg", &work).unwrap();
    }

    #[test]
    fn photo_work_reset_removes_only_the_selected_images_sidecar() {
        let dir = TestDir::new();
        let work: PhotoWork = serde_json::from_value(json!({"develop": {"light": {"exposure": 1}}})).unwrap();
        store_photo_work(&dir.0, "same.jpg", &work).unwrap();
        store_photo_work(&dir.0, "same.png", &work).unwrap();
        store_photo_work(&dir.0, "same.jpg", &PhotoWork::default()).unwrap();
        assert!(!dir.0.join("same.jpg.picturama.yml").exists());
        assert!(dir.0.join("same.png.picturama.yml").exists());
        dir.forget_cache();
        assert!(fetch_photo_work(&dir.0, "same.jpg", 100, 100).unwrap().develop.is_none());
    }

    #[test]
    fn photo_work_migrates_one_legacy_entry_and_preserves_other_photos() {
        let dir = TestDir::new();
        std::fs::write(dir.0.join("picturama.yml"), "photos:\n  first.jpg:\n    rotationTurns: 1\n  other.jpg:\n    rotationTurns: 2\n").unwrap();
        let mut work = fetch_photo_work(&dir.0, "first.jpg", 100, 100).unwrap();
        assert_eq!(work.rotation_turns, Some(1));
        work.develop = Some(json!({"light": {"exposure": 0.5}}));
        store_photo_work(&dir.0, "first.jpg", &work).unwrap();
        dir.forget_cache();
        assert_eq!(fetch_photo_work(&dir.0, "first.jpg", 100, 100).unwrap().develop, work.develop);
        assert_eq!(fetch_photo_work(&dir.0, "other.jpg", 100, 100).unwrap().rotation_turns, Some(2));
        assert!(!read_picturama_data(&dir.0).unwrap().photos.contains_key("first.jpg"));
        store_photo_work(&dir.0, "first.jpg", &PhotoWork::default()).unwrap();
        dir.forget_cache();
        assert!(fetch_photo_work(&dir.0, "first.jpg", 100, 100).unwrap().rotation_turns.is_none());
    }

    #[test]
    fn photo_work_rejects_filenames_that_escape_the_photo_directory() {
        let dir = TestDir::new();
        for filename in ["../outside.jpg", "..\\outside.jpg", "/outside.jpg", "", ".", ".."] {
            assert!(store_photo_work(&dir.0, filename, &PhotoWork::default()).is_err());
        }
    }
}
