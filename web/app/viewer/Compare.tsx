/** Two results side by side at matched size, with what separates them: settings, seed, prompt and lineage. */
import { useEffect, useState } from 'react';
import { shotFromTitle, shotNameKey } from '../../../shared/shots.js';
import { shotKey } from '../../../shared/choices.js';
import { assets as assetsApi, projects as projectsApi, media, type JobRecord } from '../api.js';
import { putProject, useApp, type ViewerItem } from '../data.js';
import { Icon } from '../icons.js';
import { Overlay } from '../ui.js';
import { titleOf, settingChips, promptChanges } from '../format.js';
import { useStyles } from '../project/styles.js';
import { useDetail } from './assetDetail.js';
import { FavoriteButton } from './AssetPanel.js';

/** Two results, A and B, at matched size. Phones show one at a time with an A | B switch. */
export function Compare({ a, b, onClose }: { a: ViewerItem; b: ViewerItem; onClose: () => void }) {
  const app = useApp();
  const [side, setSide] = useState<'A' | 'B'>('A'),
    [zoom, setZoom] = useState(1),
    [diff, setDiff] = useState(!app.narrow);
  const [favs, setFavs] = useState<Record<string, boolean>>({});
  const toggleZoom = () => setZoom(z => (z === 1 ? 2 : 1));
  // Both takes of one numbered shot: either can be chosen for the shot right here.
  const shotOf = (x: ViewerItem) => shotFromTitle(x.job ? titleOf(x.job.request) : x.title);
  const sa = shotOf(a),
    sb = shotOf(b);
  const sameShot =
    sa.n !== null && sa.n === sb.n && shotNameKey(sa.name) === shotNameKey(sb.name) && a.project && a.kind === b.kind
      ? String(sa.n)
      : undefined;
  const [chosenId, setChosenId] = useState<string | null>(null);
  async function useForShot(x: ViewerItem) {
    try {
      const p = await projectsApi.choose(x.project!, {
        shot: shotKey(Number(sameShot), shotOf(x).name),
        kind: x.kind === 'video' ? 'clip' : 'image',
        asset: x.asset,
      });
      setChosenId(x.asset);
      putProject(p);
      app.toast(`Chosen for Shot ${sameShot}`);
    } catch (e) {
      app.toast((e as Error).message);
    }
  }
  useEffect(() => {
    for (const x of [a, b])
      void assetsApi
        .get(x.asset)
        .then(d => setFavs(f => ({ ...f, [x.asset]: Boolean(d.favorite) })))
        .catch(() => {});
  }, [a.asset, b.asset]);
  const fig = (x: ViewerItem, letter: 'A' | 'B') => (
    <figure
      key={letter}
      className={app.narrow && side !== letter ? 'hidden-phone' : ''}
      aria-label={letter + ': ' + x.title}
    >
      {/* The label sits above the picture, never over a face. */}
      <span className="pill letter">
        {letter} · {x.title}
      </span>
      <div className="frame" onClick={toggleZoom}>
        {x.kind === 'video' ? (
          <video src={media.content(x.asset)} controls playsInline muted loop />
        ) : (
          <img
            src={media.preview(x.asset, true)}
            alt={x.title}
            style={{ transform: `scale(${zoom})`, transition: 'transform .15s' }}
          />
        )}
      </div>
      <figcaption>
        <FavoriteButton
          fav={favs[x.asset]}
          subject={letter}
          onToggle={() =>
            void assetsApi
              .favorite(x.asset, !favs[x.asset])
              .then(() => setFavs(f => ({ ...f, [x.asset]: !f[x.asset] })))
          }
        />
        <button
          className="btn primary"
          onClick={() => {
            onClose();
            app.useResult(x, 'refine');
          }}
        >
          Refine {letter}
        </button>
        {sameShot && (
          <button className="btn" aria-pressed={chosenId === x.asset} onClick={() => void useForShot(x)}>
            {chosenId === x.asset ? `Chosen for Shot ${sameShot}` : `Use ${letter} for Shot ${sameShot}`}
          </button>
        )}
      </figcaption>
    </figure>
  );
  return (
    <Overlay
      className="viewer"
      label="Compare two results"
      onClose={onClose}
      onKeyDown={e => {
        if (e.key === 'a' || e.key === 'ArrowLeft') setSide('A');
        if (e.key === 'b' || e.key === 'ArrowRight') setSide('B');
      }}
    >
      <div className="vtop">
        <button className="btn small close" onClick={onClose} autoFocus>
          <Icon.Close />
          Close
        </button>
        <b className="compare-title">Compare</b>
        <div className="seg phone-only" role="group" aria-label="Show A or B">
          <button aria-pressed={side === 'A'} onClick={() => setSide('A')}>
            A
          </button>
          <button aria-pressed={side === 'B'} onClick={() => setSide('B')}>
            B
          </button>
        </div>
        <span className="faint no-phone no-touch" style={{ fontSize: '0.875rem' }}>
          Click a picture to zoom both
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="btn small"
          onClick={toggleZoom}
          title={zoom > 1 ? 'Both are at 2×; show both whole again' : 'Zoom both to 2×'}
        >
          {zoom > 1 ? '2× · Fit both' : 'Zoom 2×'}
        </button>
        <button className="btn small" aria-pressed={diff} onClick={() => setDiff(d => !d)}>
          Settings differences
        </button>
      </div>
      {diff && <Differences a={a} b={b} />}
      <div className="compare-grid">
        {fig(a, 'A')}
        {fig(b, 'B')}
      </div>
    </Overlay>
  );
}

