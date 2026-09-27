import { isVideoWorkflow } from '../shared/workflows.js';
import React from 'react';
import type { ImageRequest } from '../shared/generation.js';
import { loraRoute } from '../shared/workflows.js';
import { LoraPicker } from './lora-picker.js';
import { AspectPicker, BatchPicker, LengthPicker, SeedControl } from './request-controls.js';
import './request-settings.css';

type Props = {
  request: ImageRequest;
  onChange: (patch: Partial<ImageRequest>) => void;
  route?: 'image' | 'fl' | 'ref';
};
/** The same generation settings, order, and field layout in Generate and Chat review. */
export function RequestSettings({ request, onChange, route }: Props) {
  const video = isVideoWorkflow(request.workflow);
  const output = (patch: Partial<ImageRequest['output']>) => {
    if(request.workflow==='image-to-image')return;
    onChange({ output: { ...request.output, ...patch,aspect:patch.aspect==='source'?request.output.aspect:patch.aspect??request.output.aspect } });
  };
  return (
    <div className="request-settings">
      {request.workflow==='image-to-image'?<p className="request-settings-hint">Output follows your source image’s shape, up to about 1 MP.</p>:<div className="request-setting">
        <span>Aspect ratio</span>
        <AspectPicker value={request.output.aspect} onChange={(aspect) => output({ aspect })} />
      </div>}
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
