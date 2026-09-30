-- name: CreateTenant :exec
INSERT INTO tenants (id, name) VALUES ($1, $2);

-- name: GetTenantByID :one
SELECT * FROM tenants WHERE id = $1;

-- name: ListTenants :many
SELECT * FROM tenants ORDER BY created_at;