---
sidebar_position: 6
---

# Backups

Nightly backups for the chapter's data. Four targets across three containers,
each verified before it is trusted, each reporting to Discord.

Scripts live in `ktp-api/scripts/backup/`. This page is the operational
reference; the comments in those scripts carry the reasoning behind each
decision.

## What is backed up

| What | Container | Script | Why it needs its own backup |
|---|---|---|---|
| `ugaktp_db` | LXC 118 | `backup-postgres.sh` | The portal: members, events, documents, rush |
| `ugaktp_archive` | LXC 118 | `backup-postgres.sh` | Nothing that backs up `ugaktp_db` covers it. It holds the only copy of an archived member profile |
| `uploads/` | LXC 119 | `backup-uploads.sh` | Documents and resumes exist **only** on disk. Postgres stores the filename, not the file |
| Authentik | LXC 103 | `backup-authentik.sh` | Every account, group and OIDC provider. A restored `ugaktp_db` with no Authentik is a database nobody can sign in to |

Immich is **not** backed up by these scripts. Photos have their own copies and
the library is far larger than these dumps.

:::danger A database dump is not a backup of this system
Rushee resumes were destroyed on 2026-08-31 by an ordinary deploy:
`uploads/resumes` was not a Docker volume, and the deploy rebuilds the
container on every push to `main`. The database rows survived. The files did
not.

A `pg_dump` would not have saved a single one of them. That is why the list
above has four rows and not two, and why `backup-uploads.sh` archives the
**whole** `uploads/` directory rather than a list of known subdirectories: a
whitelist would recreate the exact bug that caused the loss.
:::

## Before installing: check for `vzdump`

Proxmox may already take container-level backups, which changes what these
scripts are for. On the **Proxmox host**:

```bash
cat /etc/pve/jobs.cfg        # scheduled vzdump jobs, if any
ls -lh /var/lib/vz/dump/     # what they have actually produced
```

A `vzdump` is a whole-container image. It is the right tool for "the container
is gone" and the wrong tool for "restore one table" or "recover last week's
resume", and it says nothing about whether the Postgres inside it was
consistent when the snapshot was taken. These scripts cover the other half.

## Install

The same three steps on each container. `scripts/backup/` is copied **as a
directory**, because every script sources `lib.sh` from beside itself.

```bash
mkdir -p /usr/local/sbin/ktp-backup
# from a machine with the repo:
#   scp -r scripts/backup/* root@<container>:/usr/local/sbin/ktp-backup/
chmod 750 /usr/local/sbin/ktp-backup/*.sh

install -o root -g root -m 600 \
  /usr/local/sbin/ktp-backup/ktp-backup.env.example /etc/ktp-backup.env
nano /etc/ktp-backup.env
```

LXC 119 already has the repo at `/opt/ktp-api`, so it can run the scripts from
there instead of copying them.

Then **run the script once by hand** before adding it to cron.

### Config

`/etc/ktp-backup.env` is mode 600 and holds the Postgres password and the
Discord webhook. That is why no credential appears in any script in the repo.

Only the lines a container actually needs have to be present:

| Container | Needs |
|---|---|
| LXC 118 | `PGHOST` `PGUSER` `PGPASSWORD` `PGDATABASES` `RESTORE_CHECK_TABLES` |
| LXC 119 | `UPLOADS_DIR` |
| LXC 103 | `AUTHENTIK_PG_CONTAINER` `AUTHENTIK_DIR` |

Plus `BACKUP_DIR`, `KEEP_DAYS`, `LOG_FILE` and `BACKUP_WEBHOOK_URL` everywhere.

:::warning Keep the quotes on multi-value settings
This file is **sourced** by bash, so

```bash
PGDATABASES=ugaktp_db ugaktp_archive     # WRONG
```

does not set two databases. Bash assigns the first word and then tries to run
`ugaktp_archive` as a command. Write it as:

```bash
PGDATABASES="ugaktp_db ugaktp_archive"   # correct
```

The scripts refuse to start on an unquoted value containing spaces, and name
the offending line, rather than let anyone believe two databases are being
backed up when one is.
:::

### Cron

Staggered so three containers do not all hit disk and network at once.

```cron
# LXC 118
10 3 * * * /usr/local/sbin/ktp-backup/backup-postgres.sh

# LXC 119
30 3 * * * /opt/ktp-api/scripts/backup/backup-uploads.sh

# LXC 103
50 3 * * * /usr/local/sbin/ktp-backup/backup-authentik.sh
```

