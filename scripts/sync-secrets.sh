#!/usr/bin/env bash
# Sync API keys from the local (gitignored) credentials.txt into GitHub Actions
# secrets, so rotating a key is one command instead of one command per key.
#
# Why this exists: keys live in credentials.txt for the human's own reference,
# but the scrapers only ever read them from GitHub Actions secrets — the
# scheduled workflows run on GitHub's runners, not this machine. Those two
# places drift, and when they do the failure is silent and expensive: a dead
# GROQ_KEY_1 sat broken for three weeks in Aug-Sep 2026, returning 401 on
# every enrichment call, because nothing connected "the key in my file" to
# "the key the runner uses".
#
# Nothing is read or echoed to a terminal that could end up in a log: values
# are piped straight from the file into `gh secret set`, never printed.
#
# Usage:
#   bash scripts/sync-secrets.sh --dry-run   # show what WOULD be set
#   bash scripts/sync-secrets.sh             # actually set them
#
# Add a new key by putting a line in credentials.txt like
#   groq_api_key_2 = gsk_...
# and adding a "credentials.txt label -> GitHub secret name" pair to MAPPING.

set -euo pipefail

CRED_FILE="${CRED_FILE:-credentials.txt}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

if [[ ! -f "$CRED_FILE" ]]; then
  echo "error: $CRED_FILE not found. Run this from the repo root." >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "error: GitHub CLI (gh) not installed or not on PATH." >&2
  echo "       Install from https://cli.github.com/ then run: gh auth login" >&2
  exit 1
fi

# credentials.txt label  ->  GitHub Actions secret name
MAPPING=(
  "youtube_api_key:YOUTUBE_API_KEY"
  "groq_api_key:GROQ_KEY_1"
  "groq_api_key_2:GROQ_KEY_2"
  "groq_api_key_3:GROQ_KEY_3"
  "openrouter_api_key:OPENROUTER_API_KEY"
  "firecrawl_api_key:FIRECRAWL_API_KEY"
)

set_count=0
skip_count=0

for pair in "${MAPPING[@]}"; do
  label="${pair%%:*}"
  secret="${pair##*:}"

  # Exact label match at line start, so groq_api_key does not also match
  # groq_api_key_2. Value is everything after the first '=', trimmed.
  value="$(grep -E "^[[:space:]]*${label}[[:space:]]*=" "$CRED_FILE" 2>/dev/null \
            | head -1 | cut -d'=' -f2- | xargs || true)"

  if [[ -z "$value" ]]; then
    echo "  skip  $secret  (no '$label' line in $CRED_FILE)"
    skip_count=$((skip_count + 1))
    continue
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    # Never print the value — only that one was found, and its length.
    echo "  would set  $secret  (from '$label', ${#value} chars)"
  else
    printf '%s' "$value" | gh secret set "$secret"
  fi
  set_count=$((set_count + 1))
done

echo ""
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "dry run: $set_count would be set, $skip_count skipped. Re-run without --dry-run to apply."
else
  echo "done: $set_count secrets set, $skip_count skipped."
  echo "verify with: gh secret list"
fi
