/**
 * What the user sees while one output runs. Engines report many technical steps;
 * Seed shows four: Starting, Loading models, Generating with a percent, and
 * Finishing (decoding and saving). Only the phase and a number cross from the
 * engine. Prompt text and media never do.
 */
export type GenerationPhase = 'starting' | 'loading' | 'generating' | 'finishing';
export type EnginePhase = { phase: Exclude<GenerationPhase, 'starting'>; percent?: number };
export type GenerationProgress = { phase: GenerationPhase; percent?: number; since: string; preparing_loras?: true };

const engineNames: Record<string, EnginePhase['phase']> = {
  loading: 'loading',
  generating: 'generating',
  finishing: 'finishing',
  // Engine releases before protocol 3 used these names.
  editing: 'generating',
  saving: 'finishing',
};

/** Accepts an untrusted engine report and keeps only a known phase and a bounded integer percent. */
export function enginePhase(raw: unknown): EnginePhase | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as { phase?: unknown; percent?: unknown };
  const phase = typeof value.phase === 'string' ? engineNames[value.phase] : undefined;
  if (!phase) return undefined;
  const percent = phase === 'generating' && typeof value.percent === 'number' && Number.isFinite(value.percent)
    ? Math.max(0, Math.min(100, Math.floor(value.percent)))
    : undefined;
  return percent === undefined ? { phase } : { phase, percent };
}

/** Keeps the phase start time while the phase is unchanged, so elapsed time counts the whole phase. */
export function nextProgress(
  previous: GenerationProgress | undefined,
  phase: GenerationPhase,
  percent: number | undefined,
  now: Date,
): GenerationProgress {
  const since = previous?.phase === phase ? previous.since : now.toISOString();
  return percent === undefined ? { phase, since } : { phase, percent, since };
}

export function elapsedSeconds(progress: GenerationProgress, now: number) {
  const started = Date.parse(progress.since);
  return Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
}

export function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** Phase name plus its detail: a percent while generating, otherwise elapsed time once it passes a second. */
export function progressParts(progress: GenerationProgress, workflow: string, now = Date.now()) {
  if (progress.phase === 'generating')
    return { name: workflow === 'image-to-image' ? 'Editing' : 'Generating', detail: progress.percent === undefined ? '' : `${progress.percent}%` };
  const name = progress.preparing_loras ? 'Preparing LoRAs' : { starting: 'Starting', loading: 'Loading models', finishing: 'Finishing' }[progress.phase];
  const seconds = elapsedSeconds(progress, now);
  return { name, detail: seconds > 0 ? formatElapsed(seconds) : '' };
}

/** Short text for rows, for example "Generating · 42%" or "Loading models · 18 s". */
export function progressLabel(progress: GenerationProgress, workflow: string, now = Date.now()) {
  const { name, detail } = progressParts(progress, workflow, now);
  return detail ? `${name} · ${detail}` : name + '…';
}

/** Worker cards show the same words without a timer. */
export function workerPhaseLabel(phase: EnginePhase | undefined) {
  if (!phase) return undefined;
  if (phase.phase === 'generating') return phase.percent === undefined ? 'Generating' : `Generating · ${phase.percent}%`;
  return phase.phase === 'loading' ? 'Loading models' : 'Finishing';
}
