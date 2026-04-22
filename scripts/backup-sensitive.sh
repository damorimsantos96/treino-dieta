#!/usr/bin/env bash
set -euo pipefail

# Troque "gdrive" por "onedrive" se preferir OneDrive
REMOTE="gdrive:treino-dieta-backup"
REPO_ROOT="$(git rev-parse --show-toplevel)"

echo "📦 Backup de arquivos sensíveis → $REMOTE"

FILES=(
  ".env.local"
  "scripts/.env"
  "Dieta e Treino.xlsx"
)

for f in "${FILES[@]}"; do
  src="$REPO_ROOT/$f"
  dir="$(dirname "$f")"
  if [[ "$dir" == "." ]]; then
    dest_dir="$REMOTE"
  else
    dest_dir="$REMOTE/$dir"
  fi
  if [[ -e "$src" ]]; then
    rclone copy "$src" "$dest_dir/" --quiet
    echo "  ✓ $f"
  else
    echo "  ⚠ $f não encontrado, pulando"
  fi
done

echo "✅ Backup concluído"
