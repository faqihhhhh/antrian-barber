-- +goose Up
-- citext: tipe teks yang tidak membedakan huruf besar/kecil, dipakai untuk email.
CREATE EXTENSION IF NOT EXISTS citext;

-- +goose Down
DROP EXTENSION IF EXISTS citext;