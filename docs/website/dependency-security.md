---
sidebar_position: 15
---

# Dependency security

How to read the website's vulnerability alerts, and why the raw count on GitHub has never been the number that matters.

## The number that matters

Run this, not `npm audit`:

```bash
npm audit --omit=dev
```

As of the August 2026 cleanup this reports **0 vulnerabilities**. Plain `npm audit` reports 19, and GitHub's Dependabot dashboard reports more still. All three are correct; they just count different things.

| Command | Counts | Aug 2026 |
|---|---|---|
| `npm audit --omit=dev` | What actually ships | **0** |
| `npm audit` | Ships **plus** build tooling | 19 |
| Dependabot dashboard | Every lockfile in the repo, separately | was 77 |

The 19 are all `sanity@4.6.0` and its dependency chain. Sanity Studio is a local developer tool — it is not deployed, and `npm run studio:deploy` has never been run. None of that code executes in production. **This is a deliberate, reviewed decision, not a backlog item.** See [Why the remaining 19 stay](#why-the-remaining-19-stay).

## The August 2026 cleanup

The dashboard showed **77 open alerts**, including 2 critical. Three things were inflating it.

### 1. `react-multi-carousel` vendored the entire npm CLI

The package declares this in its own manifest:

```json
"dependencies": { "core-js": "^3.32.2", "install": "^0.13.0", "npm": "^10.1.0" }
```

That is a packaging mistake in the upstream package — someone ran `npm i install npm` and committed the result. It pulled **16 MB of `node_modules/npm/`** into the *production* dependency tree, and that subtree was the source of nearly every runtime-scoped alert:

```
tar 7.5.11        npm/tar             <- the only CRITICAL
sigstore 3.1.0    npm/sigstore
@sigstore/core    npm/@sigstore/core
ip-address 10.1.0 npm/ip-address
glob 10.5.0       npm/glob
brace-expansion   npm/brace-expansion
picomatch 4.0.3   npm/picomatch
```

**The package was not used anywhere.** Its only import lived in `app/rush/spring-rush-2026-page.archive.bak`, an orphaned archive file nothing referenced. The live carousels in `components/GalleryCollection.jsx` are hand-rolled with `next/link`.

Removing it dropped **199 packages** and cleared the critical plus most of the highs, with zero code changes.

:::tip Check this before adding any dependency
`npm ls npm` should return nothing. If a package vendors the npm CLI, it drags in dozens of advisories that have nothing to do with your app. `sanity@4.22` does this too — see below.
:::

### 2. Three lockfiles, all tracked

The repo tracked `package-lock.json`, `yarn.lock` **and** `bun.lock`. Dependabot scans each one independently, so every advisory was counted two or three times — 39 alerts from `package-lock.json` and 38 from `yarn.lock` describing the same vulnerabilities.

They also drifted. PR #42 added `auto-skeleton-react` to `package.json` and `package-lock.json` only; `yarn.lock` stayed short an entry until someone noticed by hand. Nothing in CI caught it.

**`yarn.lock` and `bun.lock` were deleted. `package-lock.json` is the only lockfile.**

### 3. `nanoid` was the one real production issue

After the first two fixes, `npm audit --omit=dev` reported exactly one advisory: `nanoid@3.3.16`, high, [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8). It arrives through `postcss`, which is bundled inside both `next` and `vite`, and through `@sanity/client`.

Fixed with a **version-scoped** override:

```json
"overrides": {
  "nanoid@^3.0.0": "^3.3.18"
}
```

The `@^3.0.0` scoping is essential. Three copies of `nanoid` are installed, and the 5.x ones are already patched:

```
DEV   5.1.15   @sanity/mutate/nanoid           already above the 5.1.6 fix line
PROD  5.1.16   @sanity/visual-editing/nanoid   already above the 5.1.6 fix line
PROD  3.3.18   nanoid                          <- the one that needed pinning
```

A bare `"nanoid": "^3.3.18"` would force those 5.x copies down to 3.x. They are ESM-only with a different API, so Sanity would break.

## Why `overrides` and not `npm audit fix`

**Production never reads a lockfile.** The `Dockerfile` deps stage is:

```dockerfile
FROM base AS deps
COPY package.json ./
RUN npm install --legacy-peer-deps
```

Only `package.json` is copied. Production re-resolves every dependency from its semver range on each build, which means:

- **Production builds are not reproducible.**
- **Editing a lockfile does nothing for production.** `npm audit fix` changes `package-lock.json`, which moves the GitHub dashboard and changes nothing that deploys.
- **Pinning a version means pinning it in `package.json`.**

`overrides` is a `package.json` field applied at resolution time, so it works on a fresh install with no lockfile present. **It is the only lockfile-independent way to pin a transitive dependency in this repo.**

:::warning `npm audit fix` cannot run here at all
`lucide-react@0.344.0` declares peer `react@^16 || ^17 || ^18` against this project's React 19, so any plain `npm` command fails with `ERESOLVE`. Always use `npm install --legacy-peer-deps`. Do **not** "fix" this by bumping `lucide-react` — icon names change between its versions, which is the recurring `CircleCheck` breakage.
:::

## Why the remaining 19 stay

They are all reachable only through `sanity@4.6.0`, a `devDependency`: `@sanity/cli`, `@sanity/runtime-cli`, `@architect/*`, `adm-zip`, `decompress`, `tar`, `brace-expansion`, `glob`, `js-yaml`, `undici`, `dompurify`, `esbuild`, `uuid`.

`npm audit` proposes `sanity@4.22.1` as the fix. **That upgrade was attempted and reverted.** It pulls in its own vendored npm CLI subtree and *added* roughly 39 dev-only high advisories — the total went from 40 to 65, worse than the baseline. Everything it cleared was itself dev-only or low severity. It was pure dashboard noise for no production benefit.

If someone proposes bumping Sanity again, **measure the resulting advisory count before accepting it.**

## Repository alert settings

| Repo | Dependabot alerts | Notes |
|---|---|---|
| `ktpuga/uga-ktp-website` | on | 77 open before the cleanup |
| `ktpuga/ktp-api` | on | 0 alerts; only 8 dependencies and no devDependencies |
| `ktpuga/ktp-docs` | unknown | API returns 403 without admin, so the state cannot be read |
| `yashverms32/ktp-docs` (fork) | **off** | |
| `andrew-babatunde2004/KTP_LIFE_UGA` | **off** | iOS/Swift; no npm manifest to scan |

:::note A 403 is not an answer
`GET /repos/{owner}/{repo}/dependabot/alerts` returns 403 both when alerts are genuinely disabled *and* when you simply lack admin on the repo — but with **different messages**. `"Dependabot alerts are disabled for this repository"` is a real state; `"You are not authorized to perform this operation"` means you cannot see the state at all. Read the message, not the status code. Reading alerts requires **admin or security-manager**, not push.
:::

Reading alerts programmatically requires the `security_events` scope:

```bash
gh auth refresh -h github.com -s security_events
gh api repos/ktpuga/uga-ktp-website/dependabot/alerts --paginate \
  --jq '.[] | [.security_advisory.severity, .dependency.package.name, .dependency.scope] | @tsv'
```

The `dependency-graph/sbom` endpoint is unreliable and times out on both repos. Do not treat a 404 or 500 from it as evidence that a repo is unscanned; check `repos/OWNER/REPO/vulnerability-alerts` instead, which returns **204** when alerts are enabled.

## Checklist for the next dependency change

1. `npm install --legacy-peer-deps` — never plain `npm install`.
2. `npm ls npm` — must return nothing.
3. `npm audit --omit=dev` — this is the number that matters; it should stay at 0.
4. `npm run build` — must exit 0.
5. Only `package-lock.json` should appear in the diff. If `yarn.lock` or `bun.lock` came back, delete them.
6. To pin a transitive dependency, use `overrides` in `package.json`. Scope it with `name@range` if multiple major versions are installed.
