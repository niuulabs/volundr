# Agnoster-inspired prompt for fish shell

set -g __prompt_last_bg ""

function __prompt_segment -a bg fg text
    if test -n "$__prompt_last_bg"
        set_color -b $bg $__prompt_last_bg
        echo -n ""
    end
    set -g __prompt_last_bg $bg
    set_color -b $bg $fg
    echo -n " $text "
end

function __prompt_end
    if test -n "$__prompt_last_bg"
        set_color normal
        set_color $__prompt_last_bg
        echo -n ""
        set_color normal
    end
    set -g __prompt_last_bg ""
end

function fish_prompt
    set -l last_status $status
    set -g __prompt_last_bg ""

    # Directory segment — blue
    __prompt_segment blue white (prompt_pwd)

    # Git segment
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1
        set -l branch (git symbolic-ref --short HEAD 2>/dev/null; or echo "detached")
        set -l dirty ""
        if not git diff --quiet 2>/dev/null
            set dirty "✎"
        end
        if not git diff --cached --quiet 2>/dev/null
            set dirty "$dirty+"
        end
        if test -n (git ls-files --others --exclude-standard 2>/dev/null)
            set dirty "$dirty?"
        end

        if test -n "$dirty"
            __prompt_segment yellow black " $branch $dirty"
        else
            __prompt_segment green black " $branch"
        end
    end

    __prompt_end
    echo -n " "
end
