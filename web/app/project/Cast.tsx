import React from 'react';
import { castFromBrief, referenceKey, type CastEntry } from '../../../shared/cast.js';
import type { ViewerItem } from '../data.js';
import { Media, MenuButton } from '../ui.js';

/** What Seed is asked when the owner wants a reference drafted; Seed carries the look from the brief. */
export const referenceAsk = (e: CastEntry) =>
  e.kind === 'place'
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
  if (!cast.length) return null;
  const approved = cast.filter(e => picks[referenceKey(e.name)]).length;
  return (
    <section className="cast-strip" aria-label="Cast and places">
      <div className="film-board-head">
        <b>Cast &amp; places</b>
        <span className="faint">
          {approved} of {cast.length} with an approved reference · shots they appear in are drafted from it
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
          const kind = e.kind === 'place' ? 'Place' : 'Character';
          return (
            <li key={e.name} className={'cast-cell' + (id ? ' done' : '')}>
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
                  {kind} · {id ? 'Approved' : 'From words only'}
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
                  <MenuButton
                    className="btn small"
                    align="start"
                    label={id ? `Change ${e.name}’s reference` : `Approve a result as ${e.name}’s reference`}
                    items={[
                      ...options.map(o => ({
                        label: o.title,
                        checked: o.asset === id,
                        disabled: busy === key,
                        onSelect: () => onChoose(key, o.asset === id ? null : o.asset),
                      })),
                      ...(id
                        ? [
                            'divider' as const,
                            { label: 'Clear the reference', onSelect: () => onChoose(key, null), danger: true },
                          ]
                        : []),
                    ]}
                  >
                    {id ? 'Change' : 'Approve…'}
                  </MenuButton>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
