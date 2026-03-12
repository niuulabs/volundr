FROM python:3.14-slim

LABEL org.opencontainers.image.title="devrunner"
LABEL org.opencontainers.image.description="Devrunner — sandboxed development runtime"
LABEL org.opencontainers.image.vendor="Niuu Labs"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/niuulabs/volundr"

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies: Node.js, PostgreSQL server, shells, inotify-tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    lsb-release \
    inotify-tools \
    git \
    tmux \
    zsh \
    fish \
    zsh-autosuggestions \
    zsh-syntax-highlighting \
    && rm -rf /var/lib/apt/lists/*

# Install oh-my-zsh system-wide (users get a copy via init-home.sh)
RUN git clone --depth=1 https://github.com/ohmyzsh/ohmyzsh.git /usr/share/oh-my-zsh

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

# Install Homebrew dependencies (so users can brew install without root)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    procps \
    file \
    && rm -rf /var/lib/apt/lists/*

# Create devrunner user (UID 1000 to match skuld)
RUN useradd -m -s /bin/bash -u 1000 devrunner

# Allow devrunner user to run PostgreSQL
RUN mkdir -p /run/postgresql && chown devrunner:devrunner /run/postgresql

# Copy default dotfiles into /etc/skel for first-launch seeding
COPY containers/devrunner/configs/.bashrc /etc/skel/.bashrc
COPY containers/devrunner/configs/.zshrc /etc/skel/.zshrc
COPY containers/devrunner/configs/.config/fish/config.fish /etc/skel/.config/fish/config.fish
COPY containers/devrunner/configs/.config/fish/functions/fish_prompt.fish /etc/skel/.config/fish/functions/fish_prompt.fish

# Copy process manager, terminal server, and init script
COPY containers/devrunner/devrunner.py /usr/local/bin/devrunner
COPY containers/devrunner/terminal.py /usr/local/bin/terminal.py
COPY containers/devrunner/restricted-shell /usr/local/bin/restricted-shell
COPY containers/devrunner/configs/init-home.sh /usr/local/bin/init-home.sh
RUN chmod +x /usr/local/bin/devrunner /usr/local/bin/restricted-shell /usr/local/bin/init-home.sh

# Switch to non-root user
USER devrunner

ENTRYPOINT ["python", "/usr/local/bin/devrunner"]
