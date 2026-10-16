# Camera RAW support

Picturama vendors LightCraft's complete `raw` crate and its five foundation crates (`tiff`, `meta`,
`geom`, `color`, `raster`). Builds do not depend on a sibling LightCraft checkout. The adapter lives
in `src-tauri/raw-decoder`, and the shared renderer uses its output for viewing, thumbnails and export.

## Coverage

| Family | Behaviour |
| --- | --- |
| Nikon NEF / NRW | Uncompressed and supported Huffman lossless/lossy variants decode sensor data. HE / HE★ uses the embedded preview. Some model/packing variants remain unsupported. |
| Canon CR2 / CR3 | Sensor decode for supported lossless JPEG / CRX variants; other variants use previews. |
| Sony ARW / SR2 / SRF | Sensor decode where the upstream reader supports the layout; older variants can be preview-only (including the repository's DSLR-A100 sample). |
| Fujifilm RAF | Supported Bayer / X-Trans uncompressed and compressed sensor data. |
| DNG | Supported CFA and linear data, including supported JPEG XL DNG 1.7. |
| Panasonic RW2 / RAW, Leica RWL | Supported packed and compressed sensor layouts. |
| Pentax PEF / PTX, Olympus ORF / ORI, Samsung SRW | Supported layouts decode; other compression variants use previews. |
| Hasselblad 3FR / FFF, Kodak DCR / KDC | Sensor decoding for recognised DNG-like / Kodak layouts, otherwise previews. |
| IIQ, ERF, MOS, CRW, MRW, X3F | Primarily embedded-preview support; extension recognition does not promise sensor decode. |

The source of truth is `picturama_raw::EXTENSIONS` and the vendored decoder's container dispatch.
Unsupported or corrupt sensor data falls back only when a usable embedded preview exists. Otherwise
the file produces an error and scanning continues. Preview fallbacks and their reasons are logged.

## Rendering and existing libraries

New imports use sensor pixels when available. The adapter subtracts black, normalises white, applies
RAW opcodes, demosaics (PPG for Bayer, the upstream directional method for X-Trans), applies as-shot
white balance and camera colour conversion, crops and orients the image. DNG colour matrices take
precedence; the measured spectral camera table is used when available, else the upstream neutral
model. DNG hue/saturation and look tables and baseline exposure are applied. This does **not** port
LightCraft's engine-level camera-JPEG fitting, default tone pipeline, AI denoise or Lightroom presets.
Default colour/brightness can therefore differ from both the camera preview and LightCraft.

The current WebGL editor receives **8-bit sRGB** through binary IPC. Its existing sliders act on that
rendered image; they do not yet re-develop the sensor data at each edit. This is a sensor decoding
integration, not a full high-bit-depth RAW editing pipeline. Source RAW files are never rewritten.

Migration 005 marks existing library records as preview-based. They retain their original preview
geometry, thumbnails and pixel crop coordinates; new imports opt into sensor decoding. No existing
sidecars are migrated or rescaled. This intentionally avoids silently applying old crops to a new
sensor-sized image. There is no automatic conversion of existing library records in this change.

Imports use the same decode/fallback as display, so their dimensions match the actual image. This is
more expensive than preview-only import. Decodes are serialised and cache one frame up to 96 MiB,
invalidated by file path, size, modification time and source mode. Input files are limited to 512 MiB;
sensor images above 80 MP try a preview, and displayed previews are limited to 80 MP. JPEG and JPEG XL
previews are supported. Unexpected decoder panics are contained in workers (release uses unwinding).

## Verification

Run from the repository root:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml -p picturama-raw
cargo test --manifest-path src-tauri/Cargo.toml -p lightcraft-raw --lib
cargo test --manifest-path src-tauri/Cargo.toml --bin Picturama
npm test -- --runInBand
npm run build
```

Adapter tests cover synthetic NEF sensor decoding, all eight EXIF orientations, unsupported-variant
preview fallback, old-library geometry, binary IPC, cache invalidation, malformed data and all eight
repository RAW files. The real corpus contains ARW, RAF, CR2 and DNG; **real camera NEF files have not
yet been verified in Picturama**. Upstream synthetic compressed NEF tests are retained and run.

For a manual camera check, export the adapter's display pixels without opening or modifying a library:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml -p picturama-raw --example inspect -- INPUT.NEF OUTPUT.jpg
```

Add `--preview` after `OUTPUT.jpg` to compare with the embedded camera preview. The command prints
the dimensions and any preview fallback reason.

See `src-tauri/vendor/lightcraft/README.md` for source and licence provenance.
