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

/** Standard samples sparse attention; Full samples every token. Works with any steps. */
export const VIDEO_DETAILS = ['standard', 'full'] as const;
export type VideoDetail = typeof VIDEO_DETAILS[number];
export const DEFAULT_VIDEO_DETAIL: VideoDetail = 'standard';
export const VIDEO_DETAIL_LABELS: Record<VideoDetail, string> = { standard: 'Standard', full: 'Full' };
export const isVideoDetail = (value: unknown): value is VideoDetail => VIDEO_DETAILS.some(detail => detail === value);
export const videoDetail = (request: { detail?: VideoDetail }): VideoDetail => request.detail ?? DEFAULT_VIDEO_DETAIL;

export const videoProfile = (request: { steps?: number; detail?: VideoDetail }) => `h3-${videoDetail(request)}-${videoSteps(request)}`;
