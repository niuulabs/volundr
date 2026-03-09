BINARY := volundr
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS := -ldflags "-s -w -X github.com/niuulabs/volundr/cli/internal/cli.Version=$(VERSION)"
WEB_DIR := ../web
EMBED_DEST := internal/web/dist
DIST_DIR := dist

.PHONY: build build-dev build-all web test lint clean fmt vet

# build compiles the CLI with the embedded frontend for the current platform.
build: web
	go build -tags embed_web $(LDFLAGS) -o bin/$(BINARY) ./cmd/volundr

# build-dev compiles without the frontend (placeholder page).
build-dev:
	go build $(LDFLAGS) -o bin/$(BINARY) ./cmd/volundr

# build-all cross-compiles for all supported platforms with embedded frontend.
build-all: web
	@mkdir -p $(DIST_DIR)
	GOOS=darwin  GOARCH=amd64 go build -tags embed_web $(LDFLAGS) -o $(DIST_DIR)/$(BINARY)-darwin-amd64   ./cmd/volundr
	GOOS=darwin  GOARCH=arm64 go build -tags embed_web $(LDFLAGS) -o $(DIST_DIR)/$(BINARY)-darwin-arm64   ./cmd/volundr
	GOOS=linux   GOARCH=amd64 go build -tags embed_web $(LDFLAGS) -o $(DIST_DIR)/$(BINARY)-linux-amd64    ./cmd/volundr
	GOOS=linux   GOARCH=arm64 go build -tags embed_web $(LDFLAGS) -o $(DIST_DIR)/$(BINARY)-linux-arm64    ./cmd/volundr
	@echo "Built binaries:"
	@ls -lh $(DIST_DIR)/

# web builds the frontend and copies it into the embed directory.
web:
	cd $(WEB_DIR) && npm ci --ignore-scripts && npm run build
	rm -rf $(EMBED_DEST)
	cp -r $(WEB_DIR)/dist $(EMBED_DEST)

test:
	go test ./... -v -count=1

lint: vet
	@which golangci-lint > /dev/null 2>&1 || echo "Install golangci-lint: https://golangci-lint.run/welcome/install-locally/"
	golangci-lint run ./...

vet:
	go vet ./...

fmt:
	gofmt -w .

clean:
	rm -rf bin/ $(EMBED_DEST) $(DIST_DIR)
