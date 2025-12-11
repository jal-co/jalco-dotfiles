export ZSH="$HOME/.oh-my-zsh"
export ZSH_CUSTOM="$ZSH/custom"
export TERM=xterm-256color
export DOCKER_SOCK="$HOME/.docker/run/docker.sock"
export HOMEBREW_NO_ENV_HINTS=1
export GIT_CONFIG_GLOBAL="$HOME/dotfiles/git/.config/git/.gitconfig"
export GPG_TTY=$(tty)


# Silence Docker warnings when socket is missing
docker() {
  command docker "$@" 2>/dev/null
}

###############################################
#                 PATH Setup
###############################################

# Ensure user-installed binaries take priority
export PATH="$HOME/bin:$PATH"

# Homebrew (Universal)
if [ -d /opt/homebrew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# Intel fallback
if [ -d /usr/local/Homebrew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

###############################################
#                Node / pnpm / nvm
###############################################

# pnpm home
export PNPM_HOME="$HOME/Library/pnpm"
export PATH="$PNPM_HOME:$PATH"

# nvm setup
export NVM_DIR="$HOME/.nvm"
if command -v brew >/dev/null 2>&1; then
  NVM_BREW_DIR="$(brew --prefix nvm 2>/dev/null)"
fi

if [[ -n "$NVM_BREW_DIR" && -s "$NVM_BREW_DIR/nvm.sh" ]]; then
  . "$NVM_BREW_DIR/nvm.sh"
elif [[ -s "$NVM_DIR/nvm.sh" ]]; then
  . "$NVM_DIR/nvm.sh"
fi

if [[ -n "$NVM_BREW_DIR" && -s "$NVM_BREW_DIR/etc/bash_completion.d/nvm" ]]; then
  . "$NVM_BREW_DIR/etc/bash_completion.d/nvm"
elif [[ -s "$NVM_DIR/bash_completion" ]]; then
  . "$NVM_DIR/bash_completion"
fi

#flutter
export PATH="$HOME/.flutter-sdk/bin:$PATH"

###############################################
#                      Rust
###############################################

export PATH="$HOME/.cargo/bin:$PATH"

###############################################
#                     Python
###############################################

export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
if command -v pyenv >/dev/null 2>&1; then
  eval "$(pyenv init -)"
fi

# Python framework path
export PATH="/Library/Frameworks/Python.framework/Versions/3.11/bin:$PATH"

###############################################
#                 JavaScript Tools
###############################################

# Bun (optional)
[ -d "$HOME/.bun/bin" ] && export PATH="$HOME/.bun/bin:$PATH"

###############################################
#                  VSCode
###############################################

# Enable "code" CLI
if [ -x "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then
  export PATH="/Applications/Visual Studio Code.app/Contents/Resources/app/bin:$PATH"
fi

###############################################
#                   Golang (optional)
###############################################

if [ -d "$HOME/go/bin" ]; then
  export GOPATH="$HOME/go"
  export PATH="$GOPATH/bin:$PATH"
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
  history
  common-aliases
  vscode
  brew
  macos
  starship
  node
  npm
  yarn
  rust
  docker
  bgnotify
  zoxide
  eza
  fzf
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

###############################################
#                   Navigation
###############################################

alias ..="cd .."
alias ...="cd ../.."
alias ....="cd ../../.."
alias ~="cd ~"

# Your GitHub workspace
alias gotogit="cd ~/Documents/GitHub"

# Quick project jumps
alias fmml="cd ~/Documents/GitHub/FMMLoader-26"
alias docs="cd ~/Documents/GitHub/FMMLoader26-Docs"

###############################################
#                   Git
###############################################

alias gs="git status"
alias ga="git add ."
alias gaa="git add -A"
alias gb="git branch"
alias gco="git checkout"
alias gcm="git commit -m"
alias gamend="git commit --amend"
alias gpl="git pull"
alias gp="git push"
alias gpu="git push -u origin HEAD"
alias gsta="git stash"
alias gstaapply="git stash apply"

# Sync fork with upstream (your repos often have upstream links)
alias gsync="git fetch upstream && git merge upstream/main"

# Clean up branches
alias gclean="git branch --merged | grep -v main | xargs git branch -d"

###############################################
#               GitHub CLI (gh)
###############################################

alias pr="gh pr create --fill"
alias prview="gh pr view --web"
alias issues="gh issue list"
alias release="gh release create"
alias repo="gh repo view --web"

###############################################
#                Node / npm / pnpm
###############################################

alias nr="npm run"
alias ni="npm install"
alias nis="npm install --save"
alias nid="npm install --save-dev"

alias pi="pnpm install"
alias prun="pnpm run"
alias pdev="pnpm dev"

alias nuke="rm -rf node_modules && rm -f package-lock.json && npm install"
alias pnukenpm="rm -rf node_modules && rm -f pnpm-lock.yaml && pnpm install"

###############################################
#                     Tauri
###############################################

alias tauri:dev="npm run tauri dev"
alias tauri:build="npm run tauri build"
alias tauri:clean="cargo clean && rm -rf src-tauri/target"

###############################################
#                     Rust
###############################################

alias c="cargo"
alias cb="cargo build"
alias cr="cargo run"
alias ct="cargo test"
alias cclippy="cargo clippy"
alias cfmt="cargo fmt"

###############################################
#                     Python
###############################################

alias python="python3"
alias pip="pip3"
alias venv="python3 -m venv .venv && source .venv/bin/activate"

###############################################
#                     Docker
###############################################

alias d="docker"
alias dps="docker ps"
alias dimg="docker images"
alias dstop="docker stop $(docker ps -aq)"
alias drm="docker rm $(docker ps -aq)"
alias drmi="docker rmi $(docker images -q)"

###############################################
#                     System
###############################################

# Quick edits
alias zshconfig="nano ~/.zshrc"
alias zshreload="source ~/.zshrc"

# Safe deletes
alias rm="rm -i"

# Mac utilities
alias flushdns="sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder"

###############################################
#               Productivity
###############################################

# Open current folder in VSCode
alias o.="open ."
alias code.="code ."

# Open current folder in Zed
alias zed="zed ."
# Quick server
alias serve="python3 -m http.server"

###############################################
#               FMML / Building
###############################################

alias fmml:dev="cd ~/Documents/GitHub/FMMLoader-26 && pnpm dev"
alias fmml:actions="cd ~/Documents/GitHub/FMMLoader-26/.github/workflows"

###############################################
#               Fun / QoL
###############################################

alias please="sudo"
alias fuck="sudo !!"
alias shrug='echo "¯\\_(ツ)_/¯"'

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

( fastfetch )