// Photo query commands.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;
use tauri::State;

use crate::app_config_builder::AppConfig;
use crate::store::db::DbHandle;
use crate::store::{photo_store, photo_work_store, settings_store, tag_store, thumbnail_store};
use crate::types::common_types::{
    DuplicatePhotoGroup, EmptyTrashResult, PhotoDetail, PhotoFilter, PhotoFolder, PhotoId,
    PhotoSection, PhotoSectionId, PhotoSet,
};

#[tauri::command]
pub async fn fetch_total_photo_count(db: State<'_, DbHandle>) -> Result<u32, String> {
    tokio::task::block_in_place(|| photo_store::fetch_total_photo_count(&db))
}

/// Finds byte-for-byte identical master files in the imported library. File size is used as a cheap
/// first pass, so the contents of uniquely-sized photos are never read. Hashing is kept off the async
/// runtime worker and streams each candidate instead of loading large RAW/HEIF files into memory.
#[tauri::command]
pub async fn scan_duplicate_photos(
    db: State<'_, DbHandle>,
) -> Result<Vec<DuplicatePhotoGroup>, String> {
    let paths = tokio::task::block_in_place(|| photo_store::fetch_active_photo_paths(&db))?;
    Ok(tokio::task::block_in_place(|| find_duplicate_photos(paths)))
}

fn find_duplicate_photos(paths: Vec<String>) -> Vec<DuplicatePhotoGroup> {
    let mut paths_by_size: HashMap<u64, Vec<String>> = HashMap::new();
    let mut seen_paths: HashSet<String> = HashSet::new();

    for path in paths {
        if !seen_paths.insert(path.clone()) {
            continue;
        }
        match std::fs::metadata(&path) {
            Ok(metadata) if metadata.is_file() => {
                paths_by_size.entry(metadata.len()).or_default().push(path)
            }
            Ok(_) => log::warn!("Duplicate scan skipped a non-file path: {}", path),
            Err(e) => log::warn!("Duplicate scan could not read metadata for {}: {}", path, e),
        }
    }

    let mut groups: Vec<DuplicatePhotoGroup> = Vec::new();
    for (file_size, candidates) in paths_by_size {
        if candidates.len() < 2 {
            continue;
        }
        let mut paths_by_hash: HashMap<[u8; 32], Vec<String>> = HashMap::new();
        for path in candidates {
            match sha256_file(Path::new(&path)) {
                Ok(hash) => paths_by_hash.entry(hash).or_default().push(path),
                Err(e) => log::warn!("Duplicate scan could not hash {}: {}", path, e),
            }
        }
        for mut duplicate_paths in paths_by_hash.into_values().filter(|paths| paths.len() > 1) {
            duplicate_paths.sort_by_key(|path| path.to_lowercase());
            groups.push(DuplicatePhotoGroup {
                file_size,
                paths: duplicate_paths,
            });
        }
    }
    groups.sort_by(|a, b| a.paths[0].to_lowercase().cmp(&b.paths[0].to_lowercase()));
    groups
}

fn sha256_file(path: &Path) -> Result<[u8; 32], String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut reader = BufReader::with_capacity(128 * 1024, file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let count = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher.finalize().into())
}

/// The filter with the configured photo roots filled in, so the store layer can resolve a folder
/// filter without the web view being able to name arbitrary directories.
fn filter_with_photo_roots(mut filter: PhotoFilter, app_config: &AppConfig) -> PhotoFilter {
    let settings_path = app_config.picturama_home_dir.join("settings.json");
    let photo_roots = settings_store::fetch_settings(&settings_path)
        .map(|s| s.photo_dirs)
        .unwrap_or_default();
    filter.photo_roots = Some(photo_roots);
    filter
}

#[tauri::command]
pub async fn fetch_photo_folders(
    app_config: State<'_, AppConfig>,
    db: State<'_, DbHandle>,
) -> Result<Vec<PhotoFolder>, String> {
    let settings_path = app_config.picturama_home_dir.join("settings.json");
    let photo_roots = settings_store::fetch_settings(&settings_path)
        .map(|s| s.photo_dirs)
        .unwrap_or_default();
    tokio::task::block_in_place(|| photo_store::fetch_photo_folders(&db, &photo_roots))
}

#[tauri::command]
pub async fn fetch_sections(
    filter: PhotoFilter,
    section_ids_to_keep_loaded: Option<Vec<PhotoSectionId>>,
    app_config: State<'_, AppConfig>,
    db: State<'_, DbHandle>,
) -> Result<Vec<PhotoSection>, String> {
    let keep = section_ids_to_keep_loaded.unwrap_or_default();
    let filter = filter_with_photo_roots(filter, &app_config);
    tokio::task::block_in_place(|| {
        photo_store::fetch_sections(
            &db,
            &filter,
            if keep.is_empty() { None } else { Some(&keep) },
        )
    })
}

#[tauri::command]
pub async fn fetch_section_photos(
    section_ids: Vec<PhotoSectionId>,
    filter: PhotoFilter,
    app_config: State<'_, AppConfig>,
    db: State<'_, DbHandle>,
) -> Result<Vec<PhotoSet>, String> {
    let filter = filter_with_photo_roots(filter, &app_config);
    tokio::task::block_in_place(|| {
        photo_store::fetch_section_photos(&db, &section_ids, &filter)
    })
}

#[tauri::command]
pub async fn update_photos(
    photo_ids: Vec<PhotoId>,
    update: serde_json::Value,
    db: State<'_, DbHandle>,
) -> Result<(), String> {
    tokio::task::block_in_place(|| photo_store::update_photos(&db, &photo_ids, &update))
}

