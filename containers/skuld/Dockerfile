FROM ubuntu:24.04@sha256:d1e2e92c075e5ca139d51a140fff46f84315c0fdce203eab2807c7e495eff4f9

LABEL org.opencontainers.image.title="skuld"
LABEL org.opencontainers.image.description="Skuld — remote AI coding session broker (Claude Code)"
LABEL org.opencontainers.image.vendor="Niuu Labs"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/niuulabs/volundr"

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    jq \
    tmux \
    python3.12 \
    python3.12-venv \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (LTS)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally via npm
RUN npm install -g @anthropic-ai/claude-code@2.1.76

# Create app user with UID 1000 (matches helm chart runAsUser)
RUN existing=$(getent passwd 1000 | cut -d: -f1) && \
    [ -n "$existing" ] && userdel -r "$existing" || true && \
    useradd -m -s /bin/bash -u 1000 skuld

# Set up Python virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python3.12 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install build dependencies
RUN pip install --no-cache-dir hatchling==1.29.0

# Copy volundr package and install
COPY pyproject.toml README.md /app/
COPY src/ /app/src/
RUN pip install --no-cache-dir /app

# Copy entrypoint
COPY containers/skuld/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Copy svc CLI tool
COPY containers/skuld/svc /usr/local/bin/svc
RUN chmod +x /usr/local/bin/svc

# Set working directory
WORKDIR /app

# Switch to non-root user
USER skuld

# Expose broker port (nginx is the entry point at 8080)
EXPOSE 8081

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8081/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
