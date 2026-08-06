# MirrorConnect Backup Strategy & Disaster Recovery Manual

This document defines the automated database backup, retention policy, and restoration procedure for MirrorConnect's PostgreSQL database.

---

## 1. Backup Retention Policy (7-4-12 Strategy)

- **Daily Backups**: Retained for **7 days** (stored in `/var/backups/mirrorconnect/daily`).
- **Weekly Backups**: Executed every Sunday, retained for **4 weeks** (stored in `/var/backups/mirrorconnect/weekly`).
- **Monthly Backups**: Executed on the 1st of every month, retained for **12 months** (stored in `/var/backups/mirrorconnect/monthly`).

---

## 2. Automated Cron Setup

Make the backup script executable and configure a daily system cron job:

```bash
chmod +x scripts/backup-db.sh
sudo mkdir -p /var/backups/mirrorconnect
```

Edit root crontab (`crontab -e`) and add the following entry:

```cron
# Execute MirrorConnect database backup daily at 2:00 AM
0 2 * * * /bin/bash /path/to/mirrorconnect/scripts/backup-db.sh >> /var/log/mirrorconnect-backup.log 2>&1
```

---

## 3. Manual Backup Execution

To trigger an on-demand database snapshot at any time:

```bash
./scripts/backup-db.sh
```

---

## 4. Disaster Recovery & Restoration Procedure

To restore a database snapshot from a `.sql.gz` backup file:

1. **Stop Application Backend**:
   ```bash
   docker compose stop backend
   ```

2. **Restore Database Dump**:
   ```bash
   gunzip -c /var/backups/mirrorconnect/daily/mirrorconnect_YYYY-MM-DD.sql.gz | \
     docker exec -i mirrorconnect-postgres psql -U mirrorconnect -d mirrorconnect
   ```

3. **Restart Backend Service**:
   ```bash
   docker compose start backend
   ```

4. **Verify System Integrity**:
   ```bash
   curl https://mirror.yourdomain.com/health
   ```
