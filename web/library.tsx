import React, { useState } from 'react';
import type { LibraryAsset } from '../shared/studio.js';
import { useLibrary, type LibraryFilter } from './hooks/use-library.js';
import { MediaCard, LoadingIndicator } from './media-card.js';
import { MediaPreview } from './media-preview.js';
import { AssetNote } from './asset-note.js';
import { ConfirmDialog } from './confirm-dialog.js';

export function Library({
  mode,
  filter,
  onDeleted,
}: {
  mode: 'sfw' | 'nsfw';
  filter: LibraryFilter;
  onDeleted: (id: string) => void;
}) {
  const library = useLibrary(mode, filter, onDeleted);
  const [preview, setPreview] = useState<LibraryAsset | null>(null),
    [deleting, setDeleting] = useState<LibraryAsset | null>(null);
  return (
    <section className="library">
      <div className="library-heading">
        <h1>Library</h1>
      </div>
      {library.error && <p role="alert">{library.error}</p>}
      {!library.loaded ? (
        <LoadingIndicator label="Loading Library…" />
      ) : !library.items.length ? (
        <div className="library-empty">
          <p>No saved files yet.</p>
        </div>
      ) : (
        <div className="library-grid">
          {library.items.map((asset) => (
            <MediaCard
              key={asset.id}
              src={'/api/v1/assets/' + asset.id + '/content'}
              kind={asset.kind}
              name={asset.name}
              onOpen={() => setPreview(asset)}
              onDelete={() => setDeleting(asset)}
              deleting={Boolean(library.deleting)}
            />
          ))}
        </div>
      )}
      {library.cursor && (
        <button
          className="queue-control"
          disabled={library.loadingMore}
          onClick={() => void library.more()}
        >
          {library.loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete this ${deleting.kind}?`}
          description="This permanently removes the saved file from your PC. This cannot be undone."
          action="Delete"
          onConfirm={() => library.remove(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
      {preview && (
        <MediaPreview
          label={preview.kind === 'image' ? 'Saved image' : 'Saved media'}
          media={{
            name: preview.name,
            url: '/api/v1/assets/' + preview.id + '/content',
            kind: preview.kind,
            type: preview.kind,
          }}
          onClose={() => setPreview(null)}
          note={<AssetNote id={preview.id} />}
        />
      )}
    </section>
  );
}
