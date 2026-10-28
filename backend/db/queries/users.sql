-- name: CreateUser :one
INSERT INTO users (email, password_hash, display_name)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: MarkUserEmailVerified :exec
UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1;

-- name: UpdateUserPassword :exec
UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1;

-- name: UpdateUserDisplayName :exec
UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1;
