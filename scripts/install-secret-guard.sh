#!/usr/bin/env bash
# Installs a git pre-commit hook that refuses to commit anything containing
# an API-key-shaped string.
#
# Why: .gitignore already covers credentials.txt and .env, and a full history
# scan on 2026-09-09 came back clean. But .gitignore only protects the files
# someone remembered to name. It does nothing about a key pasted into a
# config, a test fixture, a README example, or a debug console.log — which is
# how keys usually escape. This is the backstop for that case.
#
# Hooks live in .git/hooks/, which git does not track, so the hook itself
# can't be version-controlled — hence this installer. Run once per clone:
#
#   bash scripts/install-secret-guard.sh
#
# To bypass for a deliberate false positive: git commit --no-verify

set -euo pipefail

HOOK_DIR="$(git rev-parse --git-dir)/hooks"
HOOK="$HOOK_DIR/pre-commit"

mkdir -p "$HOOK_DIR"

cat > "$HOOK" <<'HOOK_EOF'
#!/usr/bin/env bash
# Blocks commits containing API-key-shaped strings.
# Installed by scripts/install-secret-guard.sh — edit there, not here.
set -uo pipefail

# Provider prefixes that are unambiguous enough not to false-positive on
# ordinary code. Deliberately does NOT include bare "sk-" style patterns
# without a length floor, which match too much prose.
PATTERNS=(
  'gsk_[A-Za-z0-9]{40,}'          # Groq
  'AIza[A-Za-z0-9_-]{30,}'        # Google / YouTube
  'sk-[A-Za-z0-9]{32,}'           # OpenAI-style
  'sk-or-v1-[A-Za-z0-9]{32,}'     # OpenRouter
  'fc-[A-Za-z0-9]{32,}'           # Firecrawl
  'sb_secret_[A-Za-z0-9_-]{20,}'  # Supabase secret
  # JWT header (Supabase anon/service keys). The character class around the
  # N is not cosmetic: without it this literal appears verbatim in this file,
  # and the hook blocks its own installer. Found by the hook doing exactly
  # that on first commit.
  'eyJhbGciOiJIUzI1[N]iIs'
  'ghp_[A-Za-z0-9]{36}'           # GitHub PAT
  'github_pat_[A-Za-z0-9_]{50,}'  # GitHub fine-grained PAT
)

staged="$(git diff --cached --name-only --diff-filter=ACM)"
[ -z "$staged" ] && exit 0

found=0
while IFS= read -r file; do
  [ -f "$file" ] || continue
  # Skip binaries and the big scraped-output CSVs (they're lead data, not code,
  # and scanning tens of MB on every commit makes the hook unusable).
  case "$file" in
    output/*.csv|*.png|*.jpg|*.jpeg|*.gif|*.pdf|*.parquet) continue ;;
  esac
  for pat in "${PATTERNS[@]}"; do
    if git show ":$file" 2>/dev/null | grep -qE "$pat"; then
      echo "BLOCKED: $file appears to contain a live API key (pattern: $pat)"
      found=1
    fi
  done
done <<< "$staged"

if [ "$found" -ne 0 ]; then
  cat <<'MSG'

Commit refused — a staged file looks like it contains a real credential.

  - If it IS a key: remove it, put it in credentials.txt (gitignored), and
    run `bash scripts/sync-secrets.sh` to push it to GitHub Actions secrets.
  - If it's a false positive (an example, a test fixture): re-run with
    `git commit --no-verify`.

MSG
  exit 1
fi
exit 0
HOOK_EOF

chmod +x "$HOOK"
echo "Installed pre-commit secret guard at $HOOK"
echo "Test it with:  echo 'gsk_$(printf 'a%.0s' {1..45})' > /tmp/leaktest.txt && git add -f /tmp/leaktest.txt"