#[tauri::command]
pub async fn empty_trash(
    app_config: State<'_, AppConfig>,
    db: State<'_, DbHandle>,
) -> Result<EmptyTrashResult, String> {
    // Fetch photos to delete
    let trashed = tokio::task::block_in_place(|| photo_store::fetch_trashed_photos(&db))?;
    let photo_ids: Vec<PhotoId> = trashed.iter().map(|p| p.id).collect();

    // Delete from DB
    tokio::task::block_in_place(|| photo_store::delete_photos(&db, &photo_ids))?;

    // Move master files to system trash
    for photo in &trashed {
        let master_path = format!("{}/{}", photo.master_dir, photo.master_filename);
        // Use trash crate (added to Cargo.toml) or fall back to std::fs::remove_file
        if let Err(e) = trash::delete(&master_path) {
            log::warn!("Could not move {} to trash: {}", master_path, e);
        }
        // Remove PhotoWork sidecar (write empty work = removes the file)
        let _ = photo_work_store::remove_photo_work(
            Path::new(&photo.master_dir),
            &photo.master_filename,
        );
        // Remove the cached thumbnail, so a re-imported photo is rendered again
        let _ = thumbnail_store::delete_thumbnail(&app_config.picturama_home_dir, photo.id);
    }

    // Re-fetch tags in case tag references changed
    let updated_tags = if !photo_ids.is_empty() {
        Some(tokio::task::block_in_place(|| tag_store::fetch_tags(&db))?)
    } else {
        None
    };

    Ok(EmptyTrashResult { photo_ids, updated_tags })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePhotosResult {
    /// The ids that were deleted (from the library).
    pub photo_ids: Vec<PhotoId>,
    /// Master paths that could not be moved to the system trash (only used by `delete_photos_from_disk`).
    pub failed: Vec<String>,
}

/// Removes photos from the library: their DB rows (and tag links) go away, the files stay on disk.
/// A later re-import brings them back.
#[tauri::command]
pub async fn delete_photos(
    app_config: State<'_, AppConfig>,
    photo_ids: Vec<PhotoId>,
    db: State<'_, DbHandle>,
) -> Result<DeletePhotosResult, String> {
    let photo_ids = tokio::task::block_in_place(|| -> Result<Vec<PhotoId>, String> {
        photo_store::delete_photos(&db, &photo_ids)?;
        for id in &photo_ids {
            let _ = thumbnail_store::delete_thumbnail(&app_config.picturama_home_dir, *id);
        }
        Ok(photo_ids)
    })?;
    Ok(DeletePhotosResult { photo_ids, failed: vec![] })
}

/// Deletes photos from disk: moves each master file to the system trash (so the user can undo it
/// there), removes the PhotoWork sidecar and the library row. The paths come from the DB rows, so
/// the web view cannot name arbitrary files — only photos that are in the library.
#[tauri::command]
pub async fn delete_photos_from_disk(
    app_config: State<'_, AppConfig>,
    photo_ids: Vec<PhotoId>,
    db: State<'_, DbHandle>,
) -> Result<DeletePhotosResult, String> {
    let (deleted_ids, failed) = tokio::task::block_in_place(|| -> Result<(Vec<PhotoId>, Vec<String>), String> {
        let photos = photo_store::fetch_photos_by_ids(&db, &photo_ids)?;
        let mut deleted_ids: Vec<PhotoId> = Vec::new();
        let mut failed: Vec<String> = Vec::new();

        for photo in &photos {
            let master_path = format!("{}/{}", photo.master_dir, photo.master_filename);
            if let Err(e) = trash::delete(&master_path) {
                // Keep the row: a photo still on disk must stay in the library.
                log::warn!("Could not move {} to trash: {}", master_path, e);
                failed.push(format!("{}: {}", master_path, e));
                continue;
            }
            let _ = photo_work_store::remove_photo_work(
                Path::new(&photo.master_dir),
                &photo.master_filename,
            );
            deleted_ids.push(photo.id);
        }

        if !deleted_ids.is_empty() {
            photo_store::delete_photos(&db, &deleted_ids)?;
        }
        for id in &deleted_ids {
            let _ = thumbnail_store::delete_thumbnail(&app_config.picturama_home_dir, *id);
        }

        Ok((deleted_ids, failed))
    })?;
    Ok(DeletePhotosResult { photo_ids: deleted_ids, failed })
}

#[tauri::command]
pub async fn fetch_photo_detail(
    photo_id: PhotoId,
    db: State<'_, DbHandle>,
) -> Result<PhotoDetail, String> {
    tokio::task::block_in_place(|| photo_store::fetch_photo_detail(&db, photo_id))
}

#[cfg(test)]
mod duplicate_tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static COUNTER: AtomicU32 = AtomicU32::new(0);
            let unique = format!(
                "picturama-duplicates-{}-{}",
                SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),
                COUNTER.fetch_add(1, Ordering::SeqCst),
            );
            let path = std::env::temp_dir().join(unique);
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn groups_identical_bytes_despite_different_names() {
        let dir = TempDir::new();
        let first = dir.0.join("original.jpg");
        let renamed = dir.0.join("renamed-copy.png");
        let same_size_but_different = dir.0.join("different.jpg");
        std::fs::write(&first, b"identical photo bytes").unwrap();
        std::fs::write(&renamed, b"identical photo bytes").unwrap();
        std::fs::write(&same_size_but_different, b"different photo bytes").unwrap();

        let groups = find_duplicate_photos(vec![
            first.to_string_lossy().to_string(),
            renamed.to_string_lossy().to_string(),
            same_size_but_different.to_string_lossy().to_string(),
        ]);

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].file_size, 21);
        assert_eq!(groups[0].paths.len(), 2);
        assert!(groups[0].paths.iter().any(|path| path.ends_with("original.jpg")));
        assert!(groups[0].paths.iter().any(|path| path.ends_with("renamed-copy.png")));
    }
}
