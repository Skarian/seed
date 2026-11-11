/** The facts about one result, label beside value: lineage, settings, where it ran, its prompt, collections and note. */
import { useEffect, useState, type ReactNode } from 'react';
import {
  assets as assetsApi,
  collections as collectionsApi,
  kindOf,
  isVideoKind,
  type AssetCollection,
  type AssetDetail,
  type JobRecord,
} from '../api.js';
import { useApp, type ViewerItem } from '../data.js';
import { Icon } from '../icons.js';
import { Thumb } from '../ui.js';
import { titleOf, settingChips, targetLabel } from '../format.js';
import { roleLabels } from '../project/requests.js';
import { useStyles } from '../project/styles.js';
import { derivedFromOf, readyIn, takeOf, useFamily } from './assetDetail.js';
import { NoteField, type Note } from './Organize.js';

/** A small linked picture of a related result, opening it in the inspector. */
function Related({ x, children }: { x: Pick<ViewerItem, 'asset' | 'kind' | 'title' | 'job'>; children: ReactNode }) {
  const app = useApp();
  const { asset, kind, title, job } = x;
  return (
    <button onClick={() => app.inspect({ asset, kind, title, job, project: job?.source?.chat_id })}>
      <Thumb id={x.asset} kind={x.kind} alt="" />
      {children}
    </button>
  );
}

type Props = {
  item: ViewerItem;
  job?: JobRecord;
  detail: AssetDetail | null;
  /** What it is chosen as in its project, already read by the panel. */
  usedAs: string[];
  onClosed?: () => void;
  /** Opens the collections dialog. */
  onCollections: () => void;
};

export function AssetFacts({ item, job, detail, usedAs, onClosed, onCollections }: Props) {
  const app = useApp();
  const { parents, children } = useFamily(item, job);
  const styles = useStyles(app.mode);
  const [note, setNote] = useState<Note | null>(null);
  useEffect(() => {
    void assetsApi
      .note(item.asset)
      .then(setNote)
      .catch(() => setNote({ note: '', revision: 0 }));
  }, [item.asset]);
  const [allCols, setAllCols] = useState<AssetCollection[]>([]);
  useEffect(() => {
    void collectionsApi
      .list(app.mode)
      .then(setAllCols)
      .catch(() => {});
  }, [app.mode, detail?.collection_ids?.join()]);
  const memberOf = allCols.filter(c => detail?.collection_ids?.includes(c.id));
  const derivedFrom = derivedFromOf(detail, app.tasks);
  // A crop or picked frame belongs to the project of the image it came from.
  const home = job?.source ?? derivedFrom?.job?.source;
  const r = job?.request;
  return (
    <div className="kv">
      {usedAs.length > 0 && (
        <>
          <span>Used as</span>
          <div>{usedAs.join(' · ')}</div>
        </>
      )}
      <span>Made from</span>
      <div>
        {parents.length ? (
          <span className="lineage">
            {parents.map(p => (
              <Related key={p.asset} x={p}>
                <span>
                  <b style={{ fontWeight: 500 }}>{p.title}</b> · {roleLabels[p.role] ?? p.role}
                </span>
              </Related>
            ))}
          </span>
        ) : derivedFrom ? (
          <span className="lineage">
            <Related x={derivedFrom}>
              <span>
                <b style={{ fontWeight: 500 }}>{derivedFrom.title}</b> · {derivedFrom.how}
              </span>
            </Related>
          </span>
        ) : (
          <span className="faint">
            {job ? 'A text prompt (no input image)' : detail && !detail.job_id ? 'Uploaded' : '—'}
          </span>
        )}
      </div>
      {children.length > 0 && (
        <>
          <span>Made from this</span>
          <div className="lineage">
            {children.slice(0, 8).map(c => (
              <Related
                key={c.asset}
                x={{
                  asset: c.asset,
                  kind: isVideoKind(kindOf[c.job.request.workflow]) ? 'video' : 'image',
                  title: titleOf(c.job.request),
                  job: c.job,
                }}
              >
                {titleOf(c.job.request)}
                {takeOf(c.job)}
              </Related>
            ))}
          </div>
        </>
      )}
      {r && (
        <>
          <span>Settings</span>
          <div>
            {settingChips(r, id => id)
              .filter(([k]) => !k.startsWith('style') && k !== 'target')
              .map(([, v]) => v)
              .join(' · ')}
            {detail?.width ? ` · saved at ${detail.width}×${detail.height}` : ''}
          </div>
        </>
      )}
      {r?.loras?.length ? (
        <>
          <span>Style</span>
          <div>
            {r.loras.map(l => `${styles.find(s => s.id === l.id)?.name ?? 'Style'} · strength ${l.scale}`).join(', ')}
          </div>
        </>
      ) : null}
      {job && (
        <>
          <span>Seed</span>
          <div>{job.seed}</div>
          <span>Ran on</span>
          <div>
            {job.worker?.executor === 'local'
              ? 'Seed PC'
              : job.worker?.executor === 'cloud'
                ? 'Cloud GPU'
                : targetLabel(r?.target)}
            {readyIn(job)}
          </div>
        </>
      )}
      {home?.chat_id && (
        <>
          <span>Project</span>
          <div>
            <button
              className="link"
              onClick={() => {
                onClosed?.();
                app.go({ name: 'project', id: home.chat_id!, view: 'conversation', focus: home.card_id });
              }}
            >
              {app.projectList.find(p => p.id === home.chat_id)?.title ?? 'Open project'} · show in conversation
            </button>
          </div>
        </>
      )}
      {r && (
        <>
          <span>Prompt</span>
          <div>
            <details open={!app.narrow && r.prompt.length < 600}>
              <summary
                className="link"
                style={{ cursor: 'pointer' }}
              >{`${r.prompt.split(/\s+/).length} words`}</summary>
              <div className="prompt">
                {r.prompt.replace(
                  /\[\[input(\d+)\]\]|<(?:Picture|Video|Audio) (\d+)>|<image(\d+)>/g,
                  (m, x?: string, y?: string, z?: string) => {
                    const p = parents[Number(x ?? y ?? z) - 1];
                    return p ? '“' + p.title + '”' : m;
                  },
                )}
              </div>
            </details>
          </div>
        </>
      )}
      <span>Collections</span>
      <div className="chips">
        {memberOf.map(c => (
          <button
            key={c.id}
            className="chip"
            aria-label={'Open collection ' + c.name}
            onClick={() => {
              onClosed?.();
              app.go({ name: 'library', collection: c.id });
            }}
          >
            {c.name}
          </button>
        ))}
        <button className="chip" onClick={onCollections}>
          <Icon.Plus />
          {memberOf.length ? 'Change' : 'Add to collection'}
        </button>
      </div>
      <span>Note</span>
      <div>
        <NoteField asset={item.asset} note={note} onSaved={setNote} />
      </div>
    </div>
  );
}
