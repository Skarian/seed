import React from 'react';

export function GpuTypeFilter({options, value, onChange, loading}: {
  options: string[]; value: string[]; onChange: (value: string[]) => void; loading: boolean;
}) {
  // Keep a selected type visible if it sells out during refresh; never silently broaden the filter.
  const choices = [...new Set([...options, ...value])].sort((a, b) =>
    a.localeCompare(b, 'en', {numeric: true, sensitivity: 'base'}));
  const summary = value.length === 0 ? 'All GPU types' : value.length === 1 ? value[0] : `${value.length} GPU types selected`;
  return <fieldset className="gpu-type-filter">
    <legend>GPU type</legend>
    <details>
      <summary aria-label={`GPU type: ${summary}`}><span>{summary}</span><span aria-hidden="true">⌄</span></summary>
      <div className="gpu-type-options">
        <div className="gpu-type-toolbar"><span>Choose one or more</span>
          <button type="button" disabled={!value.length} onClick={() => onChange([])}>Clear GPU filter</button>
        </div>
        <div className="gpu-type-choices">
          {choices.map(gpu => <label key={gpu}>
            <input type="checkbox" checked={value.includes(gpu)} onChange={event =>
              onChange(event.target.checked ? [...value, gpu] : value.filter(name => name !== gpu))} />
            <span>{gpu}{!loading && !options.includes(gpu) && <small>Currently unavailable</small>}</span>
          </label>)}
          {!choices.length && <p>{loading ? 'Searching GPU types…' : 'No GPU types available.'}</p>}
        </div>
      </div>
    </details>
  </fieldset>;
}
