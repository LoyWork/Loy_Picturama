# Vendored LightCraft RAW modules

Copied from the local Loy_LightCraft checkout corresponding to upstream commit
`b3d392b4994ee99dc389890f006600769d0c4ff5` (LightCraft 0.7.1), on 2026-10-15.
Upstream: https://github.com/storytold/lightcraft

Includes the complete `src/` trees of `raw`, `tiff`, `meta`, `geom`, `color` and `raster`.
Source code is retained unchanged. Manifests inherit the selected original versions/features and
lints from Picturama's Cargo workspace. The UI, engine and pipeline are not copied. Picturama's
integration code lives separately in `src-tauri/raw-decoder`.

The modules are MIT OR Apache-2.0, Copyright (c) 2026 ArtCraft Team and the LightCraft contributors.
Each crate carries both licence texts for the application's licence collector. `NOTICE` and
`ATTRIBUTION.md` retain upstream attribution (including entries for assets not copied here).
The generated `raw/src/spectral_table.rs` additionally derives from rawtoaces-data v1.1.0
(Academy Software Foundation, Apache-2.0) and CIE 1931 colour-matching functions (CIE, CC-BY-4.0).
The source commit, named authors, transformations and source URL are recorded in `ATTRIBUTION.md`.
No LightCraft branding assets or Adobe assets are included.
