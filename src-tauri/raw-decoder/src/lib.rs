//! Picturama's adapter for the vendored LightCraft RAW engine.
//! Sensor decoding, normalisation, demosaicing and colour conversion happen here; the existing
//! WebGL editor receives oriented sRGB8 pixels. Unsupported variants fall back to a camera preview.
#![forbid(unsafe_code)]

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use lightcraft_color::{REC2020, SRGB, transfer::linear_to_srgb};
use lightcraft_raw::{Orientation, RawError, RawImage, color, profile::ProfileTables};
use lightcraft_raster::Image;

#[cfg(test)]
mod tests;

/// Decodable families plus containers for which LightCraft offers embedded previews.
/// This is the single list consumed by the scanner and frontend configuration.
pub const EXTENSIONS: &[&str] = &[
    "dng", "cr2", "cr3", "crw", "nef", "nrw", "arw", "sr2", "srf", "raf", "rw2", "rwl",
    "raw", "pef", "ptx", "orf", "ori", "srw", "3fr", "fff", "iiq", "erf", "kdc", "dcr",
    "mos", "mrw", "x3f",
];

// Bound adapter allocations; upstream also bounds container parsing and decoded samples.
const MAX_PIXELS: usize = 80_000_000;
const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
const CACHE_BYTES: usize = 96 * 1024 * 1024;

#[derive(Debug)]
pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
    /// Present when the image came from a preview instead of sensor data.
    pub preview_reason: Option<String>,
}

impl DecodedImage {
    pub fn ipc_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(8 + self.data.len());
        out.extend_from_slice(&self.width.to_le_bytes());
        out.extend_from_slice(&self.height.to_le_bytes());
        out.extend_from_slice(&self.data);
        out
    }
}

#[derive(PartialEq)]
struct CacheKey {
    path: PathBuf,
    len: u64,
    modified: Option<SystemTime>,
    preview_only: bool,
}

// Serialise expensive decodes and cache at most one modest-sized display image. Metadata changes
// invalidate it. Import and first display of a file share exactly the same dimensions/fallback.
static CACHE: Mutex<Option<(CacheKey, Arc<DecodedImage>)>> = Mutex::new(None);

pub fn decode_file(path: &str, preview_only: bool) -> Result<Arc<DecodedImage>, String> {
    let path = Path::new(path);
    let meta = path.metadata().map_err(|e| format!("{}: {e}", path.display()))?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Err("RAW file exceeds the 512 MiB input limit or is not a file".into());
    }
    let key = CacheKey {
        path: path.canonicalize().map_err(|e| e.to_string())?,
        len: meta.len(), modified: meta.modified().ok(), preview_only,
    };
    let mut cache = CACHE.lock().map_err(|_| "RAW decoder cache is unavailable")?;
    if let Some((old, img)) = cache.as_ref() {
        if *old == key { return Ok(Arc::clone(img)); }
    }
    // Free the previous frame before allocating a new sensor raster.
    *cache = None;
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    // Keep an unexpected upstream panic inside this worker, outside the cache lock's unwind.
    let decoded = std::panic::catch_unwind(|| decode_bytes(&bytes, preview_only))
        .map_err(|_| "RAW decoder failed while reading this file".to_string())??;
    if let Some(reason) = &decoded.preview_reason {
        log::info!("RAW preview for {}: {reason}", path.display());
    }
    let decoded = Arc::new(decoded);
    if decoded.data.len() <= CACHE_BYTES { *cache = Some((key, Arc::clone(&decoded))); }
    Ok(decoded)
}

pub fn decode_bytes(bytes: &[u8], preview_only: bool) -> Result<DecodedImage, String> {
    if bytes.len() as u64 > MAX_FILE_BYTES { return Err("RAW input is too large".into()); }
    let reason = if preview_only {
        "Existing library photo retains its camera preview and crop coordinates".to_string()
    } else {
        match decode_sensor(bytes) {
            Ok(img) => return Ok(img),
            Err(e) => e.to_string(),
        }
    };
    let preview = lightcraft_raw::embedded_preview(bytes)
        .ok_or_else(|| format!("{reason}; no usable embedded preview"))?;
    let orientation = if preview_only { Orientation::Normal }
        else { lightcraft_meta::extract(bytes).orientation.unwrap_or_default() };
    decode_preview(&preview, orientation).map(|mut img| { img.preview_reason = Some(reason); img })
}

fn checked_pixels(width: usize, height: usize) -> Result<usize, String> {
    width.checked_mul(height).filter(|&n| n > 0 && n <= MAX_PIXELS)
        .ok_or_else(|| "RAW dimensions exceed the 80 megapixel display limit".into())
}