/** An input token in a prompt ("<image1>", "[[input2]]"), which reads as a picture in plain words. */
const inputToken = /<(?:image|Picture|Video|Audio) ?(\d+)>|\[\[input(\d+)\]\]/gi;
type Named = { id: string; name: string };

/**
 * What separates A from B, as label and value rows: the change asked for or what each asks for, then the changed
 * settings and seed (`technical`, shown fainter), changed prompt phrases, and whether one was made from the other.
 */
function differences(a: ViewerItem, b: ViewerItem, ja: JobRecord, jb: JobRecord, styles: Named[], tasks: JobRecord[]) {
  const styleName = (id: string) => styles.find(s => s.id === id)?.name ?? 'a style';
  // Each input token reads as the picture it stands for: "Tomo’s reference", not "the source".
  const nameOf = (asset: string) => {
    const t = tasks.find(j => j.outputs.includes(asset));
    const title = t ? titleOf(t.request) : '';
    return title
      ? title.replace(/^Reference( sheet)?:\s*(.+)$/i, (_m, sheet, who) => `${who}’s reference${sheet ? ' sheet' : ''}`)
      : 'the attached picture';
  };
  const ca = new Map(settingChips(ja.request, styleName)),
    cb = new Map(settingChips(jb.request, styleName));
  const technical: Array<[string, string]> = [...new Set([...ca.keys(), ...cb.keys()])]
    .filter(k => ca.get(k) !== cb.get(k))
    .map(k => [
      k.startsWith('style') ? 'Style' : k[0]!.toUpperCase() + k.slice(1),
      `${ca.get(k) ?? '—'} → ${cb.get(k) ?? '—'}`,
    ]);
  // Seeds only matter between takes of the same request.
  if (ja.seed !== jb.seed && ja.request.prompt === jb.request.prompt)
    technical.push(['Seed', `${ja.seed} → ${jb.seed}`]);
  const bFromA = jb.request.references?.some(r => r.asset_id === a.asset),
    aFromB = ja.request.references?.some(r => r.asset_id === b.asset);
  // What changed creatively comes first; seeds are technical detail.
  // Variations of one idea get a phrase diff; two different requests (members of a set) are named instead.
  const lead: Array<[string, string]> = [];
  let phrases: string[] = [];
  const childJob = bFromA ? jb : aFromB ? ja : null;
  if (childJob) {
    // An edit of the other one: the change that was asked for leads, ahead of engine and size.
    const refs = childJob.request.references ?? [];
    const named = childJob.request.prompt.replace(inputToken, (_m, x?: string, y?: string) => {
      const r = refs[Number(x ?? y) - 1];
      return r ? nameOf(r.asset_id) : 'the source';
    });
    lead.push(['Change asked', '“' + named + '”']);
  } else if (ja.request.prompt !== jb.request.prompt) {
    // Variations of one idea (most words shared) show only what changed; different requests show what each asks for.
    const wa = new Set(ja.request.prompt.toLowerCase().split(/\W+/).filter(Boolean)),
      wb = new Set(jb.request.prompt.toLowerCase().split(/\W+/).filter(Boolean));
    const shared = [...wa].filter(w => wb.has(w)).length / Math.max(1, new Set([...wa, ...wb]).size);
    // Every changed phrase, one per line, after the settings: nothing is folded into "and 7 more".
    if (shared >= 0.5) phrases = promptChanges(ja.request.prompt, jb.request.prompt);
    else lead.push(['A asks for', '“' + ja.request.prompt + '”'], ['B asks for', '“' + jb.request.prompt + '”']);
  }
  const lineage = bFromA ? 'B was made from A' : aFromB ? 'A was made from B' : '';
  return { lead, technical, phrases, lineage };
}

