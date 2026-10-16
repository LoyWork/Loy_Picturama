-- Up

-- Existing RAW photos use embedded-preview geometry and may have pixel-based crop sidecars.
-- Preserve their rendering; newly imported photos opt into sensor decoding in insert_photos_batch.
ALTER TABLE photos ADD COLUMN raw_sensor_render integer NOT NULL DEFAULT 0;

-- Down

ALTER TABLE photos DROP COLUMN raw_sensor_render;
