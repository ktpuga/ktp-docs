---
sidebar_position: 2
---

# Photos & Documents

The **Files & Photos** portal tab has two parts: a member-facing photo/album system, and an eboard-managed document library. There's also a completely separate, fully public homepage gallery. See [API: Photos & Albums](../api/endpoints.md#photos--albums) for the backend routes behind all of this.

---

## Shared photo albums

Two ways photos are organized:

- **Shared Album** — a single general album open to everyone (active, chair, alumni, eboard, pledge). Anyone can upload; the uploader can delete their own photo.
- **Eboard-created named albums** — e.g. "Spring Retreat 2026." Only eboard can create a new album; anyone in the shared-album groups can browse into one and upload. An eboard member can additionally delete any photo inside an album **they personally created** (moderation — not blanket access to every album someone else made).

Both images and video are supported (250MB upload limit). Photos and videos are served through `PhotoMedia`, a small shared component that picks `<img>` vs `<video controls>` by the photo's `media_type` — reused everywhere a photo/video renders (album grids, the dashboard's "Recent Photos" preview).

Photos are stored in Immich, but never exposed directly to the browser — ktp-api proxies every request server-side, and the website further proxies through its own `/api/photos/:id/media` route so the Immich API key never reaches the client.

---

## Documents

A nested folder/file library for things like bylaws, meeting minutes, and course files — a completely different storage system from photos, since these are arbitrary file types (PDFs, Word docs, etc.), not something Immich handles well. Files live directly on ktp-api's own disk.

- **Eboard only**: create folders (nested to any depth), upload files, delete files/folders.
- **Any shared-album-group member**: browse, download, preview.
- **In-portal preview**: clicking a document opens a modal without leaving the page — images render inline, PDFs render in an embedded viewer, and anything else (Word, Excel) shows a "download instead" message rather than a broken preview attempt. Implemented as a small hand-rolled modal, not a UI-library dialog — matches how `Tabs` is already hand-rolled in this codebase.
- The document icon in the file list shows an actual thumbnail for images; everything else gets a generic file icon.

---

## Public homepage gallery

A completely separate system from the two above — the "Chapter Gallery" section shown on the actual public homepage, visible to anyone with no login. Managed at `/admin/homepage-photos` (eboard only):

- Upload a file directly, **or** register an already-uploaded Immich asset by pasting its asset id (for cases where someone — e.g. the SWE committee — uploaded straight into the Immich UI). Registering by id validates the asset actually exists before saving, to avoid a typo'd id causing a broken image.
- Reorder photos via up/down buttons (`display_order`).
- Removing a photo only unlists it from the gallery — it does not delete the underlying Immich asset, since that asset might be reused elsewhere.

---

## Why three separate systems instead of one

Deliberate: different audiences (public vs. members-only), different permission models (curated/eboard-only vs. self-service upload-and-delete-your-own), and different lifecycles. Folding them into one generic "media" table would have meant either exposing member photos publicly by accident, or bolting an audience flag onto every row and checking it on every single read — splitting them by table makes the access boundary the schema itself, not application logic that could have a bug in it.
