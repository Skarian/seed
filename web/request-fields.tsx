import { usesInputs } from '../shared/workflows.js';
import { PromptField } from './prompt-field.js';
import { RequestSettings } from './request-settings.js';
import type { ComposerHandle } from './inline-composer.js';
import { inputLabels, promptBindings, remapReferences } from '../shared/reference-labels.js';
import React, { useRef } from 'react';
import type { ImageRequest } from '../shared/generation.js';
import {patchGeneration} from '../shared/generation.js';
import type { PreviewRequestInput } from './request-preview.js';
import { RequestInputs } from './request-inputs.js';
export type RequestAsset = {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'audio';
  note: string;
  metadata?: { duration?: number; width?: number; height?: number };
};
export function RequestFields({
  request,
  assets,
  disabled = false,
  onChange,
  onPreview,
}: {
  request: ImageRequest;
  assets: RequestAsset[];
  disabled?: boolean;
  onChange: (request: ImageRequest) => void;
  onPreview: PreviewRequestInput;
}) {
  const promptEditor = useRef<ComposerHandle>(null);
  const labels = inputLabels(request.references ?? []);
  const mentions = [...labels].map(([id, token]) => {
    const ref = request.references!.find(
        (r) => r.id === (id.endsWith(':audio') ? id.slice(0, -6) : id),
      )!,
      asset = assets.find((a) => a.id === ref.asset_id);
    return {
      id,
      token,
      label: token.slice(1, -1),
      name: (asset?.name ?? 'Input') + (id.endsWith(':audio') ? ' · soundtrack' : ''),
      kind: ref.kind,
      url: '/api/v1/assets/' + ref.asset_id + '/content',
      onPreview: () =>
        onPreview(ref.asset_id, {
          inputId: ref.id,
          references: request.references!,
          label: token.slice(1, -1),
        }),
    };
  });
  mentions.sort(
    (a, b) =>
      (request.references ?? []).findIndex(
        (r) => r.id === (a.id.endsWith(':audio') ? a.id.slice(0, -6) : a.id),
      ) -
        (request.references ?? []).findIndex(
          (r) => r.id === (b.id.endsWith(':audio') ? b.id.slice(0, -6) : b.id),
        ) || Number(a.id.endsWith(':audio')) - Number(b.id.endsWith(':audio')),
  );
  const change = (values: Partial<ImageRequest>) =>
    onChange(patchGeneration(request,{
      ...values,
      ...(values.count !== undefined || values.seed !== undefined
        ? { resolved_seeds: undefined }
        : {}),
    }));
  return (
    <fieldset disabled={disabled}>
      <div>
        <div className="request-prompt-heading">
          <label htmlFor="review-prompt">Prompt</label>
        </div>
        <PromptField
          ref={promptEditor}
          id="review-prompt"
          value={request.prompt}
          mentions={usesInputs(request.workflow) ? mentions : undefined}
          disabled={disabled}
          onChange={(prompt) => change({ prompt })}
        />
      </div>
      {usesInputs(request.workflow) && (
        <RequestInputs
          editingImage={request.workflow==='image-to-image'}
          references={request.references ?? []}
          assets={assets}
          labels={labels}
          onInsert={(token) => promptEditor.current?.insert(token + ' ')}
          onChange={(references) =>
            change({
              references,
              prompt: remapReferences(
                request.prompt,
                promptBindings(request.references ?? []),
                promptBindings(references),
              ),
            })
          }
          onPreview={onPreview}
        />
      )}
      <RequestSettings request={request} onChange={change} />
      <details className="review-disclosure" open={request.note?.trim() ? true : undefined}>
        <summary>Note</summary>
        <label>
          <span className="sr-only">Note</span>
          <input
            maxLength={4000}
            placeholder="Optional note for the generated assets"
            value={request.note ?? ''}
            onChange={(e) => change({ note: e.target.value })}
          />
        </label>
      </details>
    </fieldset>
  );
}
