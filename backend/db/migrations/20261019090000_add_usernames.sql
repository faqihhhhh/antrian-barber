-- +goose Up
ALTER TABLE users ADD COLUMN username CITEXT;
ALTER TABLE users
    ADD CONSTRAINT users_username_key UNIQUE (username),
    ADD CONSTRAINT users_username_format_check
        CHECK (username IS NULL OR username::text ~ '^[a-z0-9_]{3,24}$');

-- +goose Down
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_username_format_check,
    DROP CONSTRAINT IF EXISTS users_username_key,
    DROP COLUMN IF EXISTS username;
