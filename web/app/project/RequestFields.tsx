import { sizeOptions } from './requests.js';
import { styleName, type StyleEntry } from './readiness.js';

/** The settings a request shares between Make settings and the draft editor. */
export type RequestFieldValues = {
  aspect: string;
  size: string;
  count: number;
  duration: number;
  sound: 'generated' | 'silent';
  detail: 'standard' | 'full';
  style?: { id: string; revision: string; scale: number };
  target: 'auto' | 'local' | 'cloud';
};
type Option = readonly [value: string | number, label: string, disabled?: boolean];

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | number;
  options: readonly Option[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select aria-label={label} className="select" value={value} onChange={e => onChange(e.target.value)}>
        {options.map(([v, text, disabled]) => (
          <option key={v} value={v} disabled={disabled}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

const stills: Option[] = [
  ['16:9', 'Landscape 16:9'],
  ['1:1', 'Square 1:1'],
  ['4:5', 'Portrait 4:5'],
  ['9:16', 'Tall portrait 9:16'],
];
const clips: Option[] = [
  ['16:9', 'Landscape 16:9'],
  ['9:16', 'Portrait 9:16'],
];

/**
 * Shape, size, count, clip length, sound and detail, style and where it runs. `shape` hides the shape for work that
 * keeps its source's shape; `fromSource` offers "Same as the source"; `cloudBlocked` says cloud GPUs cannot run it.
 */
export function RequestFields({
  workflow,
  value: v,
  onChange,
  styles,
  route,
  shape = true,
  fromSource = false,
  cloudBlocked = false,
}: {
  workflow: string;
  value: RequestFieldValues;
  onChange: (patch: Partial<RequestFieldValues>) => void;
  styles: StyleEntry[];
  /** Which styles fit this work (image, fl or ref). */
  route: string | null;
  shape?: boolean;
  fromSource?: boolean;
  cloudBlocked?: boolean;
}) {
  const video = workflow === 'text-to-video' || workflow === 'reference-to-video';
  const available = styles.filter(s => s.route === route);
  const style = v.style;
  return (
    <div className="row">
      {shape && (
        <Select
          label="Shape"
          value={v.aspect}
          options={video ? clips : [...(fromSource ? [['source', 'Same as the source'] as const] : []), ...stills]}
          onChange={aspect => onChange({ aspect })}
        />
      )}
      <Select
        label="Size"
        value={v.size}
        options={sizeOptions(workflow, shape ? v.aspect : 'source').map(o => [o.id, o.label] as const)}
        onChange={size => onChange({ size })}
      />
      <Select
        label="How many"
        value={v.count}
        options={[1, 2, 3, 4, 6, 8].map(n => [n, String(n)] as const)}
        onChange={n => onChange({ count: Number(n) })}
      />
      {video && (
        <>
          <Select
            label="Length"
            value={v.duration}
            options={[5, 6, 8, 10, 12, 15].map(n => [n, n + ' seconds'] as const)}
            onChange={n => onChange({ duration: Number(n) })}
          />
          <Select
            label="Sound"
            value={v.sound}
            options={[
              ['generated', 'With sound'],
              ['silent', 'Silent'],
            ]}
            onChange={sound => onChange({ sound: sound as RequestFieldValues['sound'] })}
          />
          <Select
            label="Detail"
            value={v.detail}
            options={[
              ['standard', 'Fast'],
              ['full', 'Full (slower)'],
            ]}
            onChange={detail => onChange({ detail: detail as RequestFieldValues['detail'] })}
          />
        </>
      )}
      {workflow !== 'image-to-image' && (
        <Select
          label="Style"
          value={style?.id ?? ''}
          options={[
            ['', 'No style'],
            // A style chosen in another tab, or one this list cannot offer for this work, still shows.
            ...(style && !available.some(s => s.id === style.id)
              ? [
                  [
                    style.id,
                    styleName(styles, style.id) === 'Style' ? 'The chosen style' : styleName(styles, style.id),
                  ] as const,
                ]
              : []),
            ...available.map(
              s =>
                [
                  s.id,
                  s.name + (s.source_status === 'needs_source' ? ' (needs source)' : ''),
                  s.source_status === 'needs_source',
                ] as const,
            ),
          ]}
          onChange={id => {
            const s = available.find(x => x.id === id);
            onChange({ style: s ? { id: s.id, revision: s.revision, scale: s.default_scale ?? 1 } : undefined });
          }}
        />
      )}
      {style && (
        <label className="field">
          <span>Style strength</span>
          <input
            className="input"
            type="number"
            min={0}
            max={4}
            step={0.05}
            value={style.scale}
            onChange={e => onChange({ style: { ...style, scale: Number(e.target.value) } })}
          />
        </label>
      )}
      <Select
        label="Runs on"
        value={v.target}
        options={[
          ['auto', 'Auto'],
          ['local', 'Seed PC'],
          ['cloud', cloudBlocked ? 'Cloud GPU: not for reference-based shots yet' : 'Cloud GPU', cloudBlocked],
        ]}
        onChange={target => onChange({ target: target as RequestFieldValues['target'] })}
      />
    </div>
  );
}