## Alerting

Cron mail goes nowhere on these containers, and `ugaktp.com` is flagged by
McAfee, so mail is not the answer. **Discord is the alerting**, using the same
webhook pattern as the deploy workflows.

Each run posts one message: green with sizes and counts on success, red with
the failure reason and the last eight log lines on failure.

The nightly green line is deliberate. Failure-only alerting cannot tell
"healthy" apart from "cron stopped three weeks ago", and those two look
identical right up until somebody needs a restore.

The uploads message includes an **entry count**. That is the one number that
makes a silent wipe visible: if it reads 412 every night and then reads 6, the
files are already gone, and that line is where a human notices.

## Verifying a backup is real

Every script decodes its own output before trusting it, and **retention only
runs after that check passes**. Deleting first, or deleting on a failed run, is
how a broken job quietly becomes no backups at all: the failure and the loss of
history would arrive together.

:::note `pg_restore --list` is not enough, measured
The obvious check is `pg_restore --list`, which reads the archive's table of
contents. Tested against a deliberately truncated dump, it **passes** files cut
to 99%, 95%, 90% and 75% of their length, because the table of contents sits
near the front and truncation removes the end. Disk-full truncation is exactly
the case it cannot see.

The scripts therefore decode the entire archive to `/dev/null`, which catches
every one of those cases including the last 100 bytes being missing, and costs
a fraction of a second.
:::

Even that only proves the file decodes. To prove it **restores**, on LXC 118:

```bash
/usr/local/sbin/ktp-backup/restore-test.sh
```

It restores the newest dump into a scratch database, compares the table count
and row counts against the live database, prints a verdict, and drops the
scratch database on the way out, including on Ctrl-C. Run it after installing,
and again after any migration that changes the schema.

Row counts matter as much as the table count: a dump truncated to 90% restores
all three tables and zero rows, which a schema-only check would call a pass.

## Restoring

### `ugaktp_db`

Stop the API first so nothing writes during the restore, and **rename rather
than drop**, so the broken database is still there if the restore itself goes
wrong.

```bash
# LXC 119: stop writers
docker compose -f /opt/ktp-api/docker-compose.yml stop api

# LXC 118
psql -d postgres -c 'ALTER DATABASE ugaktp_db RENAME TO ugaktp_db_broken;'
createdb ugaktp_db
pg_restore --no-owner --no-privileges -d ugaktp_db \
  /var/backups/ktp/ugaktp_db-<stamp>.dump

# LXC 119: start again, then verify in the portal
docker compose -f /opt/ktp-api/docker-compose.yml start api
```

Drop `ugaktp_db_broken` only once the portal has been used and looks right.

For the more common case of pulling back a single table:

```bash
pg_restore --data-only --table=documents -d ugaktp_db /var/backups/ktp/<file>.dump
```

### `uploads/`

```bash
# LXC 119. Paths inside the archive are relative, so this puts
# documents/ and resumes/ back where they belong.
tar -xzf /var/backups/ktp/uploads-<stamp>.tar.gz -C /opt/ktp-api/uploads
```

For one file, extract to a scratch directory and copy just that file across
rather than overwriting the whole tree. After restoring resumes, run
`node scripts/prune-missing-resumes.js` to reconcile the rows against disk.

### Authentik

```bash
cd /opt/authentik
docker compose stop server worker

docker exec -i authentik-postgresql-1 sh -c \
  'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$POSTGRES_DB"'
docker exec -i authentik-postgresql-1 sh -c \
  'pg_restore --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < /var/backups/ktp/authentik-<stamp>.dump

docker compose up -d
```

:::warning Check the secret key before starting
Compare `/opt/authentik/.env` against the matching `authentik-env-<stamp>.txt`
saved the same night. `AUTHENTIK_SECRET_KEY` signs sessions and tokens: a
restored database paired with a newly generated key is not the same
installation, and stored credentials will not decrypt.

That is why `backup-authentik.sh` saves two files and not one.
:::

## What this does not cover

Everything above writes to local disk on the same container as the data it
protects. That covers a bad deploy, an accidental delete and a corrupted table.
It does **not** cover the disk failing, the container being destroyed, or
ransomware.

Off-site copies need a destination, credentials on each container, and
**encryption before upload**, since these dumps are full of member PII and would
be leaving hardware the chapter controls. That work is not built yet.
