-- +goose Up
-- Alamat publik outlet (untuk tautan dan QR). Isi awal dari nama + 6 karakter id.
ALTER TABLE outlets ADD COLUMN slug TEXT;
UPDATE outlets SET slug =
    COALESCE(NULLIF(trim(both '-' from left(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), 40)), ''), 'outlet')
    || '-' || substr(replace(id::text, '-', ''), 1, 6);
ALTER TABLE outlets ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX idx_outlets_slug ON outlets (slug);
ALTER TABLE outlets ADD CONSTRAINT outlets_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Tautan QR Midtrans disimpan supaya pelanggan yang menutup halaman bisa membukanya lagi.
ALTER TABLE ticket_payments ADD COLUMN qr_code_url TEXT;

-- QRIS statis milik owner untuk mode DP manual.
ALTER TABLE tenant_profiles
    ADD COLUMN manual_qris_image BYTEA,
    ADD COLUMN manual_qris_content_type TEXT,
    ADD COLUMN manual_qris_updated_at TIMESTAMPTZ;

ALTER TABLE tickets ADD CONSTRAINT tickets_customer_name_len
    CHECK (customer_name IS NULL OR char_length(customer_name) <= 60);

-- +goose Down
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_customer_name_len;
ALTER TABLE tenant_profiles
    DROP COLUMN IF EXISTS manual_qris_updated_at,
    DROP COLUMN IF EXISTS manual_qris_content_type,
    DROP COLUMN IF EXISTS manual_qris_image;
ALTER TABLE ticket_payments DROP COLUMN IF EXISTS qr_code_url;
ALTER TABLE outlets DROP CONSTRAINT IF EXISTS outlets_slug_format;
DROP INDEX IF EXISTS idx_outlets_slug;
ALTER TABLE outlets DROP COLUMN IF EXISTS slug;