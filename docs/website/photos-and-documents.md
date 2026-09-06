---
sidebar_position: 2
---

# Photos & Documents

Files & Photos contains member albums and a document library. Public gallery collections and the iOS slideshow have separate management tabs under `/admin/homepage-media`. See [Photos & Albums](../api/endpoints.md#photos--albums) for API details.

## Shared photo albums

The general Shared Album accepts uploads from active members, chairs, alumni, eboard, and pledges. Eboard can create named albums; members can read and upload where album visibility allows.

Uploaders can delete their photos, and eboard can moderate any photo. Report and Block actions are hidden on the caller's own uploads.

`deletePhoto` removes the application row and returns `204` before attempting Immich cleanup. A missing or corrupt asset therefore does not prevent removal from the portal. Cleanup failures are logged and can leave unused Immich storage. `test/photoDelete.test.js` covers this ordering.

Uploads support images and video up to 250 MB. `PhotoMedia` selects image or video rendering from `media_type`. API and website media proxies keep the Immich API key server-side.

## Documents

Documents use API disk storage rather than Immich. The library also stores external links.

| Permission | Groups |
| --- | --- |
| Read accessible files | Shared-album groups, including pledges |
| Upload, add links, create unrestricted folders, manage own documents | Eboard, chair, active, alumni |
| Move items, rename folders, rename others' documents | Eboard and chair |
| Delete folders or others' documents; set visibility | Eboard |

`RevampedPhotoFiles` passes `isEboard`, `canManageDocs`, and `canContributeDocs`. Toolbar additions use contribution permission; move/drag use management permission; visibility uses eboard permission.

Row actions also check ownership:

| Action | UI condition |
| --- | --- |
| Rename document | `canManage \|\| isOwnUpload` |
| Delete document | `isEboard \|\| isOwnUpload` |
| Delete folder | `isEboard` |

`isOwnUpload` requires a document row, a non-null `uploaded_by`, and an exact match to the current user. The API rechecks permissions regardless of which controls are visible.

Keep `DOCUMENT_CONTRIBUTOR_GROUPS` explicit on both sides. Extending read access must not automatically grant contribution rights.

Images preview inline, PDFs use an embedded viewer, and unsupported preview formats offer download. Links open separately rather than passing through file preview.

### Uploading a folder

`planFolderUpload(fileList)` reads `webkitRelativePath` and infers all ancestor directories. `runFolderUpload` creates folders shallowest-first, then uploads files through the existing folder and document endpoints.

The flow has these limits and behaviors:

- Up to 100 files, checked before starting.
- Empty directories are not included because the picker returns files.
- Uploads run sequentially.
- Per-file failures are recorded and the remaining plan continues; authentication redirects propagate.
- Visible same-named folders are reused.
- The open level is reloaded after the run.
- Newly created folders have no explicit visibility restriction.

There is no bulk transaction. Review the result for partial failures. Folder creation and file upload must share contribution access so the operation does not fail at its first directory.

### Moving files and folders

`MoveToModal` uses `PATCH /documents/:id/folder` and `PATCH /documents/folders/:id/parent`. It browses one level at a time.

The picker disables the current destination and the folder being moved. The API also rejects moving a folder into itself or a descendant through `isDescendant`.

Moving an inheriting document changes its effective audience to the destination folder's audience. Explicit document overrides have different direct-access behavior; see [Content visibility](#content-visibility). Do not describe every move as an intersection of all ancestors.

### Drag-and-drop

Native drag handlers track the dragged row in React state so hover feedback does not depend on reading protected `dataTransfer` data. A text payload is still set for browser compatibility.

Folder rows and breadcrumbs are drop targets. Images and anchors within a row use `draggable={false}` so they do not start a different drag. Only clear a hover state when `relatedTarget` is outside the current target.

The Move button remains available for keyboard and touch users. Drag actions must retain the same API permission and destination checks.

### Renaming

One `RenameModal` handles folder `name` and document `filename`. Documents may be renamed by their uploader or a manager; folders require eboard/chair access.

For files, select the basename while retaining the extension by default. `mime_type` determines preview behavior, but an extension helps downloaded files open in local applications. Renaming does not change `storage_path`.

## Content visibility

Eboard can set album, folder, and document audiences using allowed member groups and committee IDs. Restricted rows are omitted from lists, and eboard can manage all visibility settings.

### Documents are the one place NULL does not mean "everyone"

For a document, both audience columns null mean inheritance from its folder. An explicit override supplies a separate audience. The UI's Inherit option sends an empty body; Custom with empty arrays is an explicit unrestricted override.

### Setting it

Use the lock control for:

- `PATCH /albums/:id/visibility`
- `PATCH /documents/folders/:id/visibility`
- `PATCH /documents/:id/visibility`

Folder navigation checks folder visibility. Direct document preview/download uses the document's effective audience in `findViewableDocument`: its override when present, otherwise its folder's audience.

**An override is not always intersected with folder visibility on direct access.** A reader may be unable to navigate into a folder while still qualifying for a known document's direct URL. Conversely, granting a document audience does not make its containing folder appear in that reader's navigation.

Restricted badges show an item's own settings. An inheriting document may be restricted through its folder even without an explicit document badge.

### Filtering the list is not enough

Photo media, document download, and preview routes check visibility independently. Download and preview share a guard and return `404` for inaccessible content.

`parseAudience` rejects unknown groups and malformed committee IDs. Photos/documents exclude `rush`; the picker must exclude it too. Creation and update handlers must preserve validation status codes and show errors in their modals.

When building conditional SQL, add parameters only in branches that reference them. An eboard query with no visibility placeholders must not receive unused visibility parameters. `test/visibility.test.js` exercises complete model queries for eboard and other callers.

For database-backed tests, set `TEST_DATABASE_URL` to an isolated test database and run `npm test`. Confirm which tests ran: suites requiring the variable may skip without it. Use an existing test container when one is already available.

## Public homepage gallery

Eboard manages the public gallery in the Website tab at `/admin/homepage-media`.

Upload a file or register an existing Immich asset. Registration validates the asset before storing the row. Removing a gallery row leaves the original asset in Immich.

### The hero collage rotates from the gallery

`lib/hero-photos.js` chooses six usable photos server-side from a featured collection. The sliding window advances by six every four hours.

The fetch has a 1.5-second timeout and falls back to six bundled images. Collections with fewer than six usable images are skipped in favor of another suitable featured collection. Videos are excluded.

The hero uses Next Image optimization because public media routes serve original assets. Keep its optimization settings separate from other gallery views.

### Collections

Collections have a title, optional subtitle, event date, optional labeled link, and homepage-featured setting. Selecting a collection scopes uploads, ordering, and bulk actions.

The homepage shows a limited featured set. `/gallery` shows the full collection archive, ordered by event date with undated collections last.

Collection deletion requires confirmation with the actual photo count. It removes gallery rows, not the Immich originals. Existing photos were migrated into the Chapter Gallery collection; the former hardcoded highlights now use the same collection system.

## iOS homepage slideshow

The iOS App tab manages authenticated slideshow content through `/ios-homepage-photos`, separately from the public `/homepage-photos` gallery.

Slides contain title, alt text, optional subtitle and HTTPS link, active state, and optional start/end times. Only active slides within their schedule appear.

Limits: ten active slides, 100 MB per upload, JPEG/PNG/HEIC/HEIF/WebP, no animation, and source size at least 900 × 600. Processing crops around the focal point and produces a progressive JPEG. See [Slideshow endpoints](../api/endpoints.md#ios-homepage-slideshow).

## Why four separate systems instead of one

Member photos, documents, public gallery collections, and app slides have different storage, readers, write permissions, and deletion behavior. Their separate tables make those distinctions explicit; API authorization is still required on each route.
