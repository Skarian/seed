import catalog from '../worker/resolutions.json' with { type: 'json' };

export type ImageSize = 'image-480' | 'image-768' | '2mp' | 'image-1440' | '0.5mp' | '1mp';
export type VideoSize = '480p' | '768p';
export type ResolutionSize = ImageSize | VideoSize;
export type ResolutionFamily = 'image' | 'video';
export type Dimensions = { width: number; height: number };
export type ResolutionPreset = Dimensions & { id: ResolutionSize; area?: number; released: boolean; legacy?: boolean };
export type GeneratePreferences = { image: ImageSize; video: VideoSize };
export const defaultPreferences: GeneratePreferences = { image: 'image-768', video: '768p' };

export function resolutionFamily(workflow: string): ResolutionFamily {
  return workflow === 'text-to-video' || workflow === 'reference-to-video' || workflow === 'video' ? 'video' : 'image';
}
export function sizeChoices(workflow: string, includeCandidates = false): ResolutionPreset[] {
  return (catalog[resolutionFamily(workflow)] as ResolutionPreset[]).filter(p => !p.legacy && (includeCandidates || p.released));
}
export function isResolutionSize(workflow: string, value: unknown, includeCandidates = false): value is ResolutionSize {
  // Saved requests and Qwen auxiliary inputs retain their original size IDs.
  return (catalog[resolutionFamily(workflow)] as ResolutionPreset[]).some(p => p.id === value && (includeCandidates || p.released));
}
export function editDimensions(width: number, height: number, size: ImageSize = '1mp'): Dimensions {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 32 || height < 32 || width * height > 100_000_000 || width / height > 4 || height / width > 4)
    throw Error('Choose an image at least 32 pixels on each side, up to 100 megapixels, with an aspect ratio between 1:4 and 4:1.');
  const preset = catalog.image.find(p => p.id === size);
  if (!preset) throw Error('Unsupported image resolution.');
  const scale = Math.min(1, Math.sqrt(preset.area / (width * height)));
  return { width: Math.max(32, Math.round(width * scale / 32) * 32), height: Math.max(32, Math.round(height * scale / 32) * 32) };
}
export function resolveDimensions(workflow: string, size: ResolutionSize, aspect: string, source?: Dimensions): Dimensions {
  const preset = (catalog[resolutionFamily(workflow)] as ResolutionPreset[]).find(p => p.id === size);
  if (!preset) throw Error('Unsupported resolution.');
  if (workflow === 'image-to-image' && aspect === 'source') {
    if (!source) throw Error('Choose a source image first.');
    return editDimensions(source.width, source.height, size as ImageSize);
  }
  // Square and 4:5 stills keep the preset's pixel area, rounded to the model's 32-pixel grid.
  if (resolutionFamily(workflow) === 'image' && (aspect === '1:1' || aspect === '4:5')) {
    const area = preset.area ?? preset.width * preset.height, ratio = aspect === '1:1' ? 1 : 4 / 5;
    return { width: Math.round(Math.sqrt(area * ratio) / 32) * 32, height: Math.round(Math.sqrt(area / ratio) / 32) * 32 };
  }
  if (aspect !== '16:9' && aspect !== '9:16') throw Error('Choose a supported orientation.');
  return aspect === '9:16' ? { width: preset.height, height: preset.width } : { width: preset.width, height: preset.height };
}
export function dimensionLabel(dimensions: Dimensions): string {
  return `${dimensions.width} × ${dimensions.height}`;
}

/** A small source may collapse multiple presets to the same menu row. */
export function resolutionOptions(workflow: string, aspect: string, selected: ResolutionSize, source?: Dimensions, includeCandidates = false) {
  const groups = new Map<string, { label: string; size: ResolutionSize }>();
  const choices = sizeChoices(workflow, includeCandidates);
  const saved = (catalog[resolutionFamily(workflow)] as ResolutionPreset[]).find(p => p.id === selected && p.legacy && (includeCandidates || p.released));
  // Only add a historical size when it is the active selection.
  if (saved) choices.push(saved);
  for (const preset of choices) {
    const label = dimensionLabel(resolveDimensions(workflow, preset.id, aspect, source));
    if (!groups.has(label) || preset.id === selected) groups.set(label, { label, size: preset.id });
  }
  return [...groups.values()];
}

/**
 * FLUX 3 Image Klein's canvas (EmptyFlux2LatentImage) must be a multiple of 16 on each side: 1920 × 1080 becomes
 * 1920 × 1088. The graph, the saved size and the worker's check all use this one rounding.
 */
export function kleinCanvas(d: Dimensions): Dimensions {
  return { width: Math.round(d.width / 16) * 16, height: Math.round(d.height / 16) * 16 };
}
