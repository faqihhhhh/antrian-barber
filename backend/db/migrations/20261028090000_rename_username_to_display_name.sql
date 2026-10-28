-- +goose Up
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_format_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
ALTER TABLE users RENAME COLUMN username TO display_name;
ALTER TABLE users ADD CONSTRAINT users_display_name_length_check
    CHECK (display_name IS NULL OR (char_length(btrim(display_name::text)) BETWEEN 1 AND 60));

-- +goose Down
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_display_name_length_check;
ALTER TABLE users RENAME COLUMN display_name TO username;
