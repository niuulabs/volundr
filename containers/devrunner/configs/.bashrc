# ~/.bashrc — volundr default bash configuration

# If not running interactively, don't do anything
case $- in
    *i*) ;;
      *) return;;
esac

# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------
HISTSIZE=10000
HISTFILESIZE=20000
HISTCONTROL=ignoreboth:erasedups
shopt -s histappend

# ---------------------------------------------------------------------------
# Shell options
# ---------------------------------------------------------------------------
shopt -s checkwinsize
shopt -s globstar 2>/dev/null
shopt -s cdspell 2>/dev/null

# ---------------------------------------------------------------------------
# Homebrew
# ---------------------------------------------------------------------------
if [ -x "$HOME/.linuxbrew/bin/brew" ]; then
    eval "$("$HOME/.linuxbrew/bin/brew" shellenv)"
fi

# ---------------------------------------------------------------------------
# Aliases
# ---------------------------------------------------------------------------
alias ll='ls -alF --color=auto'
alias la='ls -A --color=auto'
alias l='ls -CF --color=auto'
alias ls='ls --color=auto'
alias grep='grep --color=auto'

# ---------------------------------------------------------------------------
# Prompt — agnoster-inspired with powerline segments
# ---------------------------------------------------------------------------
__prompt_segment() {
    local bg="$1" fg="$2" text="$3"
    if [ -n "$__PROMPT_LAST_BG" ]; then
        printf '\[\e[%s;%sm\]\xee\x82\xb0\[\e[%s;%sm\] %s ' \
            "$__PROMPT_LAST_BG" "4${bg#3}" \
            "$fg" "4${bg#3}" "$text"
    else
        printf '\[\e[%s;4%sm\] %s ' "$fg" "${bg#3}" "$text"
    fi
    __PROMPT_LAST_BG="$bg"
}

__prompt_end() {
    if [ -n "$__PROMPT_LAST_BG" ]; then
        printf '\[\e[0;%sm\]\xee\x82\xb0\[\e[0m\]' "$__PROMPT_LAST_BG"
    fi
    unset __PROMPT_LAST_BG
}

__git_info() {
    local branch
    branch=$(git symbolic-ref --short HEAD 2>/dev/null) || return
    local status_flags=""
    if ! git diff --quiet 2>/dev/null; then
        status_flags="✎"
    fi
    if ! git diff --cached --quiet 2>/dev/null; then
        status_flags="${status_flags}+"
    fi
    if [ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]; then
        status_flags="${status_flags}?"
    fi
    if [ -n "$status_flags" ]; then
        printf '%s %s' "$branch" "$status_flags"
    else
        printf '%s' "$branch"
    fi
}

__build_prompt() {
    unset __PROMPT_LAST_BG

    # Directory segment — blue
    __prompt_segment "34" "37" '\w'

    # Git segment — green (clean) or yellow (dirty)
    local git_info
    git_info=$(__git_info)
    if [ -n "$git_info" ]; then
        if [[ "$git_info" == *[✎+?]* ]]; then
            __prompt_segment "33" "30" " $git_info"
        else
            __prompt_segment "32" "30" " $git_info"
        fi
    fi

    __prompt_end
    printf ' '
}

PROMPT_COMMAND='PS1=$(__build_prompt)'
