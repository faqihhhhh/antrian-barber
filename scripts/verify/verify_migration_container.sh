#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="kapsflow-migration-check-$$"
COMPOSE_FILE="docker-compose.migration-test.yml"
COMPOSE=(docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE")

cleanup() {
  "${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${COMPOSE[@]}" up -d db
"${COMPOSE[@]}" run --rm --build migrate
"${COMPOSE[@]}" run --rm --no-deps verify
