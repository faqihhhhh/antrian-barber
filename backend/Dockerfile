FROM golang:1.27.1-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/kapsflow ./cmd/api

FROM golang:1.27.1-alpine AS goose-build

RUN CGO_ENABLED=0 go install -tags='no_mysql no_sqlite3 no_ydb no_clickhouse no_mssql no_vertica no_libsql no_azuresql' github.com/pressly/goose/v3/cmd/goose@v3.28.0

FROM postgres:17 AS migrate

COPY --from=goose-build /go/bin/goose /usr/local/bin/goose
COPY db/migrations /migrations
COPY deploy-migrate.sh /usr/local/bin/deploy-migrate.sh
ENTRYPOINT ["sh", "/usr/local/bin/deploy-migrate.sh"]

FROM alpine:3.24

RUN apk add --no-cache ca-certificates && \
    addgroup -S kapsflow && adduser -S -G kapsflow kapsflow
COPY --from=build /out/kapsflow /usr/local/bin/kapsflow

USER kapsflow:kapsflow
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/kapsflow"]
