FROM ubuntu:24.04

LABEL maintainer="Volundr Team"
LABEL description="Volundr - Self-hosted Claude Code session manager"

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    python3.12 \
    python3.12-venv \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (LTS)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally via npm (same method as skuld pod)
RUN npm install -g @anthropic-ai/claude-code

# Create app user
RUN useradd -m -s /bin/bash volundr

# Set up Python virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python3.12 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install build dependencies
RUN pip install --no-cache-dir hatchling

# Copy volundr package and install
COPY pyproject.toml README.md /app/
COPY src/ /app/src/
RUN pip install --no-cache-dir '/app[k8s]'

# Copy entrypoint
COPY containers/volundr/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Set working directory
WORKDIR /app

# Switch to non-root user
USER volundr

# Expose API port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
