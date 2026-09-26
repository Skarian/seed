import React from 'react';
import {
  familyRoutes,
  loraWorkflowLabels,
  type LoraFamily,
  type LoraRoute,
} from '../shared/loras.js';
import './lora-file-mappings.css';
import { formatBytes } from './format.js';
export type FileMapping = Record<string, LoraRoute | ''>;
type FileRow = { id: string | number; name: string; size_bytes?: number; supported?: boolean };
export function LoraFileMappings({
  family,
  files,
  value,
  onChange,
  disabled = false,
}: {
  family: LoraFamily;
  files: FileRow[];
  value: FileMapping;
  onChange: (next: FileMapping) => void;
  disabled?: boolean;
}) {
  return (
    <div className="lora-file-table" role="group" aria-label="File workflow mappings">
      <div className="lora-file-table-heading" aria-hidden="true">
        <span>File</span>
        <span>Workflow mapping</span>
      </div>
      {files.map((file) => (
        <div className="lora-file-row" key={file.id}>
          <div className="lora-file-name">
            <strong>{file.name}</strong>
            <small>
              {file.size_bytes !== undefined
                ? formatBytes(file.size_bytes)
                : ''}
              {file.supported === false ? ' · Unsupported file type' : ''}
            </small>
          </div>
          <label>
            <span className="sr-only">Workflow mapping for {file.name}</span>
            <select
              disabled={disabled || file.supported === false}
              value={value[file.id] ?? ''}
              onChange={(event) =>
                onChange({ ...value, [file.id]: event.target.value as LoraRoute | '' })
              }
            >
              <option value="">Skip</option>
              {familyRoutes(family).map((route) => (
                <option
                  key={route}
                  value={route}
                  disabled={Object.entries(value).some(
                    ([id, selected]) => id !== String(file.id) && selected === route,
                  )}
                >
                  {loraWorkflowLabels[route]}
                </option>
              ))}
            </select>
          </label>
        </div>
      ))}
      {!files.length && <p>No adapter files in this version.</p>}
    </div>
  );
}
