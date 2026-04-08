# Stage 1: Build the Go binary
FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /build

# Cache dependencies first.
COPY cli/go.mod cli/go.sum ./cli/
RUN cd cli && go mod download

# Copy source and build.
COPY cli/ ./cli/
RUN cd cli && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o /forge ./cmd/forge

# Stage 2: Minimal runtime image
FROM alpine:3.21

# Patch base image vulnerabilities.
# Fix CVE-2026-22184: zlib critical vulnerability.
RUN apk upgrade --no-cache zlib

LABEL org.opencontainers.image.title="forge"
LABEL org.opencontainers.image.description="Forge — macOS-native session runner for Volundr"
LABEL org.opencontainers.image.vendor="Niuu Labs"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/niuulabs/volundr"

RUN apk add --no-cache ca-certificates git tini \
    && adduser -D -h /home/forge forge

COPY --from=builder /forge /usr/local/bin/forge

USER forge
WORKDIR /home/forge

EXPOSE 8080

ENTRYPOINT ["tini", "--"]
CMD ["forge", "serve"]
