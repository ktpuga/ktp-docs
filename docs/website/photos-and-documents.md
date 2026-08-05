---
sidebar_position: 2
---

# Photos & Documents

The **Files & Photos** portal tab has two parts: a member-facing photo/album system, and an eboard-managed document library. There's also a completely separate, fully public homepage gallery. See [API: Photos & Albums](../api/endpoints.md#photos--albums) for the backend routes behind all of this.

---

## Shared photo albums

Two ways photos are organized:

- **Shared Album** — a single general album open to everyone (active, chair, alumni, eboard, pledge). Anyone can upload; the uploader can delete their own photo.
- **Eboard-created named albums** — e.g. "Spring Retreat 2026." Only eboard can create a new album; anyone in the shared-album groups can browse into one and upload.

**Deleting photos:** the uploader can always delete their own. **Eboard can delete any photo in any album, including the Shared Album** — a real moderation power, not scoped to albums a given eboard member personally created (that narrower rule was the original behavior; broadened so eboard can act on a reported photo regardless of which album it's in — see [Safety & Moderation](./overview.md#safety--moderation)). Every photo card also has a **Report** button for flagging it to eboard's review queue without deleting it yourself.

:::warning Delete the row first, clean up Immich second
`deletePhoto` removes the `photos` row, returns 204, and *then* deletes the Immich asset best-effort.

It used to do the opposite, and that made a corrupted photo **permanently undeletable from the portal**: `immich.deleteAsset` throws on any non-OK response, so an asset that was corrupt or already gone failed the whole request and the row survived every retry. The only way out was a manual `DELETE` against the database.

The row is the only thing the app renders from, so removing it is what "delete" means to a member. The tradeoff is that a genuine Immich failure now leaves an orphaned asset — invisible wasted storage — instead of a loud 502, so it's logged with the asset id to stay findable.

`documentsController.deleteDocument` already had this ordering (row, then best-effort `fs.unlink`); photos were the one outlier. `test/photoDelete.test.js` covers it, and was mutation-checked against the old ordering.
:::

Both images and video are supported (250MB upload limit). Photos and videos are served through `PhotoMedia`, a small shared component that picks `<img>` vs `<video controls>` by the photo's `media_type` — reused everywhere a photo/video renders (album grids, the dashboard's "Recent Photos" preview).

Photos are stored in Immich, but never exposed directly to the browser — ktp-api proxies every request server-side, and the website further proxies through its own `/api/photos/:id/media` route so the Immich API key never reaches the client.

---

## Documents

A nested folder/file library for things like bylaws, meeting minutes, and course files — a completely different storage system from photos, since these are arbitrary file types (PDFs, Word docs, etc.), not something Immich handles well. Files live directly on ktp-api's own disk.

- **Eboard only**: create folders (nested to any depth), upload files, add external links, delete files/folders/links.
- **Any shared-album-group member**: browse, download, preview.
- **In-portal preview**: clicking a document opens a modal without leaving the page — images render inline, PDFs render in an embedded viewer, and anything else (Word, Excel) shows a "download instead" message rather than a broken preview attempt. Implemented as a small hand-rolled modal, not a UI-library dialog — matches how `Tabs` is already hand-rolled in this codebase.
- The document icon in the file list shows an actual thumbnail for images; everything else gets a generic file icon.
- **External links**: a document doesn't have to be a real file — eboard can add a link (a Google Doc, Slides deck, Sheet, or any URL) that shows up in the same folder tree with a distinct external-link icon. Clicking one opens the URL directly in a new tab instead of going through the download/preview flow. Useful for anything that already lives outside the chapter's own storage (shared Google Docs, external forms, etc.) without needing to export/re-upload it.

---

## Content visibility

Eboard can restrict an album, a folder or an individual document to specific member groups or committees, using the same `audience TEXT[]` + `committee_ids INTEGER[]` targeting as events and announcements rather than a second permission concept. Everything is unrestricted by default, so applying this changed nothing that already existed.

Restricted content is **hidden entirely, not shown-and-locked**. A visible-but-locked folder still leaks its name, and folder names are things like "Exec Only".

**Eboard sees everything** regardless of audience — otherwise restricting an album would remove it from the screen used to un-restrict it.

### Documents are the one place NULL does not mean "everyone"

For an album or folder, no audience means everyone. For a **document**, both columns NULL means **inherit the folder**. That is why the UI shows an Inherit/Custom toggle rather than a bare audience picker: with a plain picker there is no way to express "follow the folder", and clearing the selection would silently publish a file sitting inside a restricted folder. `parseAudience(body, { inheritable: true })` is what keeps the two apart, and `setDocumentVisibility({ inherit: true })` sends an empty body rather than an empty array.

### Setting it

Eboard picks an audience when creating an album or folder, and can change it afterwards from the lock button on any album card or document row (`PATCH /albums/:id/visibility`, `PATCH /documents/folders/:id/visibility`, `PATCH /documents/:id/visibility`). Before these existed, visibility could only be set at creation and changing an album's audience meant deleting and recreating it, losing the photos.

