import React, { useEffect, useRef, useState } from 'react';
import type { WorkflowId, StudioSnapshot } from '../shared/studio.js';
import type { JobRecord } from '../shared/jobs.js';
import { inputLabels, promptBindings, remapReferences } from '../shared/reference-labels.js';
import { loraRoute } from '../server/fal-request.js';
import { useGenerationDrafts } from './hooks/use-generation-drafts.js';
import { useGenerationSubmission } from './hooks/use-generation-submission.js';
import { useBranchedGeneration } from './hooks/use-branched-generation.js';
import { useEstimate } from './hooks/use-estimate.js';
import { GenerateFeedback, useGenerationFeedback } from './generate-feedback.js';
import { CostPreview } from './cost-preview.js';
import { PromptField } from './prompt-field.js';
import { RequestSettings } from './request-settings.js';
import {
  ReferenceInputs,
  useReferences,
  referenceIssues,
  referencePromptIssue,
} from './references.js';
import { MediaPreview, type PreviewMedia } from './media-preview.js';
import { JobDetails, JobMedia, ProviderError } from './job-ui.js';
import { workflowLabels } from './workflow-labels.js';
import type { ComposerHandle } from './inline-composer.js';

type Props = {
  active: boolean;
  workflow: WorkflowId;
  mode: 'sfw' | 'nsfw';
  studio: StudioSnapshot | null;
  jobs: JobRecord[];
  error?: string;
  onWorkflowChange: (workflow: WorkflowId) => void;
  onSubmitted: (jobs: JobRecord[]) => void;
  onRefresh: () => void;
  onLibrary: () => void;
};
const placeholders: Record<WorkflowId, string> = {
  'text-to-image': 'Describe your image…',
  'text-to-video': 'Describe the scene, movement and sound…',
  'reference-to-video': 'Describe the scene using your references…',
};

