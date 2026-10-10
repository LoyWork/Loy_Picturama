-- Up

-- Normalises the path separators in photos.master_dir to forward slashes.
--
-- The import scanner joins directories with '/', but the photo roots it starts from come from
-- settings.json, which on Windows holds backslash form (as returned by the native folder dialog).
-- Rows therefore ended up with mixed separators ('D:\dir/sub'), which broke prefix comparisons
-- against the configured roots (the folder filter) and would break the scan cleanup's
-- `master_dir NOT IN (...)` check once settings are normalised to forward slashes too.

UPDATE photos SET master_dir = REPLACE(master_dir, '\', '/');

-- Down

-- The backslash form cannot be restored (it was never uniform in the first place), and rows written
-- after this migration are forward-slash only. No-op on purpose.
