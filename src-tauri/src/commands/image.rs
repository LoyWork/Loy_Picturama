// Image decoding commands (HEIC/HEIF, RAW sensor decoding and legacy preview extraction). These are thin
// wrappers over the `crate::image` reader modules; the pixel/JPEG bytes are streamed as raw IPC
// responses rather than serde structs (see below).

use crate::image::{heif, raw_reader};
use crate::store::db::DbHandle;
use tauri::State;

/// Decodes a HEIC/HEIF file to interleaved 8-bit RGB via libheif. The container's geometric
/// transforms (rotation/crop/mirror) are applied during decode, so `width`/`height` are the
/// display (oriented) dimensions and the frontend uploads the buffer as-is.
///
/// The result is returned as raw bytes (an 8-byte header + RGB8 pixels) rather than a serde struct:
/// serializing a 12 MP image, the ~36 MB pixel `Vec<u8>` as JSON would balloon it into a
/// ~130 MB number array, which would dominated the load time (because of JSON serialization/deserialization).
/// Raw bytes cross IPC as an `ArrayBuffer`.
#[tauri::command]
pub async fn load_heif_file(path: String) -> Result<tauri::ipc::Response, String> {
    let img = tokio::task::block_in_place(|| heif::decode_file(&path))?;
    Ok(tauri::ipc::Response::new(heif::encode_heif_response(&img)))
}

/// Legacy API returning the camera-developed JPEG. New display requests use `load_raw_file`.
#[tauri::command]
pub async fn extract_raw_preview_jpg(path: String) -> Result<tauri::ipc::Response, String> {
    let jpeg = tokio::task::block_in_place(|| raw_reader::extract_embedded_jpeg(&path))?;
    Ok(tauri::ipc::Response::new(jpeg))
}

/// Decodes sensor data (or a preview for unsupported variants) to oriented sRGB8.
/// Existing library rows retain preview geometry to preserve saved crops.
#[tauri::command]
pub async fn load_raw_file(path: String, db: State<'_, DbHandle>) -> Result<tauri::ipc::Response, String> {
    let preview_only = crate::store::photo_store::raw_uses_legacy_preview(&db, &path)?;
    let bytes = tokio::task::spawn_blocking(move || {
        picturama_raw::decode_file(&path, preview_only).map(|img| img.ipc_bytes())
    }).await.map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}
