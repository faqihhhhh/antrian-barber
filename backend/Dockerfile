FROM golang:1.27.1-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/kapsflow ./cmd/api

FROM alpine:3.24

RUN apk add --no-cache ca-certificates && \
    addgroup -S kapsflow && adduser -S -G kapsflow kapsflow
COPY --from=build /out/kapsflow /usr/local/bin/kapsflow

USER kapsflow:kapsflow
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/kapsflow"]
