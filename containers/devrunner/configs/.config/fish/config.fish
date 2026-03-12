# ~/.config/fish/config.fish — volundr default fish configuration

# ---------------------------------------------------------------------------
# Homebrew
# ---------------------------------------------------------------------------
if test -x $HOME/.linuxbrew/bin/brew
    eval ($HOME/.linuxbrew/bin/brew shellenv)
end

# ---------------------------------------------------------------------------
# Aliases
# ---------------------------------------------------------------------------
alias ll 'ls -alF --color=auto'
alias la 'ls -A --color=auto'
alias l 'ls -CF --color=auto'
alias grep 'grep --color=auto'
