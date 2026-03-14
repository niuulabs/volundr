#!/bin/sh
# Copy default dotfiles to user home if they don't already exist.
# Called on container startup to seed the persistent home directory.

SKEL_DIR="/etc/skel"
TARGET_DIR="${HOME:-/volundr/home}"

copy_if_missing() {
    src="$1"
    # Compute relative path from skel dir
    rel="${src#$SKEL_DIR/}"
    dest="$TARGET_DIR/$rel"

    if [ ! -e "$dest" ]; then
        mkdir -p "$(dirname "$dest")"
        cp "$src" "$dest"
    fi
}

# Walk all files in /etc/skel
find "$SKEL_DIR" -type f | while read -r file; do
    copy_if_missing "$file"
done

# Seed oh-my-zsh if not already present
if [ -d /usr/share/oh-my-zsh ] && [ ! -d "$TARGET_DIR/.oh-my-zsh" ]; then
    cp -r /usr/share/oh-my-zsh "$TARGET_DIR/.oh-my-zsh"
fi

# Install Homebrew into persistent home if not already present.
# Clone to /tmp first because git index-pack uses mmap which fails on
# NFS-backed volumes (Permission denied on tmp_pack files), then move.
if [ ! -x "$TARGET_DIR/.linuxbrew/bin/brew" ]; then
    echo "Installing Homebrew into $TARGET_DIR/.linuxbrew ..."
    BREW_TMP="$(mktemp -d)"
    git clone --depth=1 https://github.com/Homebrew/brew "$BREW_TMP/Homebrew"
    mkdir -p "$TARGET_DIR/.linuxbrew/bin"
    mv "$BREW_TMP/Homebrew" "$TARGET_DIR/.linuxbrew/Homebrew"
    rm -rf "$BREW_TMP"
    ln -sf "$TARGET_DIR/.linuxbrew/Homebrew/bin/brew" "$TARGET_DIR/.linuxbrew/bin/brew"
fi
