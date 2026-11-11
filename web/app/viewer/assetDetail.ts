/** What is known about one result: loading its record and family, and pure readings of them for the viewer. */
import { useEffect, useState } from 'react';
import { shotFromTitle, shotNameKey, shotsFromBrief } from '../../../shared/shots.js';
import { chosenAs, chosenTake, type ProjectChoices } from '../../../shared/choices.js';
import { jobPhase } from '../../../shared/jobs.js';
import { assets as assetsApi, jobs as jobsApi, type AssetDetail, type JobRecord } from '../api.js';
import { useApp, type ViewerItem } from '../data.js';
import { titleOf, duration } from '../format.js';

/** Everything known about one result: its job, organization and family. */
export function useDetail(item: ViewerItem) {
  const [detail, setDetail] = useState<AssetDetail | null>(null),
    [job, setJob] = useState<JobRecord | undefined>(item.job);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void assetsApi
      .get(item.asset)
      .then(d => {
        if (!live) return;
        setDetail(d);
        if (!item.job && d.job_id)
          void jobsApi
            .get(d.job_id)
            .then(j => live && setJob(j))
            .catch(() => {});
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [item.asset, tick]);
  useEffect(() => setJob(item.job), [item.job?.id]);
  return { detail, job, refresh: () => setTick(t => t + 1) };
}

/** The inputs a result was made from, and the results made from it. */
export function useFamily(item: ViewerItem, job?: JobRecord) {
  const { tasks } = useApp();
  const parents = (job?.request.references ?? []).map(r => {
    const made = tasks.find(j => j.outputs.includes(r.asset_id));
    return {
      asset: r.asset_id,
      kind: r.kind,
      role: r.role,
      title: made ? titleOf(made.request) : 'Uploaded ' + r.kind,
      job: made,
    };
  });
  const children = tasks
    .filter(j => jobPhase(j) === 'completed' && j.request.references?.some(r => r.asset_id === item.asset))
    .flatMap(j => j.outputs.map(o => ({ asset: o, job: j })));
  return { parents, children };
}

/** " · take 2" for one take of a batch, nothing for a single result. */
export const takeOf = (job: JobRecord) => (job.request.count > 1 ? ` · take ${(job.submission_index ?? 0) + 1}` : '');

/** The file name a download is saved under. */
export const downloadName = (item: ViewerItem, job?: JobRecord) =>
  job ? titleOf(job.request) + (job.request.count > 1 ? ' ' + (job.submission_index + 1) : '') : item.title;

/** A crop or a picked frame remembers the asset it came from; link back to it (and its project) instead of "Uploaded". */
export function derivedFromOf(detail: AssetDetail | null, tasks: JobRecord[]) {
  const from = !detail?.job_id && typeof detail?.source_asset_id === 'string' ? detail.source_asset_id : '';
  if (!from) return null;
  const made = tasks.find(j => j.outputs.includes(from));
  const crop = detail?.crop as { shape?: string } | undefined;
  const at = detail?.source_time_seconds;
  return {
    asset: from,
    kind: (crop ? 'image' : 'video') as 'image' | 'video',
    job: made,
    title: made ? titleOf(made.request) + takeOf(made) : 'The original',
    how: crop
      ? `cropped to ${crop.shape ?? 'a new shape'}`
      : typeof at === 'number'
        ? `frame at ${at.toFixed(1)}s`
        : 'source',
  };
}

/**
 * Where a result stands in its project: the shot it is a take of (and whether it is the chosen one), and what it is
 * used as ("Chosen keyframe for Shot 2: Dawn", "Maren’s reference").
 */
export function placeInProject(
  p: { brief?: string | null; choices?: ProjectChoices },
  item: ViewerItem,
  job?: JobRecord,
): { shot: { n: number; name: string; chosen: boolean } | null; usedAs: string[] } {
  const list = shotsFromBrief(p.brief);
  const own = shotFromTitle(job?.request.title ?? '');
  let shot = null;
  if (own.n !== null) {
    const listed = list.find(x => shotNameKey(x.name) === shotNameKey(own.name));
    const n = listed?.n ?? own.n,
      name = listed?.name ?? own.name;
    shot = { n, name, chosen: chosenTake(p.choices, n, name, item.kind === 'video' ? 'clip' : 'image') === item.asset };
  }
  const usedAs = chosenAs(p.choices, item.asset).map(c => {
    if ('reference' in c) return `${c.reference}’s reference`;
    const listed = list.find(s => shotNameKey(s.name) === c.shot);
    const where = listed
      ? `Shot ${listed.n}: ${listed.name}`
      : c.shot.startsWith('#')
        ? 'Shot ' + c.shot.slice(1)
        : c.shot;
    return `Chosen ${c.kind === 'clip' ? 'clip' : 'keyframe'} for ${where}`;
  });
  return { shot, usedAs };
}

/** How long a result took. Waiting in the queue and working on the GPU are different times: say both when they differ. */
export function readyIn(job: JobRecord) {
  const m = job.metrics,
    total = m?.elapsed_to_saved_seconds;
  if (!total) return '';
  const work = m?.submitted_at && m.saved_at ? (Date.parse(m.saved_at) - Date.parse(m.submitted_at)) / 1000 : 0;
  return work > 0 && total - work >= 2
    ? ` · ready in ${duration(total)} (${duration(work)} on the GPU)`
    : ` · ready in ${duration(total)}`;
}
