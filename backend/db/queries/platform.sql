-- name: IsPlatformAdmin :one
SELECT EXISTS(SELECT 1 FROM platform_admins WHERE user_id = $1);