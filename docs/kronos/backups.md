---
sidebar_position: 6
---

# Backups

The scripts in `ktp-api/scripts/backup/` create nightly database and file backups and report results to Discord. This page describes their installation and restore procedures.

## What is backed up

| Target | Container | Script | Contents |
|---|---|---|---|
| `ugaktp_db` | LXC 118 | `backup-postgres.sh` | Portal users, events, documents, and rush records |
| `ugaktp_archive` | LXC 118 | `backup-postgres.sh` | Archived member profiles |
| `uploads/` | LXC 119 | `backup-uploads.sh` | Files stored on API disk, including documents and resumes |
| Authentik | LXC 103 | `backup-authentik.sh` | Identity database and environment configuration |

These scripts do not back up Immich.

Database rows contain file references, not document or resume bytes. The uploads script archives the whole directory so newly added subdirectories are included. This addresses the type of loss seen in August 2026, when resume files were stored outside a persistent Docker volume.

## Before installing: check for `vzdump`

On the Proxmox host, inspect existing container backup jobs and output:

```bash
cat /etc/pve/jobs.cfg
ls -lh /var/lib/vz/dump/
```

Container backups support whole-container recovery. The scripts below provide separate database dumps and file archives for more selective restores. Check the container backup configuration to determine which volumes it includes and how database consistency is handled.

## Install

Copy the backup directory together with `lib.sh`, which the scripts source from beside themselves:

```bash
mkdir -p /usr/local/sbin/ktp-backup
# From a machine with the repo:
# scp -r scripts/backup/* root@<container>:/usr/local/sbin/ktp-backup/
chmod 750 /usr/local/sbin/ktp-backup/*.sh

install -o root -g root -m 600 \
  /usr/local/sbin/ktp-backup/ktp-backup.env.example /etc/ktp-backup.env
nano /etc/ktp-backup.env
```

LXC 119 can run the scripts from its existing `/opt/ktp-api` checkout. Run each applicable script manually and check its output before scheduling it.

### Config

`/etc/ktp-backup.env` contains credentials and the Discord webhook and should remain readable only by root.

| Container | Required container-specific settings |
|---|---|
| LXC 118 | `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASES`, `RESTORE_CHECK_TABLES` |
| LXC 119 | `UPLOADS_DIR` |
| LXC 103 | `AUTHENTIK_PG_CONTAINER`, `AUTHENTIK_DIR` |

Common settings are `BACKUP_DIR`, `KEEP_DAYS`, `LOG_FILE`, and `BACKUP_WEBHOOK_URL`.

The file is sourced by Bash. Quote values containing spaces:

```bash
PGDATABASES="ugaktp_db ugaktp_archive"
```

An unquoted list is not a valid multi-database assignment. The scripts reject this configuration and identify the offending line.

### Cron

The documented schedule staggers the jobs:

```cron
# LXC 118
10 3 * * * /usr/local/sbin/ktp-backup/backup-postgres.sh

# LXC 119
30 3 * * * /opt/ktp-api/scripts/backup/backup-uploads.sh

# LXC 103
50 3 * * * /usr/local/sbin/ktp-backup/backup-authentik.sh
```

## Alerting

Each run posts to Discord: sizes and counts on success, or the failure reason and last eight log lines on failure.

Check for missing reports as well as failure reports. If cron stops, it cannot send its own failure notification. A sudden drop in the uploads entry count can indicate missing source files even when the archive operation succeeds.

## Verifying a backup is real

The scripts decode the generated archive before applying retention. A failed backup does not trigger removal of older backups.

`pg_restore --list` reads the archive's table of contents but does not validate all its data. The backup scripts instead decode the full dump to `/dev/null` to catch damaged or truncated payloads.

To test an actual database restore on LXC 118:

```bash
/usr/local/sbin/ktp-backup/restore-test.sh
```

The script restores the newest dump into a scratch database, compares table and row counts with the live database, reports the result, and removes the scratch database. Run it after installation and after schema changes. Live writes since the backup can account for count differences and should be considered when interpreting results.

## Restoring

### `ugaktp_db`

Stop API writers before restoring. The example preserves the old database under a different name. Confirm that the backup exists, the temporary name is unused, and remaining database connections are closed before renaming.

```bash
# LXC 119
docker compose -f /opt/ktp-api/docker-compose.yml stop api

# LXC 118
psql -d postgres -c 'ALTER DATABASE ugaktp_db RENAME TO ugaktp_db_broken;'
createdb ugaktp_db
pg_restore --no-owner --no-privileges -d ugaktp_db \
  /var/backups/ktp/ugaktp_db-<stamp>.dump
```

After the restore succeeds, check ownership and application access, then start the API and verify the portal:

```bash
docker compose -f /opt/ktp-api/docker-compose.yml start api
```

Keep `ugaktp_db_broken` until the restored data has been checked.

For a single-table recovery, restore the dump to a scratch database and inspect the rows before copying the required data into production. `pg_restore --data-only --table=documents` inserts data; it does not replace or merge existing rows and can fail on duplicate keys.

### `uploads/`

The archive uses paths relative to the uploads directory:

```bash
tar -xzf /var/backups/ktp/uploads-<stamp>.tar.gz -C /opt/ktp-api/uploads
```

This can overwrite matching files. For a single-file recovery, extract into a scratch directory and copy only the required file.

`node scripts/prune-missing-resumes.js` reconciles resume references against disk by clearing references to missing files. Use it only after checking that the required files have been restored; it does not recover missing resumes.

### Authentik

The following procedure replaces the Authentik database. Confirm the backup and preserve the current database before proceeding. Use the actual PostgreSQL container name if it differs from this deployment example.

```bash
cd /opt/authentik
docker compose stop server worker

docker exec -i authentik-postgresql-1 sh -c \
  'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$POSTGRES_DB"'
docker exec -i authentik-postgresql-1 sh -c \
  'pg_restore --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < /var/backups/ktp/authentik-<stamp>.dump
```

Check the restore result and compare `/opt/authentik/.env` with the matching `authentik-env-<stamp>.txt` backup. Preserve the installation's `AUTHENTIK_SECRET_KEY` rather than generating a replacement during recovery.

Then restart:

```bash
docker compose up -d
```

## What this does not cover

The scripts write to local disk on the same containers they protect. Those backups can help with accidental deletion or a bad deploy, but can be lost with the container or its storage.

Off-site copying is not implemented by these scripts. A separate process would need a destination, credentials, retention, and encryption for the member data in the backups.
