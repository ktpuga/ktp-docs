---
sidebar_position: 15
---

# Dependency security

Review vulnerability reports alongside the dependency path, affected code, and deployment build. An alert count alone does not establish exposure.

## Reading audit results {#the-number-that-matters}

Run both:

```bash
npm audit --omit=dev
npm audit
```

The first excludes development dependencies; the second includes them. Neither directly inventories the final standalone Docker image. Build tools can also matter during installation and CI.

The August 2026 cleanup recorded zero production-classified findings and 19 in the full audit. Those are historical results, not the current security status. Rerun the commands when assessing a change.

Dependabot can include findings from multiple supported manifests and lockfiles, so its total may differ from a local npm audit.

## The August 2026 cleanup

### 1. `react-multi-carousel` vendored the entire npm CLI

The recorded package manifest included:

```json
"dependencies": { "core-js": "^3.32.2", "install": "^0.13.0", "npm": "^10.1.0" }
```

The unused package brought an npm dependency subtree into the installation. Its only remaining import was in an archived rush-page file. Removing it removed 199 packages in that cleanup.

Use `npm ls npm` to check whether a proposed dependency brings its own npm CLI. Investigate unexpected subtrees before accepting them.

### 2. Three lockfiles, all tracked

The repository previously tracked npm, Yarn, and Bun lockfiles that could diverge. It now uses `package-lock.json`. Keep dependency updates in the chosen package manager's manifest and lockfile.

### 3. The `nanoid` override {#3-nanoid-was-the-one-real-production-issue}

The cleanup added this override for the 3.x dependency line:

```json
"overrides": {
  "nanoid@^3.0.0": "^3.3.18"
}
```

The recorded advisory was [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8). The scoped key leaves 5.x consumers on their own major version. An unscoped override could force incompatible versions into those consumers.

## Overrides and the Docker build {#why-overrides-and-not-npm-audit-fix}

The current dependency stage copies only the manifest:

```dockerfile
FROM base AS deps
COPY package.json ./
RUN npm install --legacy-peer-deps
```

It does not install from `package-lock.json`. Docker builds therefore resolve package ranges again, and a lockfile-only fix does not pin the production build.

An override in `package.json` applies during that fresh resolution. Check both the manifest and the build process when deciding how a dependency fix reaches deployment.

The project uses `--legacy-peer-deps` because some packages' declared React peer ranges lag the installed React version. A normal install or audit-fix operation can fail with `ERESOLVE`. Do not change icon-library versions solely to clear that error without checking imports and the build.

## Reviewing development dependencies {#why-the-remaining-19-stay}

The historical remaining findings came through Sanity development tooling. A Sanity upgrade was attempted and reverted after its dependency tree added further findings.

That result is context for a future upgrade, not a permanent exemption. Compare affected versions, advisory details, dependency paths, local/CI exposure, and build behavior. Record why a finding is fixed, deferred, or not applicable.

## Repository alert settings

Check current repository settings instead of relying on earlier alert totals. A denied API request does not prove that alerts are disabled; inspect its message and the caller's permissions.

For a classic-token GitHub CLI session, the documented alert-reading workflow is:

```bash
gh auth refresh -h github.com -s security_events
gh api repos/ktpuga/uga-ktp-website/dependabot/alerts --paginate \
  --jq '.[] | [.security_advisory.severity, .dependency.package.name, .dependency.scope] | @tsv'
```

An authorized request to `repos/OWNER/REPO/vulnerability-alerts` returns `204` when alerts are enabled. A failure from the SBOM endpoint alone does not establish whether alert scanning is enabled.

## Checklist for the next dependency change

1. Install with the project's required peer-dependency option.
2. Inspect the dependency tree, including unexpected npm CLI dependencies.
3. Run the production-filtered and full audits, and assess the findings.
4. Build the website and check affected functionality.
5. Review `package.json` and `package-lock.json` together. Avoid introducing another package manager's lockfile.
6. Scope overrides to the affected version range when different major versions coexist.
7. Record completed command results and remaining findings; do not reuse an earlier audit count as a current result.