fn decode_sensor(bytes: &[u8]) -> Result<DecodedImage, RawError> {
    // Probe before allocating the full mosaic. Some vendor header probes read a few sensor rows.
    let info = lightcraft_raw::probe_info(bytes)?;
    checked_pixels(info.width, info.height).map_err(|_| RawError::Limit("80 megapixel sensor"))?;
    let mut raw = lightcraft_raw::decode(bytes)?;
    raw.validate()?;
    // Prefer the file's DNG matrices, then the measured spectral camera table, then the
    // upstream neutral colour model. We do not claim camera-JPEG/Lightroom colour matching.
    if let Some(camera) = raw.metadata.model.as_deref()
        .and_then(|model| lightcraft_raw::spectral::find(raw.metadata.make.as_deref(), model)) {
        camera.fill(&mut raw.color);
    }
    render_sensor(&raw)
}

fn render_sensor(raw: &RawImage) -> Result<DecodedImage, RawError> {
    let white = color::as_shot_white_xy(raw);
    let transform = color::camera_transform(raw, white);
    let to_srgb = SRGB.from_xyz().mul(&REC2020.to_xyz());
    let tables = ProfileTables::new(&raw.color.profile, color::illuminant_weight(&raw.color, white));
    let gain = 2.0f32.powf(transform.baseline_exposure.clamp(-10.0, 10.0) as f32);
    let mut rgb = raw.develop(lightcraft_raw::Method::Ppg)?;
    rgb.map_in_place(|p| {
        let balanced = std::array::from_fn(|i| f64::from(p[i] * transform.wb[i]));
        let working = transform.matrix.apply(balanced).map(|v| v as f32);
        let working = tables.as_ref().map_or_else(|| working.map(|v| v * gain), |t| t.apply(working, gain));
        let linear = to_srgb.apply(working.map(f64::from));
        linear.map(|v| linear_to_srgb(v as f32))
    });
    let rgb = rgb.into_oriented(raw.orientation);
    let data = rgb.data.iter().flat_map(|p| p.map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8)).collect();
    Ok(DecodedImage { width: rgb.width as u32, height: rgb.height as u32, data, preview_reason: None })
}

fn decode_preview(bytes: &[u8], fallback_orientation: Orientation) -> Result<DecodedImage, String> {
    if bytes.starts_with(&[0xff, 0xd8]) {
        // Inspect the JPEG dimensions before allocating its raster.
        let reader = image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Jpeg);
        let (w, h) = reader.into_dimensions().map_err(|e| e.to_string())?;
        checked_pixels(w as usize, h as usize)?;
        let rgb = image::load_from_memory_with_format(bytes, image::ImageFormat::Jpeg)
            .map_err(|e| e.to_string())?.into_rgb8();
        let pixels: Vec<[u8; 3]> = rgb.pixels().map(|p| p.0).collect();
        let orientation = exif::Reader::new().read_from_container(&mut Cursor::new(bytes)).ok()
            .and_then(|e| e.get_field(exif::Tag::Orientation, exif::In::PRIMARY)
                .and_then(|f| f.value.get_uint(0))).unwrap_or(u32::from(fallback_orientation.to_exif()));
        let image = Image { width: w as usize, height: h as usize, data: pixels }
            .into_oriented(Orientation::from_exif(orientation as u16));
        return Ok(DecodedImage { width: image.width as u32, height: image.height as u32,
            data: image.data.into_iter().flatten().collect(), preview_reason: None });
    }
    // DNG 1.7 may embed a JPEG XL preview. jxl-oxide applies its own orientation.
    let mut image = jxl_oxide::JxlImage::builder()
        .alloc_tracker(jxl_oxide::AllocTracker::with_limit(512 * 1024 * 1024))
        .read(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    checked_pixels(image.width() as usize, image.height() as usize)?;
    image.request_color_encoding(jxl_oxide::EnumColourEncoding::srgb(jxl_oxide::RenderingIntent::Relative));
    let render = image.render_frame(0).map_err(|e| e.to_string())?;
    let fb = render.image_all_channels();
    let channels = fb.channels();
    if channels == 0 { return Err("Preview has no colour channels".into()); }
    let data = fb.buf().chunks_exact(channels).flat_map(|p| {
        let rgb = if channels < 3 { [p[0]; 3] } else { [p[0], p[1], p[2]] };
        rgb.map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8)
    }).collect();
    Ok(DecodedImage { width: fb.width() as u32, height: fb.height() as u32, data, preview_reason: None })
}
