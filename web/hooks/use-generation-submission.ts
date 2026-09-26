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
  async function submit({ request, references, sourceJob }: Input) {
    if (busy.current) return;
    busy.current = true;
    const requestScope = request.mode + ':' + request.workflow;
    let identity: string | undefined;
    try {
      setState({ status: 'uploading', scope: requestScope });
      const uploaded =
        usesInputs(request.workflow)
          ? await uploadReferences(references, request.mode, (progress) =>
              setState({ status: 'uploading', scope: requestScope, progress }),
            )
          : undefined;
      const inputs=request.workflow==='image-to-image'?uploaded?.map(({id,asset_id,kind,role})=>({id,asset_id,kind,role})):uploaded;
      const body = JSON.stringify({ ...request, ...(inputs ? { references: inputs } : {}) });
      const url = sourceJob
        ? '/api/v1/jobs/' + encodeURIComponent(sourceJob) + '/repeat'
        : '/api/v1/jobs';
      identity = url + '\n' + body;
      if (!pending.current.has(identity))
        pending.current.set(
          identity,
          Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join(''),
        );
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
        if (response.status < 500) pending.current.delete(identity);
        throw Error(result.error?.message ?? 'Could not submit generation.');
      }
      pending.current.delete(identity);
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
    busy: state.status === 'uploading' || state.status === 'submitting',
    progress: state.status === 'uploading' && state.scope === scope ? state.progress : undefined,
    error: state.status === 'error' && state.scope === scope ? state.message : undefined,
  };
}
