FROM python:3.12-slim

LABEL org.opencontainers.image.title="devrunner"
LABEL org.opencontainers.image.description="Devrunner — sandboxed development runtime"
LABEL org.opencontainers.image.vendor="Niuu Labs"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/niuulabs/volundr"

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies: Node.js, PostgreSQL server, inotify-tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    lsb-release \
    inotify-tools \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally via npm (same method as skuld pod)
RUN npm install -g @anthropic-ai/claude-code

# Install OpenAI Codex CLI
RUN npm install -g @openai/codex

# Install PostgreSQL 16
RUN echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor \
    -o /etc/apt/trusted.gpg.d/postgresql.gpg \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16 \
    && rm -rf /var/lib/apt/lists/*

# Common Python packages for web dev
RUN pip install --no-cache-dir \
    uvicorn \
    fastapi \
    flask \
    gunicorn \
    psycopg2-binary \
    pyyaml \
    aiohttp

# Create devrunner user (UID 1000 to match skuld)
RUN useradd -m -s /bin/bash -u 1000 devrunner

# Allow devrunner user to run PostgreSQL
RUN mkdir -p /run/postgresql && chown devrunner:devrunner /run/postgresql

# Copy process manager and terminal server
COPY containers/devrunner/devrunner.py /usr/local/bin/devrunner
COPY containers/devrunner/terminal.py /usr/local/bin/terminal.py
COPY containers/devrunner/restricted-shell /usr/local/bin/restricted-shell
RUN chmod +x /usr/local/bin/devrunner /usr/local/bin/restricted-shell

# Switch to non-root user
USER devrunner

ENTRYPOINT ["python", "/usr/local/bin/devrunner"]
