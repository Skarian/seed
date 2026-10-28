import { isVideoWorkflow } from '../shared/workflows.js';
import React from 'react';
import type { ImageRequest } from '../shared/generation.js';
import { loraRoute } from '../shared/workflows.js';
import { LoraPicker } from './lora-picker.js';
import { AspectPicker, BatchPicker, LengthPicker, SeedControl } from './request-controls.js';
import './request-settings.css';
import { resolutionOptions, isResolutionSize, type Dimensions, type ResolutionSize } from '../shared/resolution.js';
import { useGeneratePreferences } from './generate-preferences.js';
import { VIDEO_STEPS, videoSteps, type VideoSteps } from '../shared/video-settings.js';

type Props = {
  request: ImageRequest;
  onChange: (patch: Partial<ImageRequest>) => void;
  route?: 'image' | 'fl' | 'ref';
  source?: Dimensions;
  sourceError?: string;
  resolutionReady?: boolean;
  onResolutionChange?: (size: ResolutionSize) => void;
  resolutionNote?: React.ReactNode;
};
/** The same generation settings, order, and field layout in Generate and Chat review. */
export function RequestSettings({ request, onChange, route, source, sourceError, resolutionReady = true, onResolutionChange, resolutionNote }: Props) {
  const video = isVideoWorkflow(request.workflow);
  const { candidates } = useGeneratePreferences();
  let options: ReturnType<typeof resolutionOptions> = [], resolutionError = sourceError;
  try { if (!resolutionError) options = resolutionOptions(request.workflow, request.output.aspect, request.output.size, source, candidates); }
  catch (error) { resolutionError = (error as Error).message; }
  const supported = isResolutionSize(request.workflow, request.output.size, candidates);
  const output = (patch: Partial<ImageRequest['output']>) => {
    onChange({ output: { ...request.output, ...patch,aspect:request.workflow==='image-to-image'?'source':patch.aspect==='source'?request.output.aspect:patch.aspect??request.output.aspect } } as Partial<ImageRequest>);
  };
  return (
    <div className="request-settings">
      <label className="request-setting">Run on
        <select aria-label="Run on" value={request.target??'auto'} onChange={event=>onChange({target:event.target.value as 'auto'|'local'|'cloud'})}>
          <option value="auto">Auto</option><option value="local">This PC</option><option value="cloud">Cloud</option>
        </select>
      </label>
      {request.workflow==='image-to-image'?<p className="request-settings-hint">Output follows your source image’s shape.</p>:<div className="request-setting">
        <span>Orientation</span>
        <AspectPicker value={request.output.aspect} orientationOnly onChange={(aspect) => output({ aspect })} />
      </div>}
      <div className="request-setting resolution-setting"><label>
        Resolution
        <select aria-label="Resolution" value={resolutionError || !resolutionReady ? '' : request.output.size}
          disabled={!!resolutionError || (resolutionReady && supported && options.length < 2)}
          onChange={event => { const size = event.target.value as ResolutionSize; if (size !== request.output.size || !resolutionReady) { if (onResolutionChange) onResolutionChange(size); else output({ size }); } }}>
          {(resolutionError || !resolutionReady) && <option value="" disabled>{resolutionError ?? 'Choose a resolution'}</option>}
          {!resolutionError && resolutionReady && !supported && <option value={request.output.size} disabled>Unsupported saved resolution</option>}
          {options.map(option => <option key={option.label} value={option.size}>{option.label}</option>)}
        </select>
      </label>{resolutionNote}</div>
      <label className="request-setting">
        Quantity
        <BatchPicker value={request.count} onChange={(count) => onChange({ count })} />
      </label>
      {video && (
        <label className="request-setting">
          Length
          <LengthPicker
            value={request.output.duration_seconds ?? 5}
            onChange={(duration_seconds) => output({ duration_seconds })}
          />
        </label>
      )}
      {video && <label className="request-setting">Sampling steps
        <select aria-label="Sampling steps" value={videoSteps(request)} onChange={event=>onChange({steps:Number(event.target.value) as VideoSteps})}>
          {VIDEO_STEPS.map(steps=><option key={steps} value={steps}>{steps}{steps===10?' — Fastest':steps===20?' — Balanced':steps===30?' — Most refinement':''}</option>)}
        </select>
        <small className="request-settings-hint">More steps take longer. Fewer steps can reduce detail, motion consistency, or audio clarity.</small>
      </label>}
      {request.workflow!=='image-to-image'&&<LoraPicker
        route={route??loraRoute(request)}
        mode={request.mode}
        value={request.loras}
        onChange={(loras) => onChange({ loras })}
      />}
      <SeedControl
        random={request.seed === 'random'}
        value={request.seed}
        onChange={(random, value) => onChange({ seed: random ? 'random' : value })}
      />
      {video && (
        <label className="request-setting">
          Soundtrack
          <select
            value={request.audio?.output ?? 'generated'}
            onChange={(event) =>
              onChange({ audio: { output: event.target.value as 'generated' | 'silent' } })
            }
          >
            <option value="generated">Generated</option>
            <option value="silent">Silent</option>
          </select>
        </label>
      )}
    </div>
  );
}
