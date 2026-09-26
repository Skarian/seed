# Favorites and collections

Status: implemented and published on 26 September 2026, including the subsequent named-collections and Gallery-picker requests. Three independent source reviews covered persistence, Library, and generated-output surfaces. No live/private media, requests or chats were inspected. See the [implementation and QA report](asset-organization-qa-2026-09-26.md).

## Approved additions, now implemented

- Named collections with create, rename and confirmed deletion; files can belong to multiple collections. Deleting a collection preserves its files and their favorite state.
- Collection membership in the shared media preview and Library tiles. A new collection can be created while adding a file.
- One reusable Favorites/Collection filter component in Library and the Gallery picker used by Chat and Generate. Both filters combine with media type; selected references survive filter changes.
- Schema 10 also adds collections and collection membership tables with foreign-key cleanup. Metadata stays in the local application database; files are not copied.

The original approved favorites design below remains useful background. Actual validation and delivery are recorded in the linked report.

## Scope and experience

Favorite individual saved images, videos and audio files. Uploaded references and picked frames use the same behavior. Each output in a multi-output generation can be marked separately.

- Library: a star on each tile, visible on desktop and mobile, separate from opening or deleting the file.
- Preview: the same star in the shared toolbar. This covers outputs opened from Generate, Chat and Activity, plus Library and saved references.
- Library heading: a Favorites-only toggle that combines with the existing All media / Images / Videos / Audio choices. Preserve newest-first ordering and keep the toggle selected when changing media type.
- Empty Favorites: “No favorites yet. Use the star on a file to save it here.”
- Outline/filled star and accessible Add to favorites / Remove from favorites labels. At least a 44px touch target and `aria-pressed` state. A successful change is shown by the star; failed saves show a clear error.

Generated outputs are favorited in their full preview for the initial version. Small Generate/Chat thumbnails keep their existing opening action. Direct stars on those thumbnails could follow if needed; they require additional asset-state loading and careful separation from their existing button/selection behavior.

Favorite status persists across reloads and server restarts. It does not protect a file from deletion. New generations and newly picked frames start unfavorited. Existing visibility rules continue to apply without new mode-related copy.

## Smallest coherent implementation

1. **Persistence:** schema migration 10 adds `asset_favorites(asset_id PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE)`. Update the schema-version guard so version 10 reopens normally. A row means favorite; no additional timestamp or metadata fields are needed. Existing asset insert statements, worker metadata and job snapshots stay unchanged.
2. **API:** add `PUT /api/v1/assets/:id/favorite` with an explicit `{favorite: boolean}` body and return `{id, favorite}`. Setting a value is safe to retry. Validate the body, use existing mutation-origin protection, and return 404 for missing/deleted assets.
3. **Reads/filtering:** expose `favorite` in Library list and public asset detail responses. Add `favorites=true` to the existing paginated assets endpoint, combined with media type and visibility. Resolve cursor position before the favorites-only restriction so unfavoriting the cursor item does not break the next page.
4. **Shared UI:** one `FavoriteButton` and a small asset-favorite hook/mutation helper. Pass asset identity explicitly through preview metadata. Library supplies list state; existing preview loaders supply detail state. Avoid fetching favorite metadata once per Library tile.
5. **Updates:** guard duplicate in-flight writes per asset and publish successful changes by asset ID to other mounted views. Patch loaded Library rows immediately; remove an unfavorited row from Favorites even on an older loaded page. Reset pagination when filters change. Prevent an older in-flight read from undoing a newer saved state. Reuse existing Library refresh notifications; no new polling service or state-management dependency.
6. **Deletion:** foreign-key cleanup removes favorite rows when media is deleted, including sequence/frame cleanup paths. Do not recreate state for deleted media or expose an action for temporary local previews without a saved asset ID.

Primary files: `server/db.ts`, `server/media.ts`, `server/http.ts`, `shared/studio.ts`, `web/hooks/use-library.ts`, `web/library.tsx`, `web/media-card.tsx`, `web/media-preview.tsx`, `web/job-ui.tsx`, `web/app.tsx`, plus the new shared favorite control/hook and focused styles.

## Verification

Use an isolated test database and controlled fixture media; no paid GPUs or private user content needed.

- Migration/reopen, persisted set/unset, duplicate requests, missing assets, invalid bodies, mutation-origin protection and delete cleanup.
- Favorites combined with every media type and existing visibility scope; pagination past 50 files, including unfavoriting a page's cursor item.
- Generate preview → favorite → Library Favorites → unfavorite → preview agrees. Repeat the shared integration from Chat with controlled test content.
- Loaded older-page updates, reload, stale reads, failed writes, rapid clicks and filter changes during loading.
- Preserve existing preview opening, mobile pinch/pan and browser Back dismissal.
- Numbered desktop/mobile QA captures: normal/favorited Library, filtered/empty Library, image/video/audio preview, pending/error states and long filenames. Check 320px, 390px and desktop widths, especially image Edit image and video Pick Frame toolbar combinations. Review screenshots individually; deliver them in the existing gallery/mosaic format.

## Effort

Small feature, roughly a few hours including migration, implementation, automated checks and visual review. The main care is state consistency and mobile toolbar space. No changes to GPU acquisition, worker containers or generation scheduling are required.
