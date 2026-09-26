import React, { useState } from 'react';
import { loraWorkflowLabels, type ImportState, type LoraImportActivity } from '../shared/loras.js';
import './import-activity.css';

const labels: Record<ImportState, string> = {
  queued: 'Waiting',
  downloading: 'Downloading',
  validating: 'Validating',
  uploading: 'Finalizing',
  ready: 'Ready',
  failed: 'Needs attention',
};
export function ImportActivity({
  job,
  onRefresh,
}: {
  job: LoraImportActivity;
  onRefresh: () => void;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  async function retry() {
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/v1/lora-imports/' + job.id + '/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) {
        const result = await response.json();
        throw Error(result.error?.message ?? 'Could not retry this import.');
      }
      onRefresh();
      window.dispatchEvent(new Event('seed:activity-changed'));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="import-activity" aria-label={'LoRA import: ' + job.name}>
      <div className="job-list-heading">
        <h3>
          {job.name} <small>{job.version}</small>
        </h3>
        <span className={'activity-state' + (job.state === 'failed' ? ' needs-attention' : '')}>
          {labels[job.state]}
        </span>
      </div>
      <small>LoRA import · {new Date(job.created_at).toLocaleString()}</small>
      <div className="import-activity-files">
        {job.files.map((file, index) => (
          <div key={index}>
            <div className="import-file-heading">
              <strong>{file.name}</strong>
              <span>{labels[file.state]}</span>
            </div>
            <small>{loraWorkflowLabels[file.route]}</small>
            {file.state === 'downloading' && file.total > 0 && (
              <>
                <progress
                  aria-label={'Downloading ' + file.name}
                  max={file.total}
                  value={Math.min(file.bytes, file.total)}
                />
                <small>
                  {(file.bytes / 1024 ** 2).toFixed(1)} / {(file.total / 1024 ** 2).toFixed(1)} MB
                </small>
              </>
            )}
          </div>
        ))}
      </div>
      {job.error && <p role="alert">{job.error}</p>}
      {error && <p role="alert">{error}</p>}
      {job.state === 'failed' && (
        <div className="activity-actions">
          <button type="button" disabled={pending} onClick={() => void retry()}>
            {pending ? 'Retrying…' : 'Retry import'}
          </button>
        </div>
      )}
    </section>
  );
}