/** Kept mounted by the shell so navigation preserves drafts, uploads, and completion notices. */
export function Generate({
  active,
  workflow,
  mode,
  studio,
  jobs,
  error,
  onWorkflowChange,
  onSubmitted,
  onRefresh,
  onLibrary,
}: Props) {
  const draft = useGenerationDrafts(workflow, mode),
    request = draft.request;
  const references = useReferences();
  const promptInput = useRef<ComposerHandle>(null);
  const [inputPreview, setInputPreview] = useState<PreviewMedia | null>(null);
  const [outputPreview, setOutputPreview] = useState<JobRecord | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const branchError = useBranchedGeneration(mode, draft.replace, references, onWorkflowChange);
  const submission = useGenerationSubmission(mode + ':' + workflow);
  const feedback = useGenerationFeedback(jobs, workflow, mode);
  const priorInputs = useRef<{
    workflow: WorkflowId;
    labels: Map<string, string>;
    prompt: string;
  } | null>(null);
  const labels = inputLabels(references.items.map((ref) => ({ ...ref, asset_id: ref.id })));
  const bindings = promptBindings(references.items.map((ref) => ({ ...ref, asset_id: ref.id })));
  const mentions = [...labels].map(([id, token]) => {
    const ref = references.items.find(
      (ref) => ref.id === (id.endsWith(':audio') ? id.slice(0, -6) : id),
    )!;
    return {
      id,
      token,
      label: token.slice(1, -1),
      name: ref.name + (id.endsWith(':audio') ? ' · soundtrack' : ''),
      kind: ref.kind,
      url: ref.url,
      onPreview: () => setInputPreview(ref),
    };
  });
  mentions.sort(
    (a, b) =>
      references.items.findIndex(
        (ref) => ref.id === (a.id.endsWith(':audio') ? a.id.slice(0, -6) : a.id),
      ) -
        references.items.findIndex(
          (ref) => ref.id === (b.id.endsWith(':audio') ? b.id.slice(0, -6) : b.id),
        ) || Number(a.id.endsWith(':audio')) - Number(b.id.endsWith(':audio')),
  );
  useEffect(() => {
    const prior = priorInputs.current;
    let prompt = request.prompt;
    if (prior?.workflow === workflow && prior.prompt === prompt) {
      prompt = remapReferences(prompt, prior.labels, bindings);
      if (prompt !== request.prompt) draft.change({ prompt });
    }
    priorInputs.current = { workflow, labels: bindings, prompt };
  }, [workflow, request.prompt, JSON.stringify([...bindings])]);
  useEffect(() => {
    setInputPreview(null);
    setOutputPreview(null);
    setDetail(null);
  }, [mode, active]);

  const video = workflow !== 'text-to-image';
  const seedValid =
    request.seed === 'random' ||
    (/^(0|[1-9][0-9]{0,15})$/.test(request.seed) &&
      BigInt(request.seed) + BigInt(request.count - 1) <= 9007199254740991n);
  const missingReference =
    workflow === 'reference-to-video' ? referencePromptIssue(request.prompt, references.items) : '';
  const notConfigured = !studio?.provider.configured;
  const cost = useEstimate(
    {
      workflow,
      mode,
      aspect: request.output.aspect,
      size: request.output.size,
      count: request.count,
      ...(video ? { duration: request.output.duration_seconds } : {}),
      loras: request.loras ?? [],
      references:
        workflow === 'reference-to-video'
          ? references.items.map((ref) => ({
              kind: ref.kind,
              role: ref.role,
              ...(ref.kind === 'video' ? { duration: ref.end - ref.start } : {}),
            }))
          : [],
    },
    active && !notConfigured,
  );
  const canGenerate = Boolean(
    cost.estimate &&
      !notConfigured &&
      request.prompt.trim() &&
      seedValid &&
      !missingReference &&
      (workflow !== 'reference-to-video' ||
        (references.items.length && referenceIssues(references.items).length === 0)),
  );

  async function generate() {
    if (!canGenerate || !cost.estimate) return;
    const records = await submission.submit({
      request,
      references: references.items,
      estimateId: cost.estimate.id,
      sourceJob: draft.sourceJob,
    });
    if (records) {
      onSubmitted(records);
      feedback.submitted(records, workflow, mode);
    } else cost.refresh();
  }
  if (!active) return null;
  const selected = jobs.find((job) => job.id === detail);
  return (
    <section className="composer" aria-label={workflowLabels[workflow]}>
      <div className="prompt-heading">
        <label htmlFor="prompt">Prompt</label>
        <button
          className="icon-button"
          aria-label="Reset form"
          title="Reset this workflow"
          onClick={() => {
            draft.reset();
            if (workflow === 'reference-to-video') references.reset();
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" />
          </svg>
        </button>
      </div>
      <PromptField
        key={workflow}
        ref={promptInput}
        id="prompt"
        value={request.prompt}
        onChange={(prompt) => draft.change({ prompt })}
        mentions={workflow === 'reference-to-video' ? mentions : undefined}
        placeholder={placeholders[workflow]}
      />
      {draft.storageError && (
        <p role="alert">Draft could not be saved. Keep a copy before closing.</p>
      )}
      {workflow === 'reference-to-video' && (
        <ReferenceInputs
          state={references}
          onInsert={(label) => promptInput.current?.insert(label + ' ')}
        />
      )}
      <RequestSettings
        request={request}
        route={loraRoute({ workflow, references: references.items })}
        onChange={draft.change}
      />
      {!seedValid && (
        <p role="alert">
          Use a whole number from 0 to 9007199254740991, leaving room for all outputs.
        </p>
      )}
      <label className="generation-note">
        Note
        <input
          maxLength={4000}
          placeholder="Optional note for the generated assets"
          value={request.note ?? ''}
          onChange={(event) => draft.change({ note: event.target.value })}
        />
      </label>
      {notConfigured && (
        <p role="status">Add your fal key in Admin → Credentials to enable generation.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {missingReference && <p role="alert">{missingReference}</p>}
      {branchError?.mode === mode && branchError.workflow === workflow && (
        <p role="alert">{branchError.message}</p>
      )}
      {submission.error && <p role="alert">{submission.error}</p>}
      {feedback.jobs
        .filter((job) => job.provider_issue)
        .slice(0, 1)
        .map((job) => (
          <ProviderError key={job.id} issue={job.provider_issue} />
        ))}
      <div className="generation-actions">
        <button
          className="generate-button"
          disabled={submission.busy || !canGenerate}
          title={canGenerate ? undefined : 'Enter a prompt and complete the required inputs.'}
          onClick={() => void generate()}
        >
          {submission.busy ? (
            'Submitting…'
          ) : notConfigured ? (
            'Configure fal to generate'
          ) : (
            <>
              Create{' '}
              {request.count > 1
                ? `${request.count} ${video ? 'videos' : 'images'}`
                : video
                  ? 'video'
                  : 'image'}{' '}
              <span>↗</span>
            </>
          )}
        </button>
        <CostPreview cost={cost} />
      </div>
      {submission.progress && <p role="status">{submission.progress}</p>}
      <GenerateFeedback
        jobs={feedback.jobs}
        onPreview={setOutputPreview}
        onDetails={setDetail}
        onLibrary={onLibrary}
      />
      {inputPreview && (
        <MediaPreview
          media={inputPreview}
          referenceLabel={mentions.find((mention) => mention.url === inputPreview.url)?.label}
          onClose={() => setInputPreview(null)}
        />
      )}
      {outputPreview && <JobMedia job={outputPreview} onClose={() => setOutputPreview(null)} />}
      {selected && (
        <JobDetails
          initial={selected.id}
          jobs={jobs.filter((job) => job.submission_id === selected.submission_id)}
          onClose={() => setDetail(null)}
          onRefresh={onRefresh}
        />
      )}
    </section>
  );
}
