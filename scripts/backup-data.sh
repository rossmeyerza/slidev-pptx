#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR_VALUE="${DECKHAND_DATA_DIR:-.data}"
if [[ "$DATA_DIR_VALUE" = /* ]]; then
  DATA_DIR="$DATA_DIR_VALUE"
else
  DATA_DIR="$ROOT_DIR/$DATA_DIR_VALUE"
fi
BACKUP_DIR="$ROOT_DIR/backups"

restore_archive() {
  local archive="$1"
  if [[ "$archive" != /* ]]; then
    archive="$ROOT_DIR/$archive"
  fi
  if [[ ! -f "$archive" ]]; then
    printf 'Backup archive not found: %s\n' "$archive" >&2
    exit 1
  fi

  mkdir -p "$DATA_DIR"
  tar --extract --gzip --file "$archive" --directory "$DATA_DIR" --no-same-owner
  printf 'Restored %s into %s\n' "$archive" "$DATA_DIR"
  printf 'Existing files not present in the archive were left unchanged.\n'
}

if [[ "${1:-}" == "--restore" ]]; then
  if [[ $# -ne 2 ]]; then
    printf 'Usage: %s --restore <archive>\n' "$0" >&2
    exit 1
  fi
  restore_archive "$2"
  exit 0
fi

if [[ $# -ne 0 ]]; then
  printf 'Usage: %s [--restore <archive>]\n' "$0" >&2
  exit 1
fi

if [[ ! -d "$DATA_DIR" ]]; then
  printf 'Data directory not found: %s\n' "$DATA_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="$BACKUP_DIR/deckhand-data-$TIMESTAMP.tar.gz"

tar --create --gzip --file "$ARCHIVE" \
  --directory "$DATA_DIR" \
  --exclude='./logs' \
  --exclude='./thumbnails' \
  --exclude='./exports' \
  --exclude='*-tmp' \
  --exclude='node_modules' \
  .

SIZE="$(du -h "$ARCHIVE" | awk '{print $1}')"
printf 'Backup created: %s\n' "$ARCHIVE"
printf 'Archive size: %s\n' "$SIZE"
