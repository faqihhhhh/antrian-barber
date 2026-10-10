.RECIPEPREFIX = >
include .env
export

.PHONY: db-up db-down dev migrate-up migrate-down migrate-status migrate-new

db-up:
> docker compose up -d

db-down:
> docker compose down

dev:
> cd backend && go run ./cmd/api

migrate-up:
> cd backend && goose -dir db/migrations postgres "$(DATABASE_URL)" up

migrate-down:
> cd backend && goose -dir db/migrations postgres "$(DATABASE_URL)" down

migrate-status:
> cd backend && goose -dir db/migrations postgres "$(DATABASE_URL)" status

# pemakaian: make migrate-new name=buat_tabel_users
migrate-new:
> cd backend && goose -dir db/migrations create $(name) sql

sqlc-generate:
> cd backend && sqlc generate

river-migrate:
> river migrate-up --line main --database-url "$(DATABASE_URL)"