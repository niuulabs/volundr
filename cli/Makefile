BINARY := niuu
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS := -ldflags "-s -w -X github.com/niuulabs/volundr/cli/internal/cli.Version=$(VERSION)"
WEB_DIR := ../web
MIGRATIONS_DIR := ../migrations
EMBED_WEB_DEST := internal/web/dist
EMBED_MIG_DEST := internal/migrations/sql
EMBED_TYR_MIG_DEST := internal/migrations/tyr_sql
DIST_DIR := dist
BUILD_TAGS := embed_web,embed_migrations

.PHONY: build build-dev build-all web migrations test test-coverage lint clean fmt vet verify

# build compiles the CLI with the embedded frontend and migrations for the current platform.
build: web migrations
	go build -tags $(BUILD_TAGS) $(LDFLAGS) -o bin/$(BINARY) ./cmd/niuu

# build-dev compiles without the frontend or embedded migrations (placeholder page, filesystem migrations).
build-dev:
	go build $(LDFLAGS) -o bin/$(BINARY) ./cmd/niuu

# build-all cross-compiles for all supported platforms with embedded frontend and migrations.
build-all: web migrations
	@mkdir -p $(DIST_DIR)
	GOOS=darwin  GOARCH=amd64 go build -tags $(BUILD_TAGS) $(LDFLAGS) -o $(DIST_DIR)/$(BINARY)-darwin-amd64   ./cmd/niuu
	GOOS=darwin  GOARCH=arm64 go build -tags $(BUILD_TAGS) $(LDFLAGS) -o $(DIST_DIR)/$(BINARY)-darwin-arm64   ./cmd/niuu
	GOOS=linux   GOARCH=amd64 go build -tags $(BUILD_TAGS) $(LDFLAGS) -o $(DIST_DIR)/$(BINARY)-linux-amd64    ./cmd/niuu
	GOOS=linux   GOARCH=arm64 go build -tags $(BUILD_TAGS) $(LDFLAGS) -o $(DIST_DIR)/$(BINARY)-linux-arm64    ./cmd/niuu
	@echo "Built binaries:"
	@ls -lh $(DIST_DIR)/

# web builds the frontend and copies it into the embed directory.
web:
	cd $(WEB_DIR) && npm ci --ignore-scripts && npm run build
	rm -rf $(EMBED_WEB_DEST)
	cp -r $(WEB_DIR)/dist $(EMBED_WEB_DEST)

# migrations copies SQL migration files into the embed directory.
migrations:
	rm -rf $(EMBED_MIG_DEST) $(EMBED_TYR_MIG_DEST)
	mkdir -p $(EMBED_MIG_DEST) $(EMBED_TYR_MIG_DEST)
	cp $(MIGRATIONS_DIR)/*.up.sql $(EMBED_MIG_DEST)/
	cp $(MIGRATIONS_DIR)/tyr/*.up.sql $(EMBED_TYR_MIG_DEST)/

test:
	go test ./... -v -count=1

test-coverage:
	go test ./... -v -count=1 -coverprofile=coverage.out
	@total=$$(go tool cover -func=coverage.out | grep '^total:' | awk '{print $$3}' | tr -d '%'); \
	echo "Total coverage: $${total}%"; \
	if awk "BEGIN {exit !($$total < 85.0)}"; then \
		echo "FAIL: Coverage $${total}% is below minimum threshold of 85%"; \
		exit 1; \
	fi

lint:
	golangci-lint run ./...

vet:
	go vet ./...

verify: lint test-coverage

fmt:
	gofmt -w .

clean:
	rm -rf bin/ $(EMBED_WEB_DEST) $(EMBED_MIG_DEST) $(EMBED_TYR_MIG_DEST) $(DIST_DIR)
