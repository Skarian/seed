import React, { useState } from 'react';
import type { LibraryAsset } from '../shared/studio.js';
import { useLibrary, type LibraryFilter } from './hooks/use-library.js';
import {useLibraryPreview} from './hooks/use-library-preview.js';
import { MediaCard, LoadingIndicator } from './media-card.js';
import { MediaPreview } from './media-preview.js';
import { AssetNote } from './asset-note.js';
import { ConfirmDialog } from './confirm-dialog.js';
import {FavoriteButton,AssetCollections,CollectionGlyph} from './asset-organization.js';
import {CollectionManager,LibraryFilters,useCollections} from './collections.js';

export function Library({
  mode,
  filter,
  onDeleted,
  favoritesOnly,onFavoritesChange,collectionId,onCollectionChange,
}: {
  mode: 'sfw' | 'nsfw';
  filter: LibraryFilter;
  onDeleted: (id: string) => void;
  favoritesOnly:boolean;onFavoritesChange:(value:boolean)=>void;collectionId:string;onCollectionChange:(id:string)=>void;
}) {
  const library = useLibrary(mode, filter, onDeleted,favoritesOnly,collectionId),collections=useCollections(mode);
  const [manage,setManage]=useState(false),[organize,setOrganize]=useState<string|null>(null);
  const browsing=useLibraryPreview(library,JSON.stringify([mode,filter,favoritesOnly,collectionId])),preview=browsing.asset;
  const [deleting, setDeleting] = useState<LibraryAsset | null>(null);
  return (
    <section className="library">
      <div className="library-heading">
        <h1>Library</h1>
      </div>
      <LibraryFilters collections={collections} favoritesOnly={favoritesOnly} onFavoritesChange={onFavoritesChange} collectionId={collectionId} onCollectionChange={onCollectionChange} onManage={()=>setManage(true)}/>
      {library.error && <p role="alert">{library.error}</p>}
      {!library.loaded ? (
        <LoadingIndicator label="Loading Library…" />
      ) : !library.items.length ? (
        <div className="library-empty">
          <p>{favoritesOnly?(collectionId?'No favorites in this collection.':'No favorites yet. Use the star on a file to save it here.'):collectionId?'This collection has no matching files. Add files using the collection button on a file or in its preview.':'No saved files yet.'}</p>
        </div>
      ) : (
        <div className="library-grid">
          {library.items.map((asset) => (
            <MediaCard
              key={asset.id}
              src={'/api/v1/assets/' + asset.id + '/content'}
              kind={asset.kind}
              name={asset.name}
              onOpen={() => browsing.open(asset)}
              onDelete={() => setDeleting(asset)}
              deleting={Boolean(library.deleting)}
              actions={<><FavoriteButton assetId={asset.id} favorite={asset.favorite??false}/><button type="button" className="asset-organization-button" aria-label={'Add '+asset.name+' to collection'} title="Add to collection" onClick={()=>setOrganize(asset.id)}><CollectionGlyph/></button></>}
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
            id:preview.id,favorite:preview.favorite,
            name: preview.name,
            url: '/api/v1/assets/' + preview.id + '/content',
            kind: preview.kind,
            type: preview.kind,
          }}
          onClose={browsing.close}
          navigation={browsing.navigation}
          controls={library.error&&<p role="alert">{library.error}</p>}
          note={<AssetNote key={preview.id} id={preview.id} />}
        />
      )}
      {manage&&<CollectionManager mode={mode} onClose={()=>setManage(false)}/>}
      {organize&&<AssetCollections assetId={organize} onClose={()=>setOrganize(null)}/>}
    </section>
  );
}