/** What separates A from B: settings, seed, prompt words, and whether one was made from the other. */
function Differences({ a, b }: { a: ViewerItem; b: ViewerItem }) {
  const ja = useDetail(a).job,
    jb = useDetail(b).job,
    app = useApp(),
    styles = useStyles(app.mode);
  if (!ja || !jb) return <div className="diffbar faint">Reading how each was made…</div>;
  const { lead, technical, phrases, lineage } = differences(a, b, ja, jb, styles, app.tasks);
  const rows = [...lead, ...technical];
  return (
    <div className="diffbar" aria-label="Differences between A and B">
      {lineage && <span className="chip on">{lineage}</span>}
      {!rows.length && !phrases.length && !lineage && (
        <span className="faint">Same prompt and settings{ja.seed === jb.seed ? ' and seed' : ''}.</span>
      )}
      {rows.map(([k, v], n) =>
        v.length > 70 ? (
          <DiffText key={k} label={k} text={v.replace(inputToken, 'the source')} />
        ) : (
          <span key={k} className={'chip' + (n >= lead.length ? ' faint' : '')}>
            <b style={{ fontWeight: 600 }}>{k}</b>&nbsp;{v}
          </span>
        ),
      )}
      {phrases.length > 0 && <PromptPhrases phrases={phrases} a={ja.request.prompt} b={jb.request.prompt} />}
    </div>
  );
}

/** A long difference (a whole prompt): three lines, with the rest one tap away. */
function DiffText({ label, text }: { label: string; text: string }) {
  const [all, setAll] = useState(false);
  return (
    <div className="diff-wrap">
      <p className={'diff-text' + (all ? ' all' : '')}>
        <b style={{ fontWeight: 600 }}>{label}</b> {text}
      </p>
      {text.length > 220 && (
        <button className="link" style={{ fontSize: '0.875rem' }} onClick={() => setAll(x => !x)} aria-expanded={all}>
          {all ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  );
}

/** The prompt's changed phrases, each on its own line, with both whole prompts one click away. */
function PromptPhrases({ phrases, a, b }: { phrases: string[]; a: string; b: string }) {
  const [whole, setWhole] = useState(false);
  const plain = (p: string) => p.replace(inputToken, 'the reference');
  return (
    <div className="diff-phrases">
      <b style={{ fontWeight: 600 }}>Prompt changes</b>
      <ul>
        {phrases.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
      <button className="link" style={{ fontSize: '0.875rem' }} aria-expanded={whole} onClick={() => setWhole(w => !w)}>
        {whole ? 'Hide both prompts' : 'Show both prompts'}
      </button>
      {whole && (
        <div className="diff-both">
          <p>
            <b>A</b> {plain(a)}
          </p>
          <p>
            <b>B</b> {plain(b)}
          </p>
        </div>
      )}
    </div>
  );
}