Restricted rows carry a **Restricted** badge that is always visible rather than hover-only — a restricted album is otherwise indistinguishable from an open one, and eboard needs to see at a glance what the chapter can't. On a document the badge reflects its *own* override only: an inheriting document inside a restricted folder is restricted in effect, but the folder is where that's shown and changed.

### Filtering the list is not enough

`/photos/:id/media`, `/documents/:id/download` and `/documents/:id/preview` each carry their own check — an id is just a number in a URL. Download and preview share one guard function, because identical bytes with a different `Content-Disposition` would otherwise be two chances to get it wrong. Denials return **404, not 403**: a 403 confirms the thing exists.

`parseAudience` rejects unknown group names instead of storing them. A typo like `"eboards"` would save happily and match nobody, making content invisible with no clue why.

The valid set is `SHARED_ALBUM_GROUPS`, which **excludes `rush`** — rushees can never see photos or documents at all, so there is no such thing as a rush-visible album.

:::warning The picker must exclude rush, and creates must return the 400
This combination produced a **dead "Create Album" button**, fixed 2026-08-04:

1. `VisibilityControl` rendered `AudienceSelect` with no `exclude`, so it offered a **Rushee** pill for content rushees can never see.
2. Ticking it sent `audience: ['rush']`, which `parseAudience` correctly rejected with a 400.
3. But `createAlbum` and `createFolder` had no `if (err.status)` branch — only the three `PATCH .../visibility` handlers did — so the 400 surfaced as an opaque **500**. Editing visibility worked; setting it at creation did not.
4. The modal passed an async `onCreate` straight to `onClick`, so the rejection was unhandled and **nothing rendered at all**.

All four are fixed: the pill is gone (`exclude={['rush']}`), both create paths return the 400, and the create modals show inline errors via `useModalSubmit`. Any new `parseAudience` caller needs that `err.status` branch — the update handlers are the pattern to copy.
:::

:::danger Never build a params array a branch might not use
The first attempt at this shipped and took down `/albums` and the Documents root **for eboard only**. `albumModel.findAll` always built `params = [viewer.userId, viewer.groups]`, but for eboard the WHERE clause is empty — so the SQL contained no `$1`/`$2` while two parameters were still supplied, and Postgres rejects that: *"bind message supplies 2 parameters, but prepared statement requires 0"*.

It survived below the document root only by accident, where `parent_id = $3` happened to make the count line up.

Every one of these functions now pushes its parameters **inside** the branch that references them, and derives each placeholder from the position the value was actually pushed to instead of hardcoding `$1`/`$2`.

**The verification lesson:** the original was tested by running the visibility *clause* against a throwaway Postgres, where it passed every case. The model function that *assembles* the query was never called, so the eboard branch — which builds a different query — was never exercised. `test/visibility.test.js` now calls the real model functions against a real database and runs **every list function for eboard and non-eboard**. That test was confirmed to fail on the original code before being trusted.
:::

Run the database-backed tests with:

```bash
docker run -d --rm --name ktp-test -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=ktp -p 55447:5432 postgres:16-alpine
TEST_DATABASE_URL=postgres://postgres:pw@localhost:55447/ktp npm test
```

Without `TEST_DATABASE_URL` they skip, so plain `npm test` still works with no Docker.

---

## Public homepage gallery

A completely separate system from the two above — the "Chapter Gallery" section shown on the actual public homepage, visible to anyone with no login. Managed at `/admin/homepage-photos` (eboard only):

- Upload a file directly, **or** register an already-uploaded Immich asset by pasting its asset id (for cases where someone — e.g. the SWE committee — uploaded straight into the Immich UI). Registering by id validates the asset actually exists before saving, to avoid a typo'd id causing a broken image.
- Reorder photos via up/down buttons (`display_order`).
- Removing a photo only unlists it from the gallery — it does not delete the underlying Immich asset, since that asset might be reused elsewhere.

---

## iOS homepage slideshow

A fourth, separate system — the slideshow on the **iOS app's** home screen, managed at `/admin/ios-homepage-slideshow` (eboard only).

:::caution Not the same as the public homepage gallery
The gallery above is the website's public marketing page and needs no login. This one is in-app and requires authentication. They have separate tables, separate endpoints (`/homepage-photos` vs. `/ios-homepage-photos`), and separate admin pages. The similar names make them easy to confuse.
:::

Each slide carries a title, alt text, and optionally a subtitle and a link (HTTPS only) with a label. Slides can be **scheduled** with `starts_at`/`ends_at` and toggled active — a slide only shows in the app when it's active and inside its window.

Constraints worth knowing before uploading: **max 10 active slides**, 100MB per upload, JPEG/PNG/HEIC/HEIF/WebP only (no animated images), and source images must be at least **900×600**. The API center-crops around an optional focal point and generates an optimized progressive JPEG, so the stored slide is not the file you uploaded.

---

## Why four separate systems instead of one

Deliberate: different audiences (public vs. members-only vs. in-app), different permission models (curated/eboard-only vs. self-service upload-and-delete-your-own), and different lifecycles. Folding them into one generic "media" table would have meant either exposing member photos publicly by accident, or bolting an audience flag onto every row and checking it on every single read — splitting them by table makes the access boundary the schema itself, not application logic that could have a bug in it.
