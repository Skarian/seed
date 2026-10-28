/** Ordinary H3 sampling. Distilled adapters require a separate recipe. */
export const VIDEO_STEPS = [10, 15, 20, 30] as const;
export type VideoSteps = typeof VIDEO_STEPS[number];
export const DEFAULT_VIDEO_STEPS: VideoSteps = 20;
export const isVideoSteps = (value: unknown): value is VideoSteps => VIDEO_STEPS.some(steps => steps === value);

/** Requests saved before step selection used 30 steps. */
export function videoSteps(request: { steps?: number }): VideoSteps {
  if (request.steps === undefined) return 30;
  if (!isVideoSteps(request.steps)) throw Error('Choose 10, 15, 20, or 30 video steps.');
  return request.steps;
}
export function videoProfile(request: { steps?: number }, local = false): string {
  const steps = videoSteps(request);
  if (local) return `h3-official-${steps}-v1`;
  return steps === 30 ? 'h3-high-v1' : `h3-base-${steps}-v1`;
}
