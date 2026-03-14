FROM node:22-slim AS fetch

LABEL org.opencontainers.image.title="vscode-reh"
LABEL org.opencontainers.image.description="VS Code Remote Extension Host server for Skuld session pods"
LABEL org.opencontainers.image.vendor="Niuu Labs"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/niuulabs/volundr"

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Install only the @codingame/monaco-vscode-api package to read the VS Code
# commit hash — no other dependencies are needed in this stage.
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts

# Download the REH binary matching the npm package commit
COPY containers/skuld/download-reh.sh ./download-reh.sh
RUN chmod +x ./download-reh.sh && ./download-reh.sh /opt/vscode-reh

# ---------------------------------------------------------------------------
# Runtime — minimal image with just the REH binary
# ---------------------------------------------------------------------------
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    libatomic1 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user matching the session pod UID
RUN useradd -m -u 1000 -s /bin/bash coder

COPY --from=fetch /opt/vscode-reh /opt/vscode-reh

# Ensure the binary is executable
RUN chmod +x /opt/vscode-reh/bin/code-server-oss

USER coder
WORKDIR /home/coder

EXPOSE 8445

ENTRYPOINT ["/opt/vscode-reh/bin/code-server-oss"]
CMD ["--host=0.0.0.0", "--port=8445", "--without-connection-token", "--accept-server-license-terms"]
