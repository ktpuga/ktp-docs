---
sidebar_position: 11
---

# Next.js 16 migration

This page records the August 2026 migration from Next.js 15.5.22 to 16.2.12. The current manifest uses Next.js and `eslint-config-next` 16.3.0. Historical versions and test results below describe the migration, not the current vulnerability status.

## Why we did it

The migration followed middleware/proxy advisories recorded in the dependency review:

- [GHSA-492v-c6pp-mqqv](https://github.com/advisories/GHSA-492v-c6pp-mqqv)
- [GHSA-26hh-7cqf-hhc6](https://github.com/advisories/GHSA-26hh-7cqf-hhc6)
- [GHSA-267c-6grr-h53f](https://github.com/advisories/GHSA-267c-6grr-h53f)

Portal routing depends on the website proxy, so bypass findings require attention. API authorization remains a separate boundary and must not rely on a page redirect.

Review current advisory ranges before choosing an upgrade or rollback. Do not apply an audit tool's proposed downgrade without checking compatibility and security coverage.

## What did *not* need changing

At the time of the migration:

- Request APIs and route parameters were already awaited.
- `next-auth@5.0.0-beta.32` supported the new Next major version.
- The repository did not use several removed features, including AMP, legacy Image, runtime config, and the old `next lint` command.
- No Babel configuration or parallel-route setup needed migration.

These findings describe the checked codebase, not guarantees for future additions.

## Version changes

| Package | Before | Migration target |
| --- | --- | --- |
| `next` | 15.5.22 | 16.2.12 |
| `react` / `react-dom` | 19.0.0 | 19.2.8 |
| `next-sanity` | 10.0.15 | 13.2.3 |
| `eslint-config-next` | 15.5.2 | 16.2.12, moved to devDependencies |
| `sanity`, `@sanity/vision`, `@sanity/icons` | Production dependencies | Development dependencies |

The repository declares Node `>=20.9.0`. Use the current manifest, lockfile, and Dockerfile when checking the deployed versions.

## `middleware.ts` → `proxy.ts`

The file was renamed and its default handler named `proxy`:

```ts title="proxy.ts"
const proxy = auth((req) => { ... })
export default proxy
```

The migration retained the matcher and routing behavior. The proxy uses the Node.js runtime. Check the current Next documentation before changing its runtime or convention.

Build output includes `ƒ Proxy (Middleware)`. Verify redirect behavior against a running production build as well; registration alone does not prove each route is protected.

## Turbopack is now the default builder

The migration removed a custom Webpack alias:

```js
webpack(config) {
    config.resolve.alias['@'] = __dirname;
    return config;
}
```

`jsconfig.json` already maps `@/*` to `./*`, so the extra alias was unnecessary. The recorded compile phase decreased from 98 seconds to about 24 seconds on the migration machine; build times vary by environment.

### `turbopack.root` had to be pinned

```js
turbopack: {
    root: __dirname,
}
```

An unrelated lockfile in the developer's home directory caused workspace-root inference to choose the wrong directory. Pinning the root keeps local builds within the checkout.

### Turbopack matches file extensions case-sensitively

Five imported images with uppercase `.JPEG` extensions were renamed to lowercase `.jpeg`, with imports updated:

```text
datenight_x_TT_beta
mytie_x_dsp_alpha
mytie_x_dsp_exec
retreat_1_whiteshirts
tailgate
```

On a case-insensitive filesystem, use a temporary filename when recording a case-only Git rename.

## The Sanity decision

The embedded `app/studio/[[...tool]]/page.jsx` route was removed. Sanity configuration and schema files remain for local editing or a separate Studio deployment.

| Operation | Command |
| --- | --- |
| Local Studio | `npm run studio:dev` |
| Publish Studio | `npm run studio:deploy` |

The migration record says Studio had not been published separately. Check the current project before assuming a hosted editor exists.

The blog still reads content through production Sanity client dependencies. Moving Studio packages to devDependencies does not by itself prove they are absent from every build stage or eliminate build-tool risk.

### `sanity/lib/live.ts` was deleted

The unused file imported `defineLive`, which was incompatible with the upgraded package. Its consumers were checked before removal.

## `tsconfig.json` was rewritten by Next

The migration recorded:

```diff
- "moduleResolution": "node",
+ "moduleResolution": "bundler",
- "jsx": "preserve",
+ "jsx": "react-jsx",
```

Keep generated configuration changes under review and committed with the migration.

## Verification

The migration record includes:

1. A completed website build and registered proxy.
2. Unauthenticated requests to protected portal routes redirecting to `/login`.
3. Public pages responding without a portal session.
4. Blog rendering after Studio removal, and `/studio` returning `404`.
5. Standalone output at `.next/standalone/server.js`.
6. A Docker build using the deployment's build arguments.

Repeat relevant checks after later authentication or framework changes. These are historical results, not tests run whenever this page is edited.

## Advisory count

Early migration notes recorded 38 findings before and 35 after. Later investigation found that an unused production dependency, `react-multi-carousel`, supplied the npm subtree previously described as development-only.

That package and the extra Yarn/Bun lockfiles were removed in a subsequent cleanup. See [Dependency security](./dependency-security.md) for how to assess current results. Retain the distinction between dependency classification, build-time use, and the final runtime image.

## If you need to roll back

Select a known-good commit and review the complete migration diff. Restore the corresponding application code, configuration, manifest, and lockfile together; restoring two dependency files alone does not undo a framework migration.

Install with the project's required peer-dependency option and run the build and authentication checks before deployment:

```bash
npm install --legacy-peer-deps
npm run build
```

The current Docker dependency stage copies `package.json` and runs `npm install --legacy-peer-deps` without the lockfile. It resolves ranges again on each build, so a lockfile-only change does not pin that build. Package overrides must be reflected in the manifest until the build process is changed.
