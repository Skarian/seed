import type { ImageRequest, PoolSnapshot, WorkerClass } from '../api.js';
import { kindOf, isVideoKind } from '../api.js';
import { loraRoute } from '../../../shared/workflows.js';

export type StyleEntry = { id: string; revision: string; name: string; route: string; source_status?: 'ready' | 'needs_source'; default_scale?: number; description?: string; trigger_words?: string[] };
export type Readiness = { tone: 'ok' | 'warn' | 'bad'; label: string; needs?: WorkerClass; blocked?: boolean; billing?: boolean };

export const classOf = (r: ImageRequest): WorkerClass => isVideoKind(kindOf[r.workflow]) ? 'video' : 'image';

/** Where a draft would run right now, and what it still needs. Mirrors the server's routing rules. */
export function readiness(r: ImageRequest, snapshot: PoolSnapshot | null, styles: StyleEntry[]): Readiness {
  const cls = classOf(r), target = r.target ?? 'auto', loras = r.loras ?? [];
  const missingSource = loras.map(l => styles.find(s => s.id === l.id)).find(s => s?.source_status === 'needs_source');
  const local = snapshot?.local;
  const localOk = !!local?.enabled && !local.paused && local.workflows.includes(r.workflow) && (!loras.length || r.workflow !== 'image-to-image');
  if (target !== 'cloud' && localOk) return { tone: 'ok', label: 'Ready on Seed PC · no rental fee' };
  if (target === 'local') {
    if (local?.enabled && !local.workflows.includes(r.workflow)) return { tone: 'bad', label: `Can't run on Seed PC: ${cls === 'video' ? 'video needs a cloud GPU' : 'this kind needs a cloud GPU'}`, blocked: true };
    return { tone: 'bad', label: 'Seed PC is off · turn it on in GPUs, or run on Cloud', blocked: true };
  }
  if (missingSource) return { tone: 'bad', label: `Style “${missingSource.name}” needs its source before cloud use · Settings › Styles`, blocked: true };
  const workers = (snapshot?.workers ?? []).filter(w => w.worker_class === cls && !w.quit_mode && ['ready', 'generating', 'saving', 'starting', 'preparing'].includes(w.state) && (r.workflow !== 'image-to-image' || !w.workflows || w.workflows.includes(r.workflow)));
  const withStyles = workers.filter(w => ['starting', 'preparing'].includes(w.state) || loras.every(l => w.installed_loras.some(i => i.id === l.id && i.revision === l.revision)));
  const noun = cls === 'video' ? 'video GPU' : 'image GPU';
  if (withStyles.length) return { tone: 'ok', label: `Runs on the running ${noun}${withStyles[0]!.state === 'ready' ? '' : ' (' + withStyles[0]!.state + ')'}`, billing: true };
  if (workers.length) return { tone: 'warn', label: `Needs a new ${noun}: the running one doesn't have this style`, needs: cls };
  return { tone: 'warn', label: `Needs ${cls === 'video' ? 'a video' : 'an image'} GPU`, needs: cls };
}

export function styleName(styles: StyleEntry[], id: string) { return styles.find(s => s.id === id)?.name ?? 'Style'; }
export const routeOf = (r: ImageRequest) => loraRoute(r);
