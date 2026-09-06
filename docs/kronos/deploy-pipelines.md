---
sidebar_position: 7
---

# Deploy pipelines

How code reaches production for the two deployed repositories, and what stops
it when something is wrong. Both pipelines were rebuilt on 2026-09-06; before
that each one ran `git pull` and `docker compose up`, then announced success to
Discord as soon as the container **started**. Nothing ran the tests, nothing
checked the database schema, and nothing asked the application whether it
actually worked.

The two repositories deploy on deliberately different schedules. That is not an
oversight, and the reason is at the bottom of this page.

## At a glance

| | `uga-ktp-website` | `ktp-api` |
| --- | --- | --- |
| Runs on | LXC 116 (`10.0.0.18`) | LXC 119 (`10.0.0.53`) |
| Workflow name | Website Deployment | API Deployment |
| Push to `main` deploys | Only if `DEPLOY_ON_PUSH` is `true` (currently unset) | Yes |
| Nightly | 11:59 PM America/New_York | No |
| Manual | Actions > Run workflow | Actions > Run workflow |
| Verification | ESLint + auth regression tests | Full test suite against a real Postgres |
| Migration guard | Not applicable | Yes, blocks the deploy |
| Health gate | Not yet | Polls `/health` |
| Typical run | About 3 minutes | About 6 minutes |

## Website pipeline

Trigger: push to `main`, a nightly schedule, or a manual dispatch.

1. **`verify`** runs the reusable `lint.yml` on a GitHub-hosted runner: ESLint,
   then the authentication regression suites
   (`test-attendance-auth`, `test-platform-auth`, `test-proxy-auth`).
   Pull requests run the same checks.
2. **`deploy`** needs `verify` and runs on the self-hosted runner. It fetches
   `origin/main`, refuses a commit that is not an ancestor of it, then resets
   to the exact revision that was verified rather than to whatever `main`
   points at by now.
3. **Already-deployed check.** The server records the last deployed revision in
   `.git/ktp-deployed-sha`. A scheduled or push run skips a revision already
   deployed, and skips an older revision when a newer descendant was recorded,
   so a queued run cannot overwrite something newer. A manual dispatch ignores
   the marker, which is how you redeploy after changing the environment.
4. **Build and swap**, then prune images and build cache older than a week.

### Push deployment is off by default

`vars.DEPLOY_ON_PUSH` is a repository variable, currently **unset**, so pushes
verify but do not deploy. Production updates at 11:59 PM, or when somebody runs
the workflow by hand.

This surprises people, because a push produces a **green** run that deployed
nothing. That is correct behaviour: the deploy job is skipped, not failed.

To change it: **Settings > Secrets and variables > Actions > Variables**, then
create or edit `DEPLOY_ON_PUSH` and set it to `true` or `false`. Leaving it
unset is the disabled default. Nightly and manual deployment are unaffected
either way.

### Nightly runs usually do nothing

Because of the deployed-revision marker, a nightly run with no new commits logs
`This revision was already deployed; skipping` and exits. Seeing that in the
log means the marker is working, not that the schedule is broken.

## API pipeline

Trigger: push to `main`, or a manual dispatch. **There is no nightly run and no
`DEPLOY_ON_PUSH` gate: pushing to `main` deploys.**

| Stage | What it does | If it fails |
| --- | --- | --- |
| `verify` | Whole suite on a GitHub-hosted runner against a `postgres:16-alpine` service, with `TEST_DATABASE_URL` set | Deploy job never starts |
| SHA ancestry | Refuses a commit that is not an ancestor of `origin/main` | Deploy aborts |
| build | `docker compose build` | Deploy aborts, old container still serving |
| **migration guard** | `scripts/check-migrations.js` compares `migrations/` against the `pgmigrations` table | **Deploy aborts and names the missing file. Production untouched** |
| swap | `docker compose up -d` | Failure notification |
| health gate | Polls `http://127.0.0.1:4000/health` every 2s for up to 60s | Deploy FAILS and dumps the last 50 log lines, even though the container started |
| cleanup | Prunes images and build cache older than a week | Cannot fail the deploy |

Discord reports success only when every stage passed, and the embed carries
`Verified: tests + migrations + /health`.

`TEST_DATABASE_URL` is set explicitly in CI for a reason: without it the
database-backed tests **skip** rather than fail, which would leave the gate
looking green while testing a fraction of the suite.

### Run migrations before pushing

This inverts the old order and is the thing most likely to catch you out. The
deploy used to be "ship the code, then SSH and migrate", which meant new code
could run against the old schema behind a green tick. The guard refuses that
now, so a push carrying a new migration file fails until it is applied:

```bash
# On LXC 119, before pushing code that needs it
cd /opt/ktp-api
docker compose run --rm api npm run migrate up
```

Then push, or re-run the workflow from the Actions tab.

**A refusal is not damage.** It happens after the build but before the
container swap, so the running API is untouched and still serving. You lose a
build, not an API.

An applied migration whose **file** is gone, usually after a rename, only
warns. Deploying cannot fix that and the live schema is not wrong.

### The health gate

`GET /health` runs `SELECT 1`, so a `200` proves the process serves traffic
**and** can reach Postgres. "The container started" was the old signal, and it
is the one that lied: a container with a wrong `DATABASE_URL` starts perfectly
and then serves 500s.

The gate polls rather than sleeping, because the API is usually up in a second
or two and a fixed wait is either wasted time or too short.

## Why the two schedules differ

An API change usually follows a migration that was just applied by hand, and
waiting until 11:59 PM to pick it up would be worse than deploying promptly now
that a real verification gate exists. Website changes carry no schema step, so
batching them away from the working day costs nothing.

The consequence worth knowing: **a feature spanning both repositories does not
go live at the same moment.** The API half deploys on push and the website half
waits for the nightly run, unless somebody dispatches it manually. Do that when
the two halves depend on each other.

## Troubleshooting

**A push produced a green run but nothing deployed.** Website: expected,
`DEPLOY_ON_PUSH` is unset. Check the run's job list, where `deploy` will be
marked skipped rather than failed.

**The deploy failed but production is fine.** Most likely the migration guard
or a test. Both stop the pipeline before the container is replaced.

**Tests failed on a commit that passes locally.** Check for
`deadlock detected`. A rare fixture race can make the suite fail spuriously;
`ktp-api` retries schema resets once for exactly this reason, and re-running
the job is a reasonable response if it slips through. Do not disable the gate.

**The nightly did not fire.** Confirm the workflow exists on the default
branch, since GitHub only registers `schedule` and `workflow_dispatch` from
there. Also confirm the `timezone` key on the cron entry is still supported;
the UTC fallback is `59 3 * * *`, which is 11:59 PM Eastern while EDT is in
effect and drifts by an hour after November. GitHub can also delay scheduled
runs under load.

**Disk filling on a deploy host.** Each build orphans the previous image.
Both pipelines prune images and build cache older than a week, which keeps a
few days of rollback material rather than reclaiming everything. Check with
`docker system df`, which separates images from build cache.

## Related

- [Backups](./backups.md) covers what to do when a deploy is not the problem.
- `ktp-api/README.md` and `uga-ktp-website/README.md` hold the repository-side
  detail, including environment variables and manual deploy steps.
