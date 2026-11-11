import type { ImageRequest, PoolSnapshot, WorkerClass } from '../api.js';
import { kindOf, isVideoKind } from '../api.js';
import { loraRoute } from '../../../shared/workflows.js';
import { canRun, gpuNeed } from '../../../shared/pool.js';

export type StyleEntry = {
  id: string;
  revision: string;
  name: string;
  route: string;
  source_status?: 'ready' | 'needs_source';
  default_scale?: number;
  description?: string;
  trigger_words?: string[];
};
export type Readiness = {
  tone: 'ok' | 'warn' | 'bad';
  label: string;
  /** Where the draft would run: Seed PC, a cloud GPU, or whichever of the two is free first. */
  where: 'local' | 'cloud' | 'either';
  needs?: WorkerClass;
  blocked?: boolean;
  billing?: boolean;
};

export const classOf = (r: ImageRequest): WorkerClass => (isVideoKind(kindOf[r.workflow]) ? 'video' : 'image');

/** Where a draft would run right now, and what it still needs. Uses the server's own matching rule. */
export function readiness(r: ImageRequest, snapshot: PoolSnapshot | null, styles: StyleEntry[]): Readiness {
  const cls = classOf(r),
    target = r.target ?? 'auto',
    loras = r.loras ?? [];
  const missingSource = loras.map(l => styles.find(s => s.id === l.id)).find(s => s?.source_status === 'needs_source');
  const local = snapshot?.local;
  const localOk =
    !!local?.enabled &&
    !local.paused &&
    local.workflows.includes(r.workflow) &&
    (!loras.length || r.workflow !== 'image-to-image');
  const running = (w: { state: string }) => ['ready', 'generating', 'saving'].includes(w.state);
  // Cloud GPUs that could take this draft once free, leaving styles aside; then those that have its styles too.
  const fit = (snapshot?.workers ?? []).filter(
    w => (running(w) || ['starting', 'preparing'].includes(w.state)) && canRun(w, gpuNeed(r), 'wait'),
  );
  const withStyles = fit.filter(w => canRun(w, gpuNeed(r, loras), 'wait'));
  if (target !== 'cloud' && localOk) {
    const cloud = target === 'auto' ? withStyles.find(running) : undefined;
    return cloud
      ? {
          tone: 'ok',
          where: 'either',
          label: `Seed PC or the running ${cls} GPU (${'$' + cloud.hourly.toFixed(2)}/h), whichever is free first`,
          billing: true,
        }
      : { tone: 'ok', where: 'local', label: 'Ready on Seed PC · no rental fee' };
  }
  if (target === 'local') {
    if (local?.enabled && !local.workflows.includes(r.workflow))
      return {
        tone: 'bad',
        where: 'local',
        label: `Can't run on Seed PC: ${cls === 'video' ? 'video needs a cloud GPU' : 'this kind needs a cloud GPU'}`,
        blocked: true,
      };
    return {
      tone: 'bad',
      where: 'local',
      label: 'Seed PC is off · turn it on in GPUs, or run on Cloud',
      blocked: true,
    };
  }
  if (missingSource)
    return {
      tone: 'bad',
      where: 'cloud',
      label: `Style “${missingSource.name}” needs its source before cloud use · Settings › Styles`,
      blocked: true,
    };
  const noun = cls === 'video' ? 'video GPU' : 'image GPU';
  if (withStyles.length)
    return {
      tone: 'ok',
      where: 'cloud',
      label: `${noun[0]!.toUpperCase() + noun.slice(1)} ${running(withStyles[0]!) ? 'ready' : 'starting'}`,
      billing: true,
    };
  if (fit.length)
    return {
      tone: 'warn',
      where: 'cloud',
      label: `Needs a new ${noun}: the running one doesn't have this style`,
      needs: cls,
    };
  return { tone: 'warn', where: 'cloud', label: `Needs ${cls === 'video' ? 'a video' : 'an image'} GPU`, needs: cls };
}

export function styleName(styles: StyleEntry[], id: string) {
  return styles.find(s => s.id === id)?.name ?? 'Style';
}
/** The style route for a request; edits take no styles, so they have none. */
export const routeOf = (r: ImageRequest) => (r.workflow === 'image-to-image' ? null : loraRoute(r));
