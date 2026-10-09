-- name: CreateReview :one
INSERT INTO reviews (tenant_id, ticket_id, kapster_membership_id, customer_user_id, rating, comment)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetReviewByTicketID :one
SELECT * FROM reviews WHERE ticket_id = $1;

-- name: ListReviewsByTenant :many
SELECT r.id, r.ticket_id, r.kapster_membership_id, u.email AS kapster_email, r.rating, r.comment, r.created_at
FROM reviews r
JOIN memberships m ON m.id = r.kapster_membership_id
JOIN users u ON u.id = m.user_id
WHERE r.tenant_id = $1
ORDER BY r.created_at DESC
LIMIT $2 OFFSET $3;

-- name: ListReviewsByKapster :many
SELECT r.id, r.ticket_id, r.kapster_membership_id, u.email AS kapster_email, r.rating, r.comment, r.created_at
FROM reviews r
JOIN memberships m ON m.id = r.kapster_membership_id
JOIN users u ON u.id = m.user_id
WHERE r.tenant_id = $1 AND r.kapster_membership_id = $2
ORDER BY r.created_at DESC
LIMIT $3 OFFSET $4;

-- name: GetReviewSummaryByTenant :many
SELECT m.id AS membership_id,
       u.email AS kapster_email,
       COUNT(r.id)::bigint AS review_count,
       COALESCE(AVG(r.rating), 0)::float8 AS avg_rating
FROM memberships m
JOIN users u ON u.id = m.user_id
LEFT JOIN reviews r ON r.kapster_membership_id = m.id
WHERE m.tenant_id = $1 AND 'kapster' = ANY(m.roles)
GROUP BY m.id, u.email
ORDER BY avg_rating DESC, review_count DESC;