---
sidebar_position: 11
---

# Next.js 16 migration

The website ran on Next.js 15.5.22 until August 2026. This page records every change the upgrade to 16.2.12 required, and — just as usefully — everything that turned out **not** to need changing.

## Why we did it

Not for features. Every Next.js 15.x release sat inside the advisory range `9.3.4-canary.0 - 16.3.0-preview.7`, which included three middleware/proxy bypass advisories:

| Advisory | CVSS | What it meant here |
|---|---|---|
| [GHSA-492v-c6pp-mqqv](https://github.com/advisories/GHSA-492v-c6pp-mqqv) | 8.1 | Middleware bypass |
| [GHSA-26hh-7cqf-hhc6](https://github.com/advisories/GHSA-26hh-7cqf-hhc6) | 7.5 | Proxy bypass |
| [GHSA-267c-6grr-h53f](https://github.com/advisories/GHSA-267c-6grr-h53f) | 7.5 | Proxy bypass |

This app's **entire portal access-control boundary is that file**. `/member`, `/admin`, `/alumni`, `/pledge` and `/rushee` are separated by nothing else. A middleware bypass in this codebase is a portal boundary bypass, which is why this sat at the top of the backlog rather than being treated as routine dependency hygiene.

There was no fix inside 15.x. `npm audit` suggested `next@9.3.3` — a downgrade to 2020 — which is just its resolver walking backwards for lack of a forward option. **Do not ever act on that suggestion.** Next 16 was the only real fix.

:::tip Verified, not assumed
All three advisories are confirmed gone from `npm audit` after the upgrade. `next` is still listed, but only transitively — its `via` chain is now just its own bundled `postcss` and `sharp` under `node_modules/next/node_modules/`, with no direct Next advisory of its own.
:::

## What did *not* need changing

Worth stating first, because it's why this took one session instead of several:

- **Async request APIs were already correct.** Next 16 fully removes synchronous access to `cookies()`, `headers()`, `draftMode()`, `params` and `searchParams`. This is the single biggest source of Next 16 breakage in most codebases. Every one of our 14 route handlers already did `await params`, every `headers()` call was already awaited, and `app/blog/[slug]/page.tsx` already typed params as a `Promise`. Zero exposure.
- **`next-auth@5.0.0-beta.32` — the version already installed — declares `next: ^14.0.0-0 || ^15.0.0 || ^16.0.0`.** The dependency most likely to block this already supported 16. No auth changes at all.
- No Babel config, no parallel routes (`@slot` directories), no AMP, no `serverRuntimeConfig`/`publicRuntimeConfig`, no `next/legacy/image`, no `next lint` script, no `experimental_ppr`, no `revalidateTag` calls. All the other Next 16 removals simply didn't apply.

## Version changes

| Package | Before | After | Why |
|---|---|---|---|
| `next` | 15.5.22 | 16.2.12 | The advisories above |
| `react` / `react-dom` | 19.0.0 | 19.2.8 | Next 16's App Router targets React 19.2; `next-sanity` 13 peers `^19.2.3` |
| `next-sanity` | 10.0.15 | 13.2.3 | 10 peers `next: ^15.1`. There is no smaller hop — `next-sanity@11` still peers `^15.1`, and 12 is the first to support `^16.0.0-0` |
| `eslint-config-next` | 15.5.2 | 16.2.12 | Version match; also **moved to `devDependencies`**, where it always belonged |
| `sanity`, `@sanity/vision`, `@sanity/icons` | dependencies | **devDependencies** (same versions) | See [Sanity](#the-sanity-decision) below |

`engines.node` is now declared as `>=20.9.0`. Next 16 drops Node 18 entirely. `.nvmrc` still says `20`, which resolves to a 20.x above that floor.

## `middleware.ts` → `proxy.ts`

Next 16 renames the convention. The old filename still works but is deprecated, and this is the last file in the repo that should be sitting on a deprecated convention.

```ts title="proxy.ts"
// was: export default auth((req) => { ... })
const proxy = auth((req) => { ... })
export default proxy
```

The file was renamed and the handler given the name `proxy`, which Next recommends even when you use a default export. **The matcher, the redirect logic and the portal boundaries are byte-for-byte unchanged.**

:::warning `proxy` is nodejs-only
The `edge` runtime is not supported in `proxy` and cannot be configured. That happens to suit us: `auth.ts` refreshes OAuth tokens with `fetch` and keeps an in-memory `Map` to de-duplicate concurrent refreshes, neither of which was ever a good fit for edge. If you ever need edge here, you have to stay on the deprecated `middleware` filename.
:::

A successful build now prints `ƒ Proxy (Middleware)` in the route table. If that line is missing, the boundary is not registered and every portal is open — treat its absence as a build failure.

## Turbopack is now the default builder

Next 16 builds with Turbopack unless told otherwise, and **a custom `webpack()` block makes `next build` fail outright** rather than being silently ignored. Ours was:

```js
webpack(config) {
    config.resolve.alias['@'] = __dirname;
    return config;
}
```

Deleted. It was always redundant — `jsconfig.json` already maps `"@/*"` to `"./*"`, and Next reads that natively for both bundlers. Nothing else in the config touched webpack.

Build time dropped from **98s to ~24s** for the compile phase.

### `turbopack.root` had to be pinned

```js
turbopack: {
    root: __dirname,
}
```

There is a stray `package-lock.json` sitting in the Windows home directory (`C:\Users\yashv\package-lock.json`). Turbopack's workspace-root inference walks up the tree, found it, and selected the **home directory** as the project root — so every module resolved as `./Documents/GitHub/uga-ktp-website/...` and the build failed. Docker never sees this (only the repo is copied in), so it only bites local builds, but an inferred root is worth pinning regardless.

### Turbopack matches file extensions case-sensitively

Webpack did not. Five files in `public/` were imported by `components/template-page.jsx` with an uppercase `.JPEG` extension and failed with `Unknown module type`:

```
datenight_x_TT_beta  mytie_x_dsp_alpha  mytie_x_dsp_exec
retreat_1_whiteshirts  tailgate
```

All five were renamed to lowercase `.jpeg` and their five import statements updated. Each was referenced exactly once and only as an import — no `<img src>` string, no sitemap entry — so this was safe. Every other image in `public/` was already lowercase.

:::note
On Windows this needs a two-step `git mv` through a temporary name, because the filesystem is case-insensitive and git won't otherwise record a case-only rename.
:::

## The Sanity decision

`next-sanity` 12+ requires `sanity: ^5`, so reaching Next 16 through the front door meant dragging Sanity Studio across two majors (4 → 6) on top of everything else.

We took a different route: **the embedded Studio route is gone.**

| | Before | After |
|---|---|---|
| `app/studio/[[...tool]]/page.jsx` | 1.49 MB route in the production bundle | deleted |
| `sanity`, `@sanity/vision`, `@sanity/icons` | `dependencies` | `devDependencies` |
| `sanity.config.js`, `sanity.cli.js`, `sanity/schemaTypes/` | in repo | **unchanged, still in repo** |
| Editing content | `ugaktp.com/studio` | `npm run studio:dev`, or deploy once with `npm run studio:deploy` |

Two new scripts exist for this:

```json
"studio:dev": "sanity dev",
"studio:deploy": "sanity deploy"
```

`studio:deploy` publishes the Studio to `<project>.sanity.studio`, hosted by Sanity at no cost. **This has not been run yet** — until someone does, content is editable locally via `studio:dev` but there is no hosted editor. That is the one outstanding action from this migration.

Why this shape rather than deleting Sanity outright: the schema definitions and CLI config have to live *somewhere* for the Studio to be deployable at all, and this repo is as good a place as any until someone wants a separate one. Keeping them as devDependencies means they are not in the production bundle, not in the Docker runtime image, and not a factor in production security posture — while still being one command away from a working editor.

The blog itself is untouched. `/blog` and `/blog/[slug]` read through `@sanity/client` and `groq` via `next-sanity`, which stays a production dependency.

### `sanity/lib/live.ts` was deleted

It imported `defineLive`, which `next-sanity` 13 no longer exports, so it broke the type check. It was dead Sanity starter scaffolding — nothing in the repo imported `sanityFetch`, `SanityLive`, or the file itself. Verified by grep across `app/`, `components/`, `lib/`, `sanity/` and `types/` before removing.

## `tsconfig.json` was rewritten by Next

Next 16 makes two changes mandatory and applies them automatically on first build:

```diff
- "moduleResolution": "node",
+ "moduleResolution": "bundler",
- "jsx": "preserve",
+ "jsx": "react-jsx",
```

This is expected, not a mistake — leave it committed.

## Verification

What was actually checked, as opposed to assumed:

1. **`npm run build`** — clean, all routes present, `ƒ Proxy (Middleware)` registered.
2. **The access-control boundary was tested at runtime**, not just compiled. Against a production server with no session cookie:

   | Request | Result |
   |---|---|
   | `/member`, `/admin`, `/alumni`, `/pledge`, `/rushee`, `/complete-profile`, `/member/settings`, `/admin/users` | `307` → `/login` |
   | `/`, `/rush`, `/login`, `/privacy` | `200` |

   A green build proves `proxy.ts` compiles. It does not prove it *gates* — these requests do.
3. **`/blog` returns 200 and renders**, so removing the Studio didn't disturb blog reads. **`/studio` returns 404**, confirming the route is genuinely gone.
4. **`output: 'standalone'` still emits `.next/standalone/server.js`** under Turbopack — the Dockerfile's runner stage copies exactly that, so this was worth confirming rather than assuming.
5. **A real `docker build`** against the production Dockerfile (bun on alpine), with the same build args `docker-compose.yml` passes.

## Advisory count

| | Before | After |
|---|---|---|
| Total | 38 | 35 |
| Critical | 2 | 2 |
| High | 23 | 23 |

The headline numbers barely move, and that is fine — **the three that mattered are gone.** What remains is almost entirely the Sanity CLI's dependency chain (`@sanity/cli`, `@sanity/runtime-cli`, a vendored `npm` tree, `@architect/*`, `decompress`, `tar`, `dompurify`, `esbuild`), which is now firmly dev-only and never reaches production. The rest is `next`'s own bundled `postcss` and `sharp`, which only Next itself can update.

Judge this by which advisories are left, not how many.

## If you need to roll back

`package.json` alone is not enough — the lockfile retains the resolved tree. Restore all three lockfiles together:

```bash
git checkout -- package.json package-lock.json yarn.lock bun.lock
rm -rf node_modules .next
npm install --legacy-peer-deps
```

Budget several minutes for the install. And note that **`npm audit fix` cannot run on this repo at all** — `lucide-react@0.344.0` declares a peer of React 16/17/18 against our React 19, so npm `ERESOLVE`s. Always use `npm install --legacy-peer-deps` locally. Production sidesteps this entirely because the Dockerfile uses `bun install`, which ignores peer conflicts.
