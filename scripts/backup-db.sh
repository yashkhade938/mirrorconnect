#!/usr/bin/env bash
# Automated PostgreSQL Backup Script with 7-4-12 Retention
# Retention: 7 Daily, 4 Weekly, 12 Monthly

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/mirrorconnect}"
CONTAINER_NAME="${CONTAINER_NAME:-mirrorconnect-postgres}"
DB_USER="${POSTGRES_USER:-mirrorconnect}"
DB_NAME="${POSTGRES_DB:-mirrorconnect}"

DATE_DAILY=$(date +%Y-%m-%d)
DATE_WEEKLY=$(date +%G-W%V)
DATE_MONTHLY=$(date +%Y-%m)

DAILY_DIR="${BACKUP_DIR}/daily"
WEEKLY_DIR="${BACKUP_DIR}/weekly"
MONTHLY_DIR="${BACKUP_DIR}/monthly"

mkdir -p "${DAILY_DIR}" "${WEEKLY_DIR}" "${MONTHLY_DIR}"

echo "[$(date)] Starting PostgreSQL backup for ${DB_NAME}..."

# Create compressed sql dump
BACKUP_FILE="${DAILY_DIR}/mirrorconnect_${DATE_DAILY}.sql.gz"
docker exec "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" "${DB_NAME}" | gzip > "${BACKUP_FILE}"

echo "[$(date)] Daily backup saved to ${BACKUP_FILE}"

# Weekly backup (Run on Sundays)
if [ "$(date +%u)" -eq 7 ]; then
  cp "${BACKUP_FILE}" "${WEEKLY_DIR}/mirrorconnect_weekly_${DATE_WEEKLY}.sql.gz"
  echo "[$(date)] Weekly backup saved."
fi

# Monthly backup (Run on 1st of month)
if [ "$(date +%d)" -eq "01" ]; then
  cp "${BACKUP_FILE}" "${MONTHLY_DIR}/mirrorconnect_monthly_${DATE_MONTHLY}.sql.gz"
  echo "[$(date)] Monthly backup saved."
fi

# Retention Cleanup
echo "[$(date)] Cleaning old backups..."

# Retain 7 daily backups
find "${DAILY_DIR}" -type f -name "mirrorconnect_*.sql.gz" -mtime +7 -exec rm -f {} \;

# Retain 4 weekly backups
find "${WEEKLY_DIR}" -type f -name "mirrorconnect_weekly_*.sql.gz" -mtime +28 -exec rm -f {} \;

# Retain 12 monthly backups
find "${MONTHLY_DIR}" -type f -name "mirrorconnect_monthly_*.sql.gz" -mtime +365 -exec rm -f {} \;

echo "[$(date)] Backup rotation completed successfully."
