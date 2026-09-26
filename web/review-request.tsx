import { isVideoWorkflow } from '../shared/workflows.js';
import { inputLabels } from '../shared/reference-labels.js';
import { RequestSummary } from './request-details.js';
import React, { useEffect, useState } from 'react';
import type { ChatCard, ChatRevision } from '../shared/chat.js';
import type { ImageRequest } from '../shared/generation.js';
import { RequestDialog } from './request-dialog.js';
import { RequestFields, type RequestAsset } from './request-fields.js';
import { jobName } from './job-ui.js';
import { RevisionControls } from './revision-controls.js';
import type { PreviewRequestInput } from './request-preview.js';
import './review-request.css';
export function Review({
  card,
  initial,
  error,
  assets,
  mode,
  busy,
  editable,
  close,
  save,
  approve,
  approveLabel = 'Approve',
  feedback,
  restore,
  stop,
  onPreview,
}: {
  card: ChatCard;
  initial: ChatRevision;
  error: string;
  assets: RequestAsset[];
  mode: 'sfw' | 'nsfw';
  busy: boolean;
  editable: boolean;
  close: () => void;
  save: (r: unknown) => Promise<boolean>;
  approve: () => Promise<void>;
  approveLabel?: string;
  feedback: () => void;
  restore: (n: number, r: unknown) => Promise<void>;
  stop: () => void;
  onPreview: PreviewRequestInput;
}) {
  const [revision, setRevision] = useState(initial.number),
    [request, setRequest] = useState(initial.request);
  useEffect(() => {
    setRevision(initial.number);
    setRequest(initial.request);
  }, [initial.number, initial.request]);
  const historical = revision !== card.revisions.at(-1)!.number,
    dirty = JSON.stringify(request) !== JSON.stringify(card.revisions.at(-1)!.request),
    video = isVideoWorkflow(card.workflow);
  const raw = () => {
    const v: any = { ...request };
    delete v.workflow;
    if (mode === 'sfw') delete v.mode;
    return v;
  };
  const validSeed =
    request.seed === 'random' ||
    (/^(0|[1-9][0-9]{0,15})$/.test(request.seed) &&
      BigInt(request.seed) + BigInt(request.count - 1) <= 9007199254740991n);
  const missing =
    request.prompt.includes('[removed reference]') ||
    [...request.prompt.matchAll(/<(?:Picture|Video|Audio) [1-9][0-9]*>|<image[1-9][0-9]*>/g)].some(
      (m) => !new Set(inputLabels(request.references ?? []).values()).has(m[0]),
    );
  const invalid = missing
    ? 'Remove or replace the missing input mentions.'
    : !request.prompt.trim()
      ? 'Enter a prompt.'
      : !validSeed
        ? 'Use a valid starting seed for the requested quantity.'
        : request.count < 1 || request.count > 16
          ? 'Choose a quantity from 1 to 16.'
          : video &&
              (!Number.isInteger(request.output.duration_seconds) ||
                request.output.duration_seconds! < 5 ||
                request.output.duration_seconds! > 15)
            ? 'Choose a supported length between 5 and 15 seconds.'
            : '';
  return (
    <RequestDialog
      title={jobName(card.workflow)}
      label="Review generation"
      close={close}
      closeLabel="Close review"
      error={invalid || error}
      header={
        <>
          {' '}
          {card.revisions.length > 1 && (
            <RevisionControls
              current={revision}
              total={card.revisions.length}
              label="request revision"
              onChange={(n) => {
                setRevision(n);
                setRequest(card.revisions.find((r) => r.number === n)!.request);
              }}
            />
          )}
          {busy && (
            <button type="button" onClick={stop}>
              Stop
            </button>
          )}{' '}
        </>
      }
      footer={
        <>
          <div className="review-actions">
            {historical ? (
              <button
                disabled={busy}
                onClick={() => void (editable ? save(raw()) : restore(revision, raw()))}
              >
                Restore revision
              </button>
            ) : editable ? (
              <>
                {!dirty && (
                  <button
                    className="review-feedback"
                    disabled={busy}
                    title={
                      dirty
                        ? 'Save changes before providing feedback'
                        : 'Return to the composer with this request'
                    }
                    onClick={feedback}
                  >
                    ↩ Provide feedback
                  </button>
                )}
                {dirty && (
                  <button disabled={busy || !!invalid} onClick={() => void save(raw())}>
                    Save changes
                  </button>
                )}
                <button
                  className="primary-action"
                  disabled={busy || dirty || !!invalid}
                  onClick={() => void approve()}
                >
                  {approveLabel}
                </button>
              </>
            ) : (
              <button disabled={busy || !!invalid} onClick={() => void restore(revision, raw())}>
                Restore request
              </button>
            )}
          </div>
        </>
      }
    >
      {' '}
      {historical ? (
        <RequestSummary request={request} inputs={assets} onPreview={onPreview} />
      ) : (
        <RequestFields
          request={request}
          assets={assets}
          disabled={busy || historical}
          onChange={setRequest}
          onPreview={onPreview}
        />
      )}{' '}
      {historical && <p className="review-history-note">Earlier revision · read-only</p>}
    </RequestDialog>
  );
}
