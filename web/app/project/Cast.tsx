import React, { useState } from 'react';
import { castFromBrief, referenceKey, type CastEntry } from '../../../shared/cast.js';
import type { ViewerItem } from '../data.js';
import { Media, Dialog } from '../ui.js';

/** What Seed is asked when the owner wants a reference drafted; Seed carries the look from the brief. */
export const referenceAsk = (e: CastEntry) =>
  e.kind === 'prop'
    ? `Draft a prop reference for ${e.name} from the brief: ${e.name} alone, whole and in focus, on a plain light-grey background in soft even light, no people, at 1:1 with 4 takes, titled "Reference: ${e.name}". Leave the other drafts as they are. Do not run anything.`
    : e.kind === 'place'
      ? `Draft a place reference for ${e.name} from the brief: a wide picture of ${e.name} with no people, in clear light, at 16:9 with 4 takes, titled "Reference: ${e.name}". Leave the other drafts as they are. Do not run anything.`
      : `Draft a character reference for ${e.name} from the brief: ${e.name} alone, full length, standing and facing the camera, on a plain light-grey background in soft even light, at 4:5 with 4 takes, titled "Reference: ${e.name}". Leave the other drafts as they are. Do not run anything.`;
export const sheetAsk = (e: CastEntry) =>
  `Draft a reference sheet for ${e.name} as an edit of ${e.name}'s approved reference, at 16:9: the same person full length from the front, three-quarter, side and back, plus a head-and-shoulders close-up, in the same outfit on a plain light-grey background, titled "Reference sheet: ${e.name}". Do not run anything.`;

/**
 * The characters and places of the brief, each with the reference image the owner approved for it. Seed drafts the
 * shots they appear in from these images (FLUX 3 Image Klein), so a face, a coat or a lighthouse carries from shot to shot.
 */
export function CastStrip({
  brief,
  picks,
  images,
  busy,
  onChoose,
  onAsk,
  onOpen,
}: {
  brief: string | null | undefined;
  picks: Record<string, string>;
  images: ViewerItem[];
  busy: string;
  onChoose: (key: string, asset: string | null) => void;
  onAsk?: (text: string) => void;
  onOpen: (item: ViewerItem) => void;
}) {
  const cast = castFromBrief(brief);
  const [picking, setPicking] = useState<CastEntry | null>(null);
  if (!cast.length) return null;
  const approved = cast.filter(e => picks[referenceKey(e.name)]).length;
  return (
    // Once every reference is approved, the cast becomes a compact row so the film stays near the top.
    <section className={'cast-strip' + (approved === cast.length ? ' compact' : '')} aria-label="Cast and places">
      <div className="film-board-head">
        <b>{cast.some(e => e.kind === 'prop') ? 'Cast, places & props' : 'Cast & places'}</b>
        <span className="faint">
          {approved} of {cast.length} approved · new shots use these pictures
        </span>
      </div>
      <ul className="cast-cells">
        {cast.map(e => {
          const key = referenceKey(e.name),
            id = picks[key],
            item = images.find(i => i.asset === id);
          const name = e.name.toLowerCase();
          // Results drafted as this name's reference come first in the menu.
          const options = [
            ...images.filter(i => i.title.toLowerCase().includes(name)),
            ...images.filter(i => !i.title.toLowerCase().includes(name)),
          ].slice(0, 30);
          const kind = { character: 'Character', place: 'Place', prop: 'Prop' }[e.kind];
          return (
            <li key={e.name} className={'cast-cell ' + e.kind + (id ? ' done' : '')}>
              <button
                className="cast-thumb"
                disabled={!item}
                onClick={() => item && onOpen(item)}
                aria-label={id ? `Open ${e.name}’s reference` : `${e.name} has no reference yet`}
              >
                {id ? <Media id={id} kind="image" alt="" /> : <span className="faint">No reference</span>}
              </button>
              <span className="cast-text">
                <b>{e.name}</b>
                <small className="faint" title={e.look}>
                  {kind} · {id ? 'Approved' : 'No picture yet'}
                </small>
              </span>
              <span className="cast-actions">
                {onAsk && !id && (
                  <button className="btn small" onClick={() => onAsk(referenceAsk(e))}>
                    Draft reference
                  </button>
                )}
                {onAsk && id && e.kind === 'character' && (
                  <button className="btn small" onClick={() => onAsk(sheetAsk(e))}>
                    Draft sheet
                  </button>
                )}
                {options.length > 0 && (
                  <button
                    className="btn small"
                    aria-label={id ? `Change ${e.name}’s reference` : `Approve a picture as ${e.name}’s reference`}
                    onClick={() => setPicking(e)}
                  >
                    {id ? 'Change' : 'Approve…'}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {picking &&
        (() => {
          const key = referenceKey(picking.name),
            id = picks[key],
            name = picking.name.toLowerCase();
          const own = images
            .filter(i => i.title.toLowerCase().includes(name))
            .sort((x, y) => x.title.localeCompare(y.title, undefined, { numeric: true }))
            .slice(0, 24);
          const rest = images.filter(i => !i.title.toLowerCase().includes(name)).slice(0, 30);
          const tile = (o: ViewerItem) => (
            <li key={o.asset}>
              <button
                className={'pick-tile' + (o.asset === id ? ' on' : '')}
                aria-pressed={o.asset === id}
                disabled={busy === key}
                onClick={() => {
                  onChoose(key, o.asset);
                  setPicking(null);
                }}
              >
                <span className="pick-thumb">
                  <Media id={o.asset} kind="image" alt="" />
                </span>
                <small>{o.title.replace(/^Reference:\s*/i, '')}</small>
              </button>
            </li>
          );
          return (
            <Dialog
              title={`${picking.name}’s reference`}
              wide
              onClose={() => setPicking(null)}
              footer={
                id ? (
                  <button
                    className="btn danger"
                    onClick={() => {
                      onChoose(key, null);
                      setPicking(null);
                    }}
                  >
                    Clear the reference
                  </button>
                ) : undefined
              }
            >
              <p className="faint" style={{ marginTop: 0 }}>
                Pick the picture that shows {picking.name} best. New shots with {picking.name} are drawn from it.
              </p>
              {own.length > 0 && <ul className="pick-grid">{own.map(tile)}</ul>}
              {rest.length > 0 && (
                <details open={!own.length}>
                  <summary className="link">Other pictures in this project ({rest.length})</summary>
                  <ul className="pick-grid">{rest.map(tile)}</ul>
                </details>
              )}
            </Dialog>
          );
        })()}
    </section>
  );
}
