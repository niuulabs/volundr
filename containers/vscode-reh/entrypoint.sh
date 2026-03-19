#!/bin/sh
set -e

# Source env vars rendered by Infisical Agent Injector
if [ -f /run/secrets/env.sh ]; then
    . /run/secrets/env.sh
fi

# Remove leftover agent access token
rm -f /home/.infisical-workdir/identity-access-token

exec /opt/vscode-reh/bin/reh-server "$@"
