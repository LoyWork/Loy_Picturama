use super::*;
use lightcraft_tiff::{ByteOrder, IfdBuilder, ImageData, TiffWriter, Value, tags as t};

fn jpeg(orientation: u16) -> Vec<u8> {
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 95)
        .encode(&[160; 4 * 2 * 3], 4, 2, image::ExtendedColorType::Rgb8).unwrap();
    let mut exif = IfdBuilder::new();
    exif.set(t::ORIENTATION, Value::Short(vec![orientation]));
    let tiff = TiffWriter::new(ByteOrder::Little, false).write(&[exif]).unwrap();
    let mut result = vec![0xff, 0xd8, 0xff, 0xe1];
    result.extend_from_slice(&((tiff.len() + 8) as u16).to_be_bytes());
    result.extend_from_slice(b"Exif\0\0");
    result.extend(tiff);
    result.extend_from_slice(&jpeg[2..]);
    result
}

fn nef(compression: u16, orientation: u16) -> Vec<u8> {
    let mut raw = IfdBuilder::new();
    raw.set(t::IMAGE_WIDTH, Value::Long(vec![32]));
    raw.set(t::IMAGE_LENGTH, Value::Long(vec![16]));
    raw.set(t::BITS_PER_SAMPLE, Value::Short(vec![16]));
    raw.set(t::COMPRESSION, Value::Short(vec![compression]));
    raw.set(t::PHOTOMETRIC, Value::Short(vec![t::photometric::CFA]));
    raw.set(t::CFA_REPEAT_PATTERN_DIM, Value::Short(vec![2, 2]));
    raw.set(t::CFA_PATTERN_EP, Value::Byte(vec![0, 1, 1, 2]));
    raw.set_image(ImageData::Strips { rows_per_strip: 16,
        strips: vec![(0..512).flat_map(|i| (1000 + i as u16 * 40).to_le_bytes()).collect()] });
    let mut main = IfdBuilder::new();
    main.set(t::MAKE, Value::Ascii("NIKON CORPORATION".into()));
    main.set(t::MODEL, Value::Ascii("NIKON TEST".into()));
    main.set(t::ORIENTATION, Value::Short(vec![orientation]));
    main.set(t::IMAGE_WIDTH, Value::Long(vec![4]));
    main.set(t::IMAGE_LENGTH, Value::Long(vec![2]));
    main.set(t::BITS_PER_SAMPLE, Value::Short(vec![8, 8, 8]));
    main.set(t::SAMPLES_PER_PIXEL, Value::Short(vec![3]));
    main.set(t::PHOTOMETRIC, Value::Short(vec![t::photometric::RGB]));
    main.set(t::COMPRESSION, Value::Short(vec![7]));
    main.set_image(ImageData::Strips { rows_per_strip: 2, strips: vec![jpeg(orientation)] });
    main.add_sub_ifd(raw);
    TiffWriter::new(ByteOrder::Little, false).write(&[main]).unwrap()
}

#[test]
fn nef_sensor_decode_and_all_exif_orientations() {
    for orientation in 1..=8 {
        let image = decode_bytes(&nef(1, orientation), false).unwrap();
        assert!(image.preview_reason.is_none(), "{image:?}");
        let size = if orientation >= 5 { (16, 32) } else { (32, 16) };
        assert_eq!((image.width, image.height), size);
        assert_eq!(image.data.len(), 32 * 16 * 3);
        assert!(image.data.iter().any(|&v| v > 0));
        let ipc = image.ipc_bytes();
        assert_eq!(u32::from_le_bytes(ipc[..4].try_into().unwrap()), image.width);
        assert_eq!(u32::from_le_bytes(ipc[4..8].try_into().unwrap()), image.height);
        assert_eq!(&ipc[8..], image.data);
    }
}

#[test]
fn unsupported_nef_falls_back_to_rotated_preview() {
    let image = decode_bytes(&nef(65500, 6), false).unwrap();
    assert!(image.preview_reason.is_some());
    assert_eq!((image.width, image.height), (2, 4));
    assert_eq!(image.data.len(), 24);
}

#[test]
fn existing_library_mode_preserves_preview_geometry() {
    let bytes = nef(1, 1);
    let sensor = decode_bytes(&bytes, false).unwrap();
    let legacy = decode_bytes(&bytes, true).unwrap();
    assert_eq!((sensor.width, sensor.height), (32, 16));
    assert_eq!((legacy.width, legacy.height), (4, 2));
    assert!(legacy.preview_reason.is_some());
}

#[test]
fn rejects_malformed_files_without_panicking() {
    for data in [vec![], vec![0; 256], b"II*\0\xff\xff\xff\xff".to_vec(), b"FUJIFILMCCD-RAW".to_vec()] {
        assert!(decode_bytes(&data, false).is_err());
    }
    assert!(checked_pixels(usize::MAX, 2).is_err());
    assert!(checked_pixels(0, 10).is_err());
}

#[test]
fn cache_separates_source_modes_and_invalidates_changed_files() {
    let path = std::env::temp_dir().join(format!("picturama-raw-{}.nef", std::process::id()));
    let path_str = path.to_str().unwrap();
    std::fs::write(&path, nef(1, 1)).unwrap();
    let first = decode_file(path_str, false).unwrap();
    assert!(Arc::ptr_eq(&first, &decode_file(path_str, false).unwrap()));
    assert_eq!(decode_file(path_str, true).unwrap().width, 4);
    let mut changed = nef(1, 6);
    changed.extend([0; 16]);
    std::fs::write(&path, changed).unwrap();
    let second = decode_file(path_str, false).unwrap();
    assert_eq!((second.width, second.height), (16, 32));
    std::fs::remove_file(path).unwrap();
}

#[test]
fn real_raw_corpus_decodes_with_consistent_geometry() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../submodules/test-data/photos/raw");
    let files: Vec<_> = std::fs::read_dir(&dir).unwrap().filter_map(Result::ok)
        .map(|e| e.path()).filter(|p| p.extension().and_then(|e| e.to_str())
            .is_some_and(|ext| EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))).collect();
    assert!(files.len() >= 8, "test-data submodule must be present");
    for file in files {
        let image = decode_file(file.to_str().unwrap(), false).unwrap();
        eprintln!("{}: {}x{}, preview={:?}", file.display(), image.width, image.height, image.preview_reason);
        assert_eq!(image.data.len(), image.width as usize * image.height as usize * 3);
    }
}
