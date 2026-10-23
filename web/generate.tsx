import { isVideoWorkflow } from '../shared/workflows.js';
import React, { useEffect, useRef, useState } from 'react';
import type { WorkflowId, StudioSnapshot } from '../shared/studio.js';
import type { JobRecord } from '../shared/jobs.js';
import { inputLabels, promptBindings, remapReferences } from '../shared/reference-labels.js';
import { loraRoute, usesInputs } from '../shared/workflows.js';
import {RequestDialog} from './request-dialog.js';
import {emptyGeneration} from './generation-draft.js';
import { useGenerationDrafts } from './hooks/use-generation-drafts.js';
import { useGenerationSubmission } from './hooks/use-generation-submission.js';
import { useBranchedGeneration } from './hooks/use-branched-generation.js';
import { GenerateFeedback, useGenerationFeedback } from './generate-feedback.js';
import { useWorkerPool } from './hooks/use-worker-pool.js';
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
import { useGeneratePreferences } from './generate-preferences.js';
import { isResolutionSize, resolutionFamily, resolveDimensions, type ResolutionSize } from '../shared/resolution.js';

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
  'image-to-image': 'Describe what to change and what to keep…',
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
  const preferences = useGeneratePreferences();
  const activation = useRef<{key: string; waiting: boolean; touched: boolean} | null>(null);
  const [resolutionReady, setResolutionReady] = useState(false);
  const family = resolutionFamily(workflow);
  function chooseResolution(size: ResolutionSize) {
    if (activation.current) activation.current.waiting = false;
    setResolutionReady(true);
    changeDraft({ output: {...request.output, size} } as Partial<typeof request>);
    preferences.remember(family, size);
  }
  const videoReferences = useReferences(false,'reference-to-video');
  const editReferences = useReferences(false,'image-to-image');
  const references = workflow==='image-to-image'?editReferences:videoReferences;
  const [pendingEdit,setPendingEdit]=useState<{id:string;name:string}|null>(null);
  const [editError,setEditError]=useState('');
  const promptInput = useRef<ComposerHandle>(null);
  const [inputPreview, setInputPreview] = useState<PreviewMedia | null>(null);
  const [outputPreview, setOutputPreview] = useState<JobRecord | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const branchError = useBranchedGeneration(mode, draft.replace, videoReferences, onWorkflowChange,editReferences);
  async function startEdit(asset:{id:string;name:string}) {
    setPendingEdit(null);setEditError('');
    submission.edited(mode + ':image-to-image');
    const fresh = emptyGeneration('image-to-image');
    if (preferences.preferences) fresh.request.output.size = preferences.preferences.image;
    draft.replace('image-to-image',fresh);
    editReferences.reset();
    await editReferences.add([{...asset,kind:'image',created_at:''}],{askForNotes:false});
  }
  useEffect(()=>{const open=(event:Event)=>{const asset=(event as CustomEvent).detail;if(!asset?.id)return;if(editReferences.items.length||draft.editHasPrompt)setPendingEdit(asset);else void startEdit(asset).catch(e=>setEditError(e.message));};window.addEventListener('seed:edit-image',open);return()=>window.removeEventListener('seed:edit-image',open);});
  const submission = useGenerationSubmission(mode + ':' + workflow);
  function changeDraft(patch: Partial<typeof request>) {
    submission.edited(mode + ':' + workflow);
    draft.change(patch);
  }
  useEffect(() => {
    if (!active) { activation.current = null; return; }
    const key = mode + ':' + workflow;
    if (activation.current?.key !== key) {
      activation.current = { key, waiting: true, touched: false };
      setResolutionReady(false);
      void preferences.refresh();
      const pendingDraft = submission.pendingDraft(key);
      if (pendingDraft) {
        draft.replace(workflow, pendingDraft);
        activation.current.waiting = false;
        setResolutionReady(true);
        return;
      }
    }
    const entry = activation.current;
    if (draft.sourceJob || submission.hasPending(key) || !isResolutionSize(workflow, request.output.size, preferences.candidates)) { entry.waiting = false; setResolutionReady(true); return; }
    if (entry.waiting && !entry.touched && preferences.preferences) {
      draft.change({ output: {...request.output, size: preferences.preferences[family]} } as Partial<typeof request>);
      entry.waiting = false;
      setResolutionReady(true);
    }
  }, [active, workflow, mode, draft.sourceJob, preferences.preferences]);
  const pool = useWorkerPool();
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
  }, [mode, active, workflow]);

  const video = isVideoWorkflow(workflow);
  const sourceInput = workflow === 'image-to-image' ? references.items.find(ref => ref.role === 'source') : undefined;
  const source = sourceInput?.width && sourceInput.height ? {width: sourceInput.width, height: sourceInput.height} : undefined;
  let resolutionError = '';
  if (!isResolutionSize(workflow, request.output.size, preferences.candidates)) resolutionError = 'Choose a supported resolution.';
  else try { resolveDimensions(workflow, request.output.size, request.output.aspect, source); } catch (failure) { resolutionError = (failure as Error).message; }
  const seedValid =
    request.seed === 'random' ||
    (/^(0|[1-9][0-9]{0,15})$/.test(request.seed) &&
      BigInt(request.seed) + BigInt(request.count - 1) <= 9007199254740991n);
  const missingReference =
    usesInputs(workflow) ? referencePromptIssue(request.prompt, references.items) : '';
  const canGenerate = Boolean(
    resolutionReady && !resolutionError && request.prompt.trim() &&
      seedValid &&
      !missingReference &&
      (!usesInputs(workflow) ||
        (references.items.length && !references.busy && referenceIssues(references.items).length === 0)),
  );

  async function generate() {
    if (!canGenerate) return;
    const records = await submission.submit({
      request,
      references: references.items,
      sourceJob: draft.sourceJob,
    });
    if (records?.length) {
      onSubmitted(records);
      feedback.submitted(records, workflow, mode);
      if (!pool.hasCapacity(video ? 'video' : 'image',request.loras,workflow)) pool.open(video ? 'video' : 'image');
    }
  }
  if (!active) return null;
  const selected = jobs.find((job) => job.id === detail);
  return (
    <section className="composer" aria-label={workflowLabels[workflow]} onInputCapture={() => { if (activation.current) activation.current.touched = true; }}>
      <div className="prompt-heading">
        <label htmlFor="prompt">Prompt</label>
        <button
          className="icon-button"
          aria-label="Reset form"
          title="Reset this workflow"
          onClick={() => {
            submission.edited(mode + ':' + workflow);
            const fresh = emptyGeneration(workflow);
            if (preferences.preferences) fresh.request.output.size = preferences.preferences[family];
            draft.replace(workflow, fresh);
            activation.current = {key: mode + ':' + workflow, waiting: !preferences.preferences, touched: false};
            setResolutionReady(!!preferences.preferences);
            if (usesInputs(workflow)) references.reset();
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
        onChange={(prompt) => changeDraft({ prompt })}
        mentions={usesInputs(workflow) ? mentions : undefined}
        placeholder={placeholders[workflow]}
      />
      {draft.storageError && (
        <p role="alert">Draft could not be saved. Keep a copy before closing.</p>
      )}
      {usesInputs(workflow) && (
        <ReferenceInputs
          state={{...references,
            add: (...args) => { submission.edited(mode + ':' + workflow); return references.add(...args); },
            update: (...args) => { submission.edited(mode + ':' + workflow); references.update(...args); },
            remove: (...args) => { submission.edited(mode + ':' + workflow); references.remove(...args); },
          }}
          onInsert={(label) => promptInput.current?.insert(label + ' ')}
        />
      )}
      <RequestSettings
        request={request}
        route={workflow==='image-to-image'?undefined:loraRoute({ workflow, references: references.items })}
        onChange={changeDraft}
        source={source}
        sourceError={workflow === 'image-to-image' && references.busy ? 'Reading source image…' : undefined}
        resolutionReady={resolutionReady}
        onResolutionChange={chooseResolution}
        resolutionNote={<p className="resolution-memory" role="status">
        Choosing a resolution remembers it for {family} workflows.
        {preferences.status[family] === 'saving' && ' Saving…'}
        {preferences.status[family] === 'saved' && ' Saved.'}
        {preferences.status[family] === 'error' && <> Selection not remembered. <button type="button" onClick={() => preferences.remember(family, request.output.size)}>Retry</button></>}
        {preferences.error && <> {preferences.error} <button type="button" onClick={() => void preferences.refresh()}>Retry loading</button></>}
      </p>}
      />
      {resolutionError && resolutionReady && <p role="alert">{resolutionError}</p>}
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
          onChange={(event) => changeDraft({ note: event.target.value })}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {missingReference && <p role="alert">{missingReference}</p>}
      {branchError?.mode === mode && branchError.workflow === workflow && (
        <p role="alert">{branchError.message}</p>
      )}
      {submission.error && <p role="alert">{submission.error}</p>}
      {editError&&<p role="alert">{editError}</p>}
      {pendingEdit&&<RequestDialog title="Replace your editing draft?" label="Replace editing draft" close={()=>setPendingEdit(null)}><p>Your current editing instruction and images will be replaced with {pendingEdit.name}.</p><div className="request-actions"><button onClick={()=>setPendingEdit(null)}>Keep draft</button><button className="primary-action" onClick={()=>void startEdit(pendingEdit)}>Replace draft</button></div></RequestDialog>}
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
      {outputPreview && <JobMedia job={outputPreview} jobs={jobs} onClose={() => setOutputPreview(null)} />}
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
