export ZSH="$HOME/.oh-my-zsh"
export ZSH_CUSTOM="$ZSH/custom"
export TERM=xterm-256color
export DOCKER_SOCK="$HOME/.docker/run/docker.sock"
export HOMEBREW_NO_ENV_HINTS=1
export ALEXANDRIA_GAPS=auto
export ALEXANDRIA_MODEL=anthropic/claude-sonnet-5-5
export GPG_TTY=$(tty)


# Silence Docker warnings when socket is missing
docker() {
  command docker "$@" 2>/dev/null
}

###############################################
#                 PATH Setup
###############################################

# Homebrew (Universal)
if [ -d /opt/homebrew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# Intel fallback
if [ -d /usr/local/Homebrew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

###############################################
#                Node / pnpm / mise
###############################################

# pnpm home
export PNPM_HOME="$HOME/Library/pnpm"
export PATH="$PNPM_HOME:$PATH"
if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    alias pnpm="corepack pnpm"
  fi
fi

# mise: manages node + python versions (replaces nvm, pyenv)
if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate zsh)"
fi


###############################################
#               Shell Environment
###############################################

export EDITOR="nano"
export VISUAL="nano"
export PAGER="less"

###############################################
#             Local Secrets Override
###############################################
# ~/.zshrc.local should hold:
#   - API keys
#   - tokens
#   - custom machine-specific paths
#   (Do NOT commit ~/.zshrc.local to git)
###############################################

plugins=(
  git
  fzf
  bgnotify
)

# eza colors tuned to Vercel/Geist palette
# di=directory (blue), ln=symlink (cyan), ex=executable (green)
# or=orphan (red), mi=missing (bright red), sn=socket (yellow)
export EZA_COLORS="di=34:ln=36:ex=32:or=31:mi=1;31:sn=33:bd=33:cd=33:pi=33:so=35"
export ZOXIDE_CMD_OVERRIDE=cd
eval "$(zoxide init zsh)"

zi() {
    local dir
    dir=$(zoxide query -l | fzf --height 40% --reverse --prompt="jump to: ") && cd "$dir"
}

source "$ZSH/oh-my-zsh.sh"

# Prefer eza over ls
alias ls="eza --icons --group-directories-first"
alias l="eza --icons --group-directories-first"
alias ll="eza -l --icons --group-directories-first --links"
alias la="eza -la --icons --group-directories-first --links"
alias lt="eza -T --icons --group-directories-first"
alias llt="eza -lT --icons --group-directories-first --links"
alias lf="eza -l --no-user --no-time --no-permissions --icons"

# Pre-PR slop lint (vendored dmmulroy/anti-slop oxlint plugin)
alias anti-slop="$HOME/dotfiles/tools/anti-slop/bin/anti-slop"

alias ..="cd .."
alias ...="cd ../.."
alias ....="cd ../../.."
alias ~="cd ~"

alias gotogit="cd ~/Documents/GitHub"
alias dotfiles="cd ~/dotfiles"

# Safe deletes
alias rm="rm -i"

autoload -U compinit
compinit

HISTSIZE=5000
SAVEHIST=5000
HISTFILE="$HOME/.zsh_history"

setopt HIST_IGNORE_DUPS
setopt HIST_VERIFY
setopt AUTO_CD
setopt AUTO_PUSHD
setopt PUSHD_IGNORE_DUPS


eval "$(starship init zsh)"

# Local overrides
if [[ -f "$HOME/.zshrc.local" ]]; then
  source "$HOME/.zshrc.local"
fi

# Created by `pipx` on 2025-12-30 22:48:38
export PATH="$PATH:/Users/justin/.local/bin"

# Vite+ bin (https://viteplus.dev)
. "$HOME/.config/vite-plus/env"
