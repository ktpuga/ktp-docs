---
sidebar_position: 2
---

# Photos & Documents

The **Files & Photos** portal tab has two parts: a member-facing photo/album system, and a document library every member but pledges can contribute to. There's also a completely separate, fully public homepage gallery. See [API: Photos & Albums](../api/endpoints.md#photos--albums) for the backend routes behind all of this.

---

## Shared photo albums

Two ways photos are organized:

- **Shared Album** — a single general album open to everyone (active, chair, alumni, eboard, pledge). Anyone can upload; the uploader can delete their own photo.
- **Eboard-created named albums** — e.g. "Spring Retreat 2026." Only eboard can create a new album; anyone in the shared-album groups can browse into one and upload.

**Deleting photos:** the uploader can always delete their own. **Eboard can delete any photo in any album, including the Shared Album** — a real moderation power, not scoped to albums a given eboard member personally created (that narrower rule was the original behavior; broadened so eboard can act on a reported photo regardless of which album it's in — see [Safety & Moderation](./overview.md#safety--moderation)). Every photo card — and the full-size lightbox — also has a **Report** button for flagging it to eboard's review queue without deleting it yourself, and a **Block** button right next to it for blocking the member who uploaded it. Both are hidden on your own uploads.

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

- **Any member except pledges** (`eboard`, `chair`, `active`, `alumni`): upload files, add external links, **create folders** (nested to any depth, always unrestricted), **upload a whole folder**, and **rename or delete a file or link they added themselves**.
- **Eboard and cabinet** (the `chair` group), additionally: **move** a file or folder, rename folders, and rename *anyone's* file.
- **Eboard only**: delete *other people's* files, delete folders, and set visibility. Folder deletes cascade a whole subtree and visibility is the access-control surface itself, so neither is handed to cabinet.
- **Any shared-album-group member** (pledges included): browse, download, preview.

`RevampedPhotoFiles` derives **three** page-level flags and passes them down: `isEboard`, `canManageDocs` (`isEboard || chair`), and `canContributeDocs` (any of `DOCUMENT_CONTRIBUTOR_GROUPS`). **The whole toolbar is now one gate, `canContribute`** — New Folder, Upload Folder, Upload File and Add Link are all "add" actions on the same tier. Move and drag stay on `canManage`; the lock button stays on `isEboard`.

Rename and delete are then **per-row**, not per-page, both derived from one `isOwnUpload` computed in the table's `map`:

| Row action | Shown when |
|---|---|
| Rename | `canManage \|\| isOwnUpload` |
| Delete (file or link) | `isEboard \|\| isOwnUpload` |
| Delete (folder) | `isEboard` — folders have no uploader |

`isOwnUpload` is `doc.kind !== 'folder' && doc.uploaded_by != null && doc.uploaded_by === currentUserId`. Both guards earn their place: folders carry `created_by` rather than `uploaded_by`, and a row whose uploader was hard-deleted carries `uploaded_by: null`, which would compare equal to an undefined `currentUserId` before the session loads. `NewFolderModal` still hides `VisibilityControl` for cabinet, so a folder a chair creates is unrestricted.

**A single boolean cannot express these tiers** — collapsing them back is how a plain member silently gains folder delete. The UI only decides what is worth *showing*; the API re-checks every one of these.

:::warning Pledges read but do not contribute
`DOCUMENT_CONTRIBUTOR_GROUPS` is deliberately spelled out in full on both sides (`ktp-api/constants.js` and `PhotoFiles.jsx`) rather than derived by filtering `pledge` out of `SHARED_ALBUM_GROUPS`. A group added to the shared-album list later is being granted **read** access; deriving from it would hand that group **write** access silently.
:::
- **In-portal preview**: clicking a document opens a modal without leaving the page — images render inline, PDFs render in an embedded viewer, and anything else (Word, Excel) shows a "download instead" message rather than a broken preview attempt. Implemented as a small hand-rolled modal, not a UI-library dialog — matches how `Tabs` is already hand-rolled in this codebase.
- The document icon in the file list shows an actual thumbnail for images; everything else gets a generic file icon.
- **External links**: a document doesn't have to be a real file — any member but a pledge can add a link (a Google Doc, Slides deck, Sheet, or any URL) that shows up in the same folder tree with a distinct external-link icon. Clicking one opens the URL directly in a new tab instead of going through the download/preview flow. Useful for anything that already lives outside the chapter's own storage (shared Google Docs, external forms, etc.) without needing to export/re-upload it.

### Uploading a folder

**Open to any member except pledges**, the same tier as the single-file upload. That is not an independent policy choice: the feature creates a folder per directory it walks, so **Upload Folder and New Folder must share a gate** — split them and one becomes a button that 403s on its first step. They were briefly cabinet-only, which is exactly the mismatch that produced a "members can't upload folders" report.

**There is no API work behind this.** It is a client-side composition of the two endpoints that already exist, `POST /documents/folders` and `POST /documents`. No bulk endpoint, no transaction, no new permissions.

`planFolderUpload(fileList)` turns the flat `FileList` a `webkitdirectory` input produces into an ordered plan, then `runFolderUpload` walks it: folders shallowest-first, then every file.

:::warning `webkitRelativePath` is the only thing carrying the structure
The `File` objects a directory input yields are **flat**, and `file.name` is just the basename. Read `file.name` instead of `file.webkitRelativePath` and a nested tree uploads as a pile into one folder, with no error anywhere.

Two consequences fall out of the same fact:

- **Every ancestor must be registered, not just the deepest directory.** A tree whose only file is `a/b/c/deep.pdf` names `a/b/c` and nothing else, so `a` and `a/b` have to be inferred or the leaf is created under a parent that does not exist.
- **Empty directories are invisible.** A directory input reports files, so a folder with nothing beneath it cannot be seen and is not recreated. The confirm step says so rather than leaving it to be noticed later.
:::

Four decisions worth keeping:

- **Sequential, not parallel.** `/documents` has no rate limit, files run to 50MB, and the progress count has to mean something. One at a time is also what makes a failure isolable to a named file.
- **Nothing aborts the run except a redirect.** A file over the cap or a name the API rejects is recorded and the walk continues; stopping at the first problem would leave a half-made tree with no report of where it stopped. Only `redirect('/login')` propagates.
- **Same-named folders are reused, not duplicated**, so uploading the same tree twice merges. Only folders the member can *see* are candidates — merging into a restricted folder they cannot open would be writing somewhere invisible to them.
- **The level is re-read at the end** rather than splicing results into local state. The run creates rows at depths the table is not showing, and only some are children of the open folder.

There is a **100 file cap** (`MAX_FOLDER_UPLOAD_FILES`), checked in the confirm step where the number can be shown rather than silently truncating. The confirm step itself is not ceremony: this is the only bulk write in the portal and folders can only be deleted by eboard, so "I picked the wrong directory" is somebody else's cleanup.

New folders are created **unrestricted**, exactly like the New Folder dialog does for cabinet — there is no per-folder visibility control in a bulk flow. Set visibility afterwards if the tree needs it.

### Moving files and folders

Every row carries a **Move** button (`canManage`, so cabinet gets it too) that opens `MoveToModal`, hitting `PATCH /documents/:id/folder` and `PATCH /documents/folders/:id/parent`. Before this existed, reorganising meant deleting and re-uploading.

The picker **browses one level at a time instead of rendering a tree**, because `GET /documents/folders` is per-level and a tree would need an endpoint that does not exist. Two things fall out of that choice:

- **The self-move guard is nearly free.** A folder's subtree is only reachable *through* that folder, so greying out the row of the folder being moved also shuts out every one of its descendants. The API's `isDescendant` check still runs — that reasoning holds for this UI only, and the endpoint is public to any cabinet member with a folder id.
- **The restricted-ancestor warning is accurate.** The modal knows the restriction state of exactly the folders it walked through, which is exactly the chain that will sit above the item once it lands. One restricted ancestor anywhere in that chain triggers the warning.

**Move Here is disabled when the destination is where the item already sits**, so a completed move always removes the row from the current view. The handler relies on that: it filters the row out of `folders` or `documents` rather than re-fetching.

:::caution A move can shrink an audience with nothing else on screen saying so
Effective audience is the intersection all the way down, so dropping an inheriting document into a restricted folder silently narrows who can see it, and dropping a restricted one in narrows it *again*. The picker is the only place that warns, and it uses two different sentences: an item with its own override is told only members who can see **both** ends will find it, while an inheriting one is told members outside the destination's audience **lose** access. Both are the ∩ rule above, phrased for the case at hand.
:::

### Drag-and-drop

Native HTML5 drag (`draggable`/`onDragOver`/`onDrop`), not a library: `@dnd-kit` is only a transitive dependency via Sanity, and pulling it in direct means another `--legacy-peer-deps` install for something this small.

**The dragged row is tracked in React state, not on the `dataTransfer`.** That is not a preference: `dragover` is forbidden from calling `getData()`, so a highlight that needs to know *what* is being dragged has nothing to read. The transfer still gets a `setData('text/plain', …)` because Firefox will not begin a drag without one, but that payload is never read back.

**Breadcrumbs are drop targets too.** Without them drag could only ever move things *down*, since the table shows one level at a time. Dropping on a crumb never warns about audience, and that is deliberate rather than an omission: the breadcrumbs are the current folder's own ancestors, so a crumb drop moves the item to a **prefix** of the chain it already sits under. The new ancestor set is a subset of the old, so it can only widen the audience or leave it alone. Only the table's folder rows can narrow it, and those confirm first with the same sentence the picker shows.

Two smaller things that are easy to regress:

- **Images and anchors are draggable by default.** Every `<img>` and `<a>` in a row carries `draggable={false}`; without it, grabbing the thumbnail or the download link starts an image or URL drag and the row move never begins.
- **`dragleave` fires when the pointer crosses onto a child**, so the highlight is only cleared when `e.currentTarget.contains(e.relatedTarget)` is false. Otherwise it flickers off over every button in the row.

**Drag is polish, not the mechanism.** It does not work on touch and it is not keyboard-reachable, so the Move button stays visible on every row as the real path. Anything drag can do, the picker can do.

### Renaming

`PATCH /documents/:id` and `PATCH /documents/folders/:id`, driven by one `RenameModal` for both tables (a folder's label is `name`, a document's is `filename`).

**The two routes have different permissions**, which is why the button is gated per row rather than per page. Document rename is open to **the uploader for their own row, plus eboard and cabinet for any row**; folder rename stays **eboard + cabinet**, because a folder has no uploader for a member to be.

**The dialog preselects the basename, the way a file manager does.** Renaming `minutes-3-4.pdf` should not mean retyping `.pdf` or silently dropping it. `mime_type` still drives the in-portal preview either way, but a file downloaded without its extension is one the member's own OS cannot open. Folders and links have no extension to protect, so they select whole.

Renaming an upload never touches `storage_path`. The stored file keeps its own name, and the dialog says so.

---

## Content visibility

Eboard can restrict an album, a folder or an individual document to specific member groups or committees, using the same `audience TEXT[]` + `committee_ids INTEGER[]` targeting as events and announcements rather than a second permission concept. Everything is unrestricted by default, so applying this changed nothing that already existed.

Restricted content is **hidden entirely, not shown-and-locked**. A visible-but-locked folder still leaks its name, and folder names are things like "Exec Only".

**Eboard sees everything** regardless of audience — otherwise restricting an album would remove it from the screen used to un-restrict it.

### Documents are the one place NULL does not mean "everyone"

For an album or folder, no audience means everyone. For a **document**, both columns NULL means **inherit the folder**. That is why the UI shows an Inherit/Custom toggle rather than a bare audience picker: with a plain picker there is no way to express "follow the folder", and clearing the selection would silently publish a file sitting inside a restricted folder. `parseAudience(body, { inheritable: true })` is what keeps the two apart, and `setDocumentVisibility({ inherit: true })` sends an empty body rather than an empty array.

### Setting it

Eboard picks an audience when creating an album or folder, and can change it afterwards from the lock button on any album card or document row (`PATCH /albums/:id/visibility`, `PATCH /documents/folders/:id/visibility`, `PATCH /documents/:id/visibility`). Before these existed, visibility could only be set at creation and changing an album's audience meant deleting and recreating it, losing the photos.

:::caution An override on a document can only narrow, never widen
A document's effective audience is **its folder's audience ∩ its own**: the folder gates navigation (documents are only ever listed by folder) while the document's override gates the row. So restricting a file to a group that is not already in its folder's audience leaves it visible to **eboard alone** — the intended group still cannot open the folder to reach it.

This has been hit in practice and reads as "I restricted a file and it vanished completely". To let a group see one file, the file has to live somewhere that group can already reach. Related trap in the same control: **Custom with nothing ticked** sends two empty arrays, which stores as an override meaning *everyone* — inside a restricted folder that is the leak direction, not the lockout one.
:::

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

### Collections

Photos are grouped into named **collections**, so eboard can run several galleries side by side ("Spring Formal 2026", "Hackathon Fall 2025") instead of one flat list everything piles into. The manager shows them as a bar of pills; picking one scopes the grid, the reordering, the bulk actions and any new uploads to that collection.

Each collection has a title, an optional subtitle, an optional event date, an optional link with its own label, and a "show on the homepage" toggle.

:::note Two surfaces, one set of collections
The **homepage** shows only the collections marked as featured, and only a few of them. The **`/gallery` page** shows all of them, newest first.

That split is a performance rule rather than a design preference. The media endpoint serves the **original** file — there is no thumbnail variant — so every collection added to the landing page makes it permanently slower for every visitor. `/gallery` is a page somebody chooses to open, so it can carry the full archive.
:::

:::warning The event date is what orders the gallery, not the upload date
Set it to **when the event happened**. Eboard uploads last autumn's photos in spring, and ordering by upload time would file them under the wrong semester and push them above everything newer.

A collection with no date is treated as unplaced and sorts last, rather than as the oldest thing on the page.
:::

**Deleting a collection deletes its photos.** The API refuses the first attempt and answers with the real count, so the confirmation says "12 photos are in this collection" rather than guessing. The originals stay in Immich either way.

Nothing was lost when this shipped: the migration filed every existing photo into one "Chapter Gallery" collection, so the homepage rendered identically the moment it ran.

**The old hardcoded "Hackathon Highlights" section is now one of these collections.** It used to be a fixed array of images and a hand-written subtitle in `components/template-page.jsx`, which meant a developer and a deploy to change it every year. The original is still in that file, commented out, in case it needs to be put back.

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
