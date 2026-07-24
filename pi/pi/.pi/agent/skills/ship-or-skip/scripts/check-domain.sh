#!/usr/bin/env bash
# check-domain.sh — best-effort domain availability check.
# Usage: scripts/check-domain.sh example.com example.io getexample.com
#
# Tries `whois`, falls back to `dig`. Output is a heuristic, NOT authoritative —
# only a registrar's checkout confirms availability.

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <domain> [domain ...]" >&2
  exit 1
fi

have() { command -v "$1" >/dev/null 2>&1; }

check_whois() {
  local domain="$1" out
  out="$(whois "$domain" 2>/dev/null || true)"
  if [ -z "$out" ]; then
    return 2
  fi
  # Common "available" markers across registries.
  if printf '%s' "$out" | grep -qiE 'no match|not found|no data found|no entries found|status:[[:space:]]*free|available for registration'; then
    return 0   # available
  fi
  # Common "registered" markers.
  if printf '%s' "$out" | grep -qiE 'creation date|registrar:|registry expiry|domain status|name server|nserver'; then
    return 1   # taken
  fi
  return 2     # unknown
}

check_dig() {
  local domain="$1"
  if [ -n "$(dig +short NS "$domain" 2>/dev/null)" ] || [ -n "$(dig +short A "$domain" 2>/dev/null)" ]; then
    return 1   # has records -> taken
  fi
  return 2     # no records -> weak/unknown signal
}

for domain in "$@"; do
  status="unknown"
  if have whois; then
    if check_whois "$domain"; then status="available";
    else case $? in 1) status="taken";; *) status="unknown";; esac; fi
  fi
  if [ "$status" = "unknown" ] && have dig; then
    if check_dig "$domain"; then :; else case $? in 1) status="taken";; *) status="possibly available";; esac; fi
  fi
  if ! have whois && ! have dig; then
    status="unknown (install whois or dig, or check at a registrar)"
  fi
  printf '%-30s %s\n' "$domain" "$status"
done
