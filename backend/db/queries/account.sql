-- name: ListMembershipContextForUser :many
SELECT m.id AS membership_id, m.tenant_id, t.name AS tenant_name, m.roles
FROM memberships m
JOIN tenants t ON t.id = m.tenant_id
WHERE m.user_id = $1
ORDER BY t.name;

-- name: ListOutletsForMembership :many
SELECT o.* FROM outlets o
WHERE o.tenant_id = sqlc.arg(tenant_id)::uuid
  AND (
    sqlc.arg(all_outlets)::boolean
    OR EXISTS (
      SELECT 1 FROM membership_outlets mo
      WHERE mo.membership_id = sqlc.arg(membership_id)::uuid AND mo.outlet_id = o.id
    )
  )
ORDER BY o.name;