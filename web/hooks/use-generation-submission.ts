import { usesInputs } from '../../shared/workflows.js';
import { useRef, useState } from 'react';
import type { ImageRequest } from '../../shared/generation.js';
import type { JobRecord } from '../../shared/jobs.js';
import type { Reference } from '../references.js';
import { uploadReferences } from '../uploads.js';

type SubmissionState =
  | { status: 'idle' }
  | { status: 'uploading' | 'submitting'; scope: string; progress?: string }
  | { status: 'error'; scope: string; message: string };
type Input = {
  request: ImageRequest;
  references: Reference[];
  sourceJob?: string;
};

export function useGenerationSubmission(scope: string) {
  const [state, setState] = useState<SubmissionState>({ status: 'idle' });
  const busy = useRef(false);
  const pending = useRef(new Map<string, string>());
  const attempts = useRef(new Map<string, { fingerprint: string; body: string; url: string; request: ImageRequest; sourceJob?: string; restorable: boolean }>());
  const editVersions = useRef(new Map<string, number>());
  const fingerprint = ({request, references, sourceJob}: Input) => JSON.stringify({ request, sourceJob, references: references.map(({file, url, ...reference}) => ({...reference, file: file ? [file.name, file.size, file.lastModified] : undefined})) });
  async function submit({ request, references, sourceJob }: Input) {
    if (busy.current) return;
    busy.current = true;
    const requestScope = request.mode + ':' + request.workflow;
    // Freeze this click before uploads; later form/preference updates are a different intent.
    request = structuredClone(request);
    references = references.map(reference => ({...reference}));
    const inputFingerprint = fingerprint({request, references, sourceJob});
    const editVersion = editVersions.current.get(requestScope) ?? 0;
    let identity: string | undefined;
    try {
      const prior = attempts.current.get(requestScope);
      const retry = prior?.fingerprint === inputFingerprint ? prior : undefined;
      setState({ status: 'uploading', scope: requestScope });
      const uploaded =
        !retry && usesInputs(request.workflow)
          ? await uploadReferences(references, request.mode, (progress) =>
              setState({ status: 'uploading', scope: requestScope, progress }),
            )
          : undefined;
      const inputs=request.workflow==='image-to-image'?uploaded?.map(({id,asset_id,kind,role})=>({id,asset_id,kind,role})):uploaded;
      const body = retry?.body ?? JSON.stringify({ ...request, ...(inputs ? { references: inputs } : {}) });
      const url = retry?.url ?? (sourceJob
        ? '/api/v1/jobs/' + encodeURIComponent(sourceJob) + '/repeat'
        : '/api/v1/jobs');
      identity = url + '\n' + body;
      if (!pending.current.has(identity))
        pending.current.set(
          identity,
          Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join(''),
        );
      attempts.current.set(requestScope, { fingerprint: inputFingerprint, body, url, request, sourceJob, restorable: editVersion === (editVersions.current.get(requestScope) ?? 0) });
      setState({ status: 'submitting', scope: requestScope });
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': pending.current.get(identity)!,
        },
        body: sourceJob ? JSON.stringify({ request: JSON.parse(body) }) : body,
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) { pending.current.delete(identity); attempts.current.delete(requestScope); }
        throw Error(result.error?.message ?? 'Could not submit generation.');
      }
      pending.current.delete(identity);
      attempts.current.delete(requestScope);
      setState({ status: 'idle' });
      return result.jobs as JobRecord[];
    } catch (error) {
      setState({
        status: 'error',
        scope: requestScope,
        message:
          (error as Error).message +
          (identity && pending.current.has(identity)
            ? ' Retrying will check the same submission.'
            : ''),
      });
    } finally {
      busy.current = false;
    }
  }
  return {
    submit,
    hasPending: (requestScope: string) => attempts.current.has(requestScope),
    edited: (requestScope: string) => {
      editVersions.current.set(requestScope, (editVersions.current.get(requestScope) ?? 0) + 1);
      const attempt = attempts.current.get(requestScope);
      if (attempt) attempt.restorable = false;
      setState(value => value.status === 'error' && value.scope === requestScope ? {status:'idle'} : value);
    },
    pendingDraft: (requestScope: string) => {
      const attempt = attempts.current.get(requestScope);
      return attempt?.restorable ? {request: structuredClone(attempt.request), sourceJob: attempt.sourceJob} : undefined;
    },
    busy: state.status === 'uploading' || state.status === 'submitting',
    progress: state.status === 'uploading' && state.scope === scope ? state.progress : undefined,
    error: state.status === 'error' && state.scope === scope ? state.message : undefined,
  };
}
