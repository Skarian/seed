import { imageAspects, normalizeShot } from '../../shared/generation.js';
import { isVideoWorkflow, usesInputs } from '../../shared/workflows.js';
import { randomUUID } from 'node:crypto';
import { Type } from '@earendil-works/pi-ai';
import { imageRequest, type ImageRequest } from '../workflows.js';
import { VideoRequestError, type RequestIssue } from '../video.js';
import type { InputReference } from '../media.js';
import type { ChatMode, ChatWorkflow } from '../../shared/chat.js';
import { inputLabels, promptBindings, promptReferencePattern } from '../../shared/reference-labels.js';
import { defaultPreferences } from '../../shared/resolution.js';
import { ToolFailure, type ToolFailureResult } from './tools/define.js';
import { DEFAULT_VIDEO_DETAIL, DEFAULT_VIDEO_STEPS, VIDEO_DETAILS, VIDEO_STEPS } from '../../shared/video-settings.js';

export type ReferenceMode = 'direct' | 'stable';
export interface ToolAsset {
  handle: string;
  asset_id: string;
  kind: 'image' | 'video' | 'audio';
  duration_seconds?: number;
}
export interface RequestToolContext {
  workflow: ChatWorkflow;
  mode: ChatMode;
  assets: ToolAsset[];
  previous?: ImageRequest;
  referenceMode?: ReferenceMode;
  compilePrompt?: (prompt: string, references: InputReference[], previous?: ImageRequest) => string;
  /** What a cloud GPU can make now ("image-to-image:klein" for pictures from references); unknown means not Klein. */
  cloudWorkflows?: string[];
}
export class ToolRequestError extends Error {
  constructor(public issues: RequestIssue[]) {
    super(issues.map(i => `${i.field}: ${i.message}${i.fix ? ' ' + i.fix : ''}`).join('\n'));
    this.name = 'ToolRequestError';
  }
}
const enumOf = (values: string[], description = '') =>
  Type.String({
    enum: values,
    description: `${description}${description ? ' ' : ''}Allowed values: ${values.join(', ')}.`,
  });
/** Flat schemas intentionally avoid requiring unchanged settings during edits. */
export function requestToolSchemas(workflow: ChatWorkflow, mode: ChatMode, hasLoras = true) {
  const video = isVideoWorkflow(workflow),
    editingImage = workflow === 'image-to-image';
  hasLoras = hasLoras && !editingImage;
  const input = Type.Object(
    {
      asset: Type.Optional(
        Type.String({
          description:
            'New input: copy its supplied asset handle here. Example if the handle is input1: {asset: \"input1\", role: \"first_frame\"}.',
        }),
      ),
      replace_asset: Type.Optional(
        Type.String({
          description:
            'Replace the source of an existing id deliberately. Copy the new asset handle. For reordering, use only existing ids in the new order.',
        }),
      ),
      id: Type.Optional(
        Type.String({
          description:
            'Existing input only: copy an id from the current request. Never use id to add an asset. Omit for a new input.',
        }),
      ),
      instance: Type.Optional(
        Type.String({
          pattern: '^[-\\w]{1,100}$',
          description:
            'New inputs only: optional distinct name when the same asset is used more than once, e.g. clipA and clipB. Use this name for the specific clip token. When several selected video clips share a source, its asset handle names their shared source, not one clip. Omit for ordinary single use. Do not combine with id.',
        }),
      ),
      role: Type.Optional(
        enumOf(
          editingImage ? ['source', 'reference'] : ['reference', 'first_frame', 'last_frame'],
          'Image editing: exactly one source, other images reference. Video/audio: reference only. Images: reference, opening guide first_frame, or ending guide last_frame.',
        ),
      ),
      ...(!editingImage
        ? { framing: Type.Optional(enumOf(['fit', 'fill'], 'Images only: fit keeps the whole image.')) }
        : {}),
      ...(!editingImage
        ? {
            start_seconds: Type.Optional(Type.Number({ minimum: 0 })),
            duration_seconds: Type.Optional(Type.Number({ minimum: 2, maximum: 15 })),
            include_audio: Type.Optional(
              Type.Boolean({
                description:
                  'Video input soundtrack only: set true when asked to use the source soundtrack, even if final audio_output is silent. false excludes it.',
              }),
            ),
          }
        : {}),
    },
    {
      additionalProperties: false,
      description:
        'App determines media kind. Only images can be first_frame/last_frame. Video/audio need a 2–15 second clip. For edits this list replaces the input list; list each input to keep, using its id.',
    },
  );
  const fields = {
    prompt: Type.String({
      minLength: 1,
      maxLength: editingImage ? 5000 : 12000,
      description:
        workflow === 'reference-to-video'
          ? 'Complete prompt. Keep every user requirement, including exclusions. If ANY input has role reference, use subject_definitions, summary, retention_analysis, detailed_description, overall_soundscape, non_diegetic_music. Only frame guides use integrated_multimodal_description, overall_soundscape, non_diegetic_music. An edit replaces the whole prompt.'
          : 'Complete generation prompt. Keep every user requirement, including exclusions. An edit replaces the whole prompt.',
    }),
    ...(hasLoras
      ? {
          loras: Type.Array(
            Type.Object(
              { id: Type.String(), revision: Type.String(), scale: Type.Number({ minimum: 0, maximum: 4 }) },
              { additionalProperties: false },
            ),
            {
              maxItems: 3,
              description:
                'Prefer zero or one compatible adapter from available_loras. Copy its id and revision exactly; use its default_scale unless the user asks otherwise. An empty array removes all adapters. Omit during edits to keep the current selection.',
            },
          ),
        }
      : {}),
    batch_size: Type.Integer({ minimum: 1, maximum: 16 }),
    seed: Type.String({
      pattern: '^(random|0|[1-9][0-9]{0,15})$',
      description: 'random, or the starting seed as a string; last batch seed must be <=9007199254740991.',
    }),
    aspect_ratio: enumOf(
      editingImage ? ['source', ...imageAspects] : workflow === 'text-to-image' ? [...imageAspects] : ['16:9', '9:16'],
      editingImage
        ? 'source keeps the source image’s shape. With engine klein, a new shape (16:9, 9:16, 1:1, 4:5) makes a new picture that uses the images as references; with engine qwen only source is allowed.'
        : workflow === 'text-to-image'
          ? '16:9 is landscape; 9:16 is tall portrait; 1:1 is square; 4:5 is portrait (posters, social).'
          : '16:9 is landscape; 9:16 is portrait.',
    ),
    ...(editingImage
      ? {
          engine: enumOf(
            ['klein', 'qwen'],
            'klein is FLUX 3 Image Klein (default): best for new shots of a character or place from reference images, at any shape, and for most edits. qwen is Qwen Image Edit, kept for older drafts.',
          ),
        }
      : {}),
    runs_on: enumOf(
      ['auto', 'seed_pc', 'cloud'],
      'Where it is made: seed_pc is the owner’s own PC (no rental), cloud is a rented cloud GPU, auto picks whichever is ready. Set it only when the user says where to run.',
    ),
    title: Type.String({
      minLength: 1,
      maxLength: 80,
      description:
        'A short name for this draft in the user’s own words, 2-6 words, e.g. "Cat on the sill". Always include it; it is shown on the draft and its results.',
    }),
    note: Type.String({ maxLength: 4000, description: 'A note saved with generated assets. Empty text clears it.' }),
    shot: Type.Object(
      {
        number: Type.Optional(
          Type.Integer({ minimum: 1, maximum: 999, description: 'Shot or page number in the film or set.' }),
        ),
        name: Type.Optional(
          Type.String({ maxLength: 60, description: 'Short shot name without the number, e.g. "Causeway Wide".' }),
        ),
        cast: Type.Optional(
          Type.Array(Type.String({ maxLength: 40 }), {
            maxItems: 12,
            description: 'Characters visible in this shot, by the names the brief uses.',
          }),
        ),
        offscreen: Type.Optional(
          Type.Array(Type.String({ maxLength: 40 }), {
            maxItems: 12,
            description: 'Characters in the scene but deliberately out of frame.',
          }),
        ),
        place: Type.Optional(Type.String({ maxLength: 60, description: 'The place, by the name the brief uses.' })),
        framing: Type.Optional(
          Type.String({
            maxLength: 60,
            description: 'Framing in film terms: wide, medium, close-up, insert, two-shot.',
          }),
        ),
        lens_mm: Type.Optional(
          Type.Integer({ minimum: 4, maximum: 1200, description: 'Lens in millimetres when the user named one.' }),
        ),
        delivery: Type.Optional(
          Type.String({
            pattern: '^\\d{1,2}(\\.\\d{1,2})?:\\d{1,2}(\\.\\d{1,2})?$',
            description:
              'The shape the user will deliver at when it differs from aspect_ratio, e.g. "2.39:1" for a film made at 16:9 and cropped later.',
          }),
        ),
      },
      {
        additionalProperties: false,
        description:
          'For films, sequences and image sets: which shot this draft is and who is in it. Fill it on every draft of a multi-shot project. During edits, send only fields that change.',
      },
    ),
    ...(video
      ? {
          steps: Type.Integer({
            enum: [...VIDEO_STEPS],
            description:
              'Sampling steps: 10, 15, 20, or 30. New videos default to 20. More steps take longer; fewer can reduce detail, motion consistency, or audio clarity.',
          }),
          detail: enumOf(
            [...VIDEO_DETAILS],
            'Detail: standard is the default and is faster; full spends a little more time on fine detail. Works with any steps value.',
          ),
          duration_seconds: Type.Integer({
            minimum: 5,
            maximum: 15,
            description: 'Generated video length. Distinct from each input clip duration.',
          }),
          audio_output: enumOf(
            ['generated', 'silent'],
            'Final output sound: silent means no audio; generated enables sound. For silence, set silent explicitly; do not omit this setting.',
          ),
        }
      : {}),
    ...(usesInputs(workflow) ? { inputs: Type.Array(input, { minItems: 1, maxItems: editingImage ? 10 : 12 }) } : {}),
    ...(mode === 'nsfw' ? { mode: enumOf(['sfw', 'nsfw']) } : {}),
  };
  const optional = Type.Partial(Type.Object(fields, { additionalProperties: false }));
  return {
    create: Type.Object(
      {
        ...optional.properties,
        prompt: fields.prompt,
        ...(usesInputs(workflow)
          ? {
              inputs: Type.Array(
                Type.Object(
                  {
                    ...input.properties,
                    asset: Type.String({ description: 'Required: copy a supplied asset handle, e.g. input1.' }),
                  },
                  { additionalProperties: false },
                ),
                { minItems: 1, maxItems: editingImage ? 10 : 12 },
              ),
            }
          : {}),
      },
      { additionalProperties: false },
    ),
    edit: Type.Object(
      { ...optional.properties, request_id: Type.String({ minLength: 1 }) },
      { additionalProperties: false },
    ),
  };
}
export function requestToolRules(mode: ReferenceMode = 'direct', workflow?: string) {
  return (
    `Resolution is controlled in the request editor. Never send size in a tool call. New Chat requests use fixed image size ${defaultPreferences.image} or video size ${defaultPreferences.video}, independently of remembered Generate selections. Editing a request preserves its manual resolution. If asked to change resolution, direct the user to the request editor. ` +
    referenceToolRules(mode, workflow)
  );
}
function referenceToolRules(mode: ReferenceMode, workflow?: string) {
  if (workflow === 'image-to-image')
    return `Create an editing review card with create_request; modify one with edit_request and its request_id. Tools do not generate images. Use a complete editing instruction. Exactly one supplied image must have role source, the rest role reference (up to 10 images total). New inputs use asset handles; existing inputs use id. Replace a source using its id and replace_asset. A supplied inputs array replaces the list: include all inputs to keep. Use stable [[input_handle]] tokens in the instruction. Omitted fields remain unchanged during edits. Defaults: batch_size 1, seed random, aspect_ratio source, size ${defaultPreferences.image}. No LoRA, video, audio, framing or strength settings. A failed save creates no card or revision; fix the reported fields and retry.`;
  return `Use create_request for a new review card. Use edit_request with the supplied request_id to change a card. Neither tool generates media. Send only changed settings when editing; omitted settings and inputs stay unchanged. Use a complete prompt, not a text replacement operation. For a new input, use asset, not id. Example when the supplied asset handle is input1: {"asset":"input1","role":"first_frame"}. For an existing input, copy its current id: {"id":"input1"}. Reorder by listing ids in the new order. To replace an input source deliberately, use {"id":"input1","replace_asset":"input2"}; do not use asset with a different existing id. To use one source twice, give each new input a distinct instance name, e.g. clipA and clipB; its prompt token uses that instance name. A supplied inputs array replaces the list: include each input to keep, using its existing id. A failed save creates no card or revision. Defaults for a new request: batch_size 1, seed random, aspect_ratio 16:9; video size 768p, duration_seconds 5, generated audio, video output. For a silent result, set audio_output to silent explicitly. audio_output accepts only generated or silent; it is not the output file format. Do not omit a setting to bypass a rejection if the user asked for it. Video/audio inputs use role reference and need start_seconds plus duration_seconds (2–15). Only images can be first_frame or last_frame. General references may be combined with first/last image guides. Keep their roles explicit. Keep image framing fit unless the user asks to crop. If asked to use a video soundtrack, set include_audio true even when final audio_output is silent. A standalone audio input is already audio: omit include_audio. Its token is [[input1]], not [[input1:audio]]; :audio is for a video soundtrack. To exclude standalone audio, remove that input from the list. ${mode === 'stable' ? 'Use input tokens in the prompt, for example [[input1]] or [[clipA]]. Use [[clipA]] and [[clipB]] for their specific clips. If both clips come from input2, [[input2]] means the source video shared by both selected clips; it never selects one clip or adds the whole video. Shared source tokens are general context only; timed actions must name the specific clip tokens. For a soundtrack, use a specific clip token, never a shared source token. A video soundtrack uses [[clipA:audio]]. Frame guides use the same token form; the app translates it to the correct label or guide description. Do not write numbered Picture/Video/Audio labels.' : 'In the prompt, copy labels from the current input mapping. Do not use a prompt label as an input id.'}`;
}
/** Resolver keyed by input instance, including distinct soundtrack channels. */
export function toolInputLabels(refs: InputReference[]): Map<string, string> {
  return inputLabels(refs);
}
/** Every app-compiled reference, including frame guides without numbered labels. */
export const toolPromptBindings = promptBindings;
export const toolPromptReferencePattern = promptReferencePattern;
export function compileStablePrompt(prompt: string, refs: InputReference[], assets: ToolAsset[] = []): string {
  const labels = toolPromptBindings(refs),
    issues: RequestIssue[] = [];
  if (/<(?:Picture|Video|Audio)\s+\d+>/.test(prompt))
    issues.push({
      field: 'prompt',
      message: 'Use supplied [[input_handle]] tokens instead of numbered provider labels.',
    });
  const compiled = prompt.replace(/\[\[([^\[\]]+)\]\]/g, (_all, handle: string) => {
    const audioId = handle.endsWith(':audio') ? handle.slice(0, -6) : undefined;
    const audioAlias =
      audioId !== undefined && refs.some(r => r.id === audioId && r.kind === 'audio') ? labels.get(audioId) : undefined;
    // A source handle can name the common source of several selected clips, but
    // must never silently select one clip or merge their soundtrack channels.
    const sourceIds = new Set(
      assets.filter(asset => asset.handle === handle && asset.kind === 'video').map(asset => asset.asset_id),
    );
    const clips =
      audioId === undefined && sourceIds.size === 1
        ? refs.filter(ref => ref.kind === 'video' && sourceIds.has(ref.asset_id))
        : [];
    const clipLabels = clips.map(ref => labels.get(ref.id));
    const sourceGroup =
      clips.length > 1 && clipLabels.every(Boolean)
        ? `the source video shared by ${clipLabels.slice(0, -1).join(', ')} and ${clipLabels.at(-1)}`
        : undefined;
    const label = labels.get(handle) ?? audioAlias ?? sourceGroup;
    if (!label) {
      const valid = [...labels.keys()].map(id => `[[${id}]]`).join(', ');
      const disabledSoundtrack =
        audioId !== undefined && refs.some(r => r.id === audioId && r.kind === 'video' && !r.include_audio);
      issues.push({
        field: 'prompt',
        message: `Input token [[${handle}]] is not available in this request.`,
        fix: [
          valid ? `Available prompt tokens: ${valid}.` : 'This request has no available input tokens.',
          disabledSoundtrack
            ? 'That video soundtrack is excluded. Set include_audio true only if the user wants to use it; otherwise remove its soundtrack token.'
            : 'Use the input instance tokens above. Describe a shared source in plain words, such as "the source video", without a token.',
        ].join(' '),
      });
    }
    return label ?? _all;
  });
  if (compiled.includes('[[') || compiled.includes(']]'))
    if (!issues.length)
      issues.push({ field: 'prompt', message: 'An input token is incomplete. Use [[input_handle]].' });
  if (issues.length) throw new ToolRequestError(issues);
  return compiled;
}
/**
 * Build and validate the entire candidate before callers save anything. Does not mutate context. The agent library
 * has already checked the call against the tool's schema (no unknown settings), so only the rules a schema cannot say
 * are checked here.
 */
export function prepareToolRequest(context: RequestToolContext, raw: unknown): ImageRequest {
  const issues: RequestIssue[] = [];
  const add = (field: string, message: string, fix?: string) =>
    issues.push({ field, message, ...(fix ? { fix } : {}) });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new ToolRequestError([{ field: 'request', message: 'Provide request settings.' }]);
  const value = raw as Record<string, any>,
    video = isVideoWorkflow(context.workflow);
  if (value.request_id !== undefined && !context.previous)
    add('request_id', 'No existing request was supplied for this edit.', 'Use create_request for a new card.');
  if (!context.previous && value.prompt === undefined) add('prompt', 'Provide the generation prompt.');
  if (context.previous && Object.keys(value).every(k => k === 'request_id'))
    add('request', 'No changes were supplied.', 'Send at least one changed setting.');
  const request: any = context.previous
    ? structuredClone(context.previous)
    : {
        workflow: context.workflow,
        mode: context.mode,
        prompt: '',
        count: 1,
        seed: 'random',
        output: {
          aspect: context.workflow === 'image-to-image' ? 'source' : '16:9',
          size: video ? defaultPreferences.video : defaultPreferences.image,
          ...(video ? { duration_seconds: 5, format: 'video' } : {}),
        },
        ...(video
          ? { steps: DEFAULT_VIDEO_STEPS, detail: DEFAULT_VIDEO_DETAIL, audio: { output: 'silent' }, references: [] }
          : {}),
      };
  request.workflow = context.workflow;
  // New edit drafts use FLUX 3 Image Klein; saved drafts keep their engine unless the tool names one.
  if (context.workflow === 'image-to-image') {
    const engine = Object.hasOwn(value, 'engine')
      ? value.engine
      : context.previous
        ? ((context.previous as { engine?: string }).engine ?? 'qwen')
        : 'klein';
    if (engine === 'klein') request.engine = 'klein';
    else delete request.engine;
  }
  if (Object.hasOwn(value, 'runs_on')) {
    const target = { auto: 'auto', seed_pc: 'local', cloud: 'cloud' }[String(value.runs_on)] as
      'auto' | 'local' | 'cloud' | undefined;
    if (!target) add('runs_on', 'Choose auto, seed_pc or cloud.', 'Use one of the listed values.');
    else if (
      target === 'cloud' &&
      request.engine === 'klein' &&
      !context.cloudWorkflows?.includes('image-to-image:klein')
    )
      add(
        'runs_on',
        'Cloud GPUs here cannot run FLUX 3 Image Klein.',
        'Use seed_pc or auto for this edit, and say so.',
      );
    else if (target === 'auto') delete request.target;
    else request.target = target;
  }
  if (Object.hasOwn(value, 'steps')) request.steps = value.steps;
  if (Object.hasOwn(value, 'detail')) request.detail = value.detail;
  for (const [from, to] of [
    ['loras', 'loras'],
    ['prompt', 'prompt'],
    ['seed', 'seed'],
    ['batch_size', 'count'],
    ['note', 'note'],
    ['title', 'title'],
    ['mode', 'mode'],
  ])
    if (Object.hasOwn(value, from!)) request[to!] = value[from!];
  for (const [from, to] of [
    ['aspect_ratio', 'aspect'],
    ['duration_seconds', 'duration_seconds'],
  ])
    if (Object.hasOwn(value, from!)) request.output[to!] = value[from!];
  if (Object.hasOwn(value, 'audio_output')) request.audio = { ...(request.audio ?? {}), output: value.audio_output };
  // Shot details merge field by field, so an edit that names only the lens keeps the cast and number.
  if (Object.hasOwn(value, 'shot')) {
    try {
      const shot = normalizeShot({ ...(context.previous?.shot ?? {}), ...(value.shot ?? {}) });
      if (shot) request.shot = shot;
      else delete request.shot;
    } catch (error) {
      add('shot', (error as Error).message);
    }
  }
  // A kind that cannot take inputs must not carry input tokens: they would look like a reference that is never used.
  if (
    !usesInputs(context.workflow) &&
    typeof request.prompt === 'string' &&
    /\[\[[^\]]+\]\]|<(?:Picture|Video|Audio) \d+>/.test(request.prompt)
  )
    add(
      'prompt',
      'This kind of draft cannot use attached images, so an input token here would do nothing.',
      'Remove the token and describe the look in words, or choose the edit kind to use the image as its source.',
    );
  // Resolved output seeds belong to the source job, not a changed batch or starting seed.
  if (Object.hasOwn(value, 'seed') || Object.hasOwn(value, 'batch_size')) delete request.resolved_seeds;
  if (Object.hasOwn(value, 'inputs')) {
    if (!Array.isArray(value.inputs)) add('inputs', 'Provide an array of inputs.');
    else {
      const used = new Set<string>();
      request.references = value.inputs
        .map((input: any, index: number) => {
          const field = `inputs[${index}]`;
          if (!input || typeof input !== 'object' || Array.isArray(input)) {
            add(field, 'Provide an input object.');
            return null;
          }
          if (
            input.instance !== undefined &&
            (typeof input.instance !== 'string' || !/^[-\w]{1,100}$/.test(input.instance))
          )
            add(field + '.instance', 'Use a name of 1–100 letters, digits, underscores, or hyphens.');
          if (input.instance !== undefined && input.id !== undefined)
            add(
              field + '.instance',
              'Do not combine instance with id.',
              'Use id alone for an existing input; instance names a new input.',
            );
          // On creation an exact known source identity is unambiguous even if
          // the model placed it in id. Existing-request edits keep id semantics.
          if (
            !context.previous &&
            input.asset === undefined &&
            typeof input.id === 'string' &&
            context.assets.filter(a => a.handle === input.id || a.asset_id === input.id).length === 1
          ) {
            input = { ...input, asset: input.id };
            delete input.id;
          }
          let prior = input.id === undefined ? undefined : context.previous?.references?.find(r => r.id === input.id);
          if (input.id !== undefined && !prior)
            add(field + '.id', 'Unknown input id.', 'Copy an existing input id; omit id for a new input.');
          if (
            input.replace_asset !== undefined &&
            (!prior || input.asset !== undefined || input.instance !== undefined)
          ) {
            add(
              field + '.replace_asset',
              'Replacement needs an existing id and cannot be combined with asset or instance.',
              'Use {id: existing_id, replace_asset: new_asset_handle}.',
            );
            return null;
          }
          const source = input.replace_asset ?? input.asset;
          const candidates = context.assets.filter(a =>
            source !== undefined ? a.handle === source || a.asset_id === source : a.asset_id === prior?.asset_id,
          );
          const asset =
            source === undefined && prior
              ? (candidates.find(a => a.handle === prior?.id) ?? candidates[0])
              : candidates.length === 1
                ? candidates[0]
                : undefined;
          if (!asset) {
            add(
              field + '.asset',
              source === undefined && !prior ? 'Missing asset handle.' : 'Unknown or ambiguous asset handle.',
              `Copy a supplied asset handle: ${context.assets.map(a => a.handle).join(', ')}.`,
            );
            return null;
          }
          if (prior && input.asset !== undefined && asset.asset_id !== prior.asset_id) {
            add(
              field + '.asset',
              'This asset differs from the existing input source.',
              'To reorder, list existing ids in the new order, e.g. [{id: "input2"}, {id: "input1"}]. To replace a source deliberately, use id with replace_asset.',
            );
            return null;
          }
          if (!prior && input.id === undefined && input.instance === undefined && context.previous) {
            const matches = context.previous.references?.filter(r => r.asset_id === asset.asset_id) ?? [];
            if (matches.length > 1) {
              add(
                field + '.asset',
                'This source belongs to multiple existing inputs.',
                'Copy the id of the clip or role to keep; use a distinct instance name only to add another input.',
              );
              return null;
            }
            if (matches.length === 1) prior = matches[0];
          }
          const id = prior?.id ?? input.instance ?? asset.handle;
          if (!prior && context.previous?.references?.some(r => r.id === id))
            add(
              field + '.' + (input.instance === undefined ? 'asset' : 'instance'),
              'This name belongs to an existing input.',
              'Use its id to keep or edit that input, or give the new input a distinct instance name.',
            );
          if (used.has(id))
            add(
              field + '.asset',
              'This input handle is already used.',
              'Give each new input a distinct instance name, such as clipA and clipB.',
            );
          used.add(id);
          const ref: any = prior
            ? structuredClone(prior)
            : {
                id: /^[-\w]{1,100}$/.test(id) ? id : randomUUID(),
                asset_id: asset.asset_id,
                kind: asset.kind,
                role: context.workflow === 'image-to-image' && index === 0 ? 'source' : 'reference',
              };
          if (prior && asset.asset_id !== prior.asset_id) {
            ref.asset_id = asset.asset_id;
            ref.kind = asset.kind;
            delete ref.range;
            delete ref.include_audio;
            if (asset.kind !== 'image') delete ref.framing;
            ref.role = 'reference';
          }
          for (const key of ['role', 'framing', 'include_audio']) if (Object.hasOwn(input, key)) ref[key] = input[key];
          if (asset.kind === 'image') {
            for (const key of ['start_seconds', 'duration_seconds', 'include_audio'])
              if (Object.hasOwn(input, key)) add(field + '.' + key, 'This setting does not apply to an image.');
          } else {
            if (ref.role !== 'reference')
              add(
                field + '.role',
                `${asset.kind === 'video' ? 'Video' : 'Audio'} inputs must use role reference.`,
                'Only images can be first_frame or last_frame. General references may be combined with first/last image guides. Keep their roles explicit.',
              );
            if (Object.hasOwn(input, 'framing')) add(field + '.framing', 'Framing applies only to images.');
            if (asset.kind === 'audio' && Object.hasOwn(input, 'include_audio')) {
              if (input.include_audio !== true)
                add(
                  field + '.include_audio',
                  'A standalone audio input cannot have include_audio false.',
                  'Remove that input from the list to exclude it; omit include_audio to keep it.',
                );
              delete ref.include_audio;
            }
            ref.range = { ...(ref.range ?? {}) };
            for (const key of ['start_seconds', 'duration_seconds'])
              if (Object.hasOwn(input, key)) ref.range[key] = input[key];
            if (ref.range.start_seconds === undefined)
              add(field + '.start_seconds', 'Provide the input clip start time as a number.');
            if (ref.range.duration_seconds === undefined)
              add(field + '.duration_seconds', 'Provide the input clip duration, from 2 to 15 seconds.');
            if (
              Number.isFinite(asset.duration_seconds) &&
              Number.isFinite(ref.range.start_seconds) &&
              Number.isFinite(ref.range.duration_seconds) &&
              ref.range.start_seconds + ref.range.duration_seconds > asset.duration_seconds! + 0.001
            )
              add(
                field + '.duration_seconds',
                `The selected clip exceeds this source's ${asset.duration_seconds} second duration.`,
                'Shorten the clip or choose an earlier start.',
              );
          }
          return ref;
        })
        .filter(Boolean);
    }
  }
  const refs = request.references ?? [];
  if (!issues.length && typeof request.prompt === 'string') {
    try {
      if (context.compilePrompt) request.prompt = context.compilePrompt(request.prompt, refs, context.previous);
      else if (context.referenceMode === 'stable' && usesInputs(context.workflow) && Object.hasOwn(value, 'prompt')) {
        // The persisted source ID is also an unambiguous identity; normalize it
        // only when this request uses that source exactly once.
        request.prompt = request.prompt.replace(/\[\[([^\[\]]+)\]\]/g, (token: string, identity: string) => {
          const soundtrack = identity.endsWith(':audio'),
            key = soundtrack ? identity.slice(0, -6) : identity;
          if (refs.some((r: InputReference) => r.id === key)) return token;
          const matching = refs.filter((r: InputReference) => r.asset_id === key);
          return matching.length === 1 ? '[[' + matching[0].id + (soundtrack ? ':audio' : '') + ']]' : token;
        });
        request.prompt = compileStablePrompt(request.prompt, refs, context.assets);
      } else if (context.previous && value.prompt === undefined && value.inputs !== undefined) {
        const before = toolPromptBindings(context.previous.references ?? []),
          after = toolPromptBindings(refs),
          byLabel = new Map([...before].map(([id, label]) => [label, after.get(id)]));
        request.prompt = request.prompt.replace(toolPromptReferencePattern, (label: string) => {
          if (!byLabel.has(label) || !byLabel.get(label))
            throw new ToolRequestError([
              {
                field: 'prompt',
                message: `${label} no longer has the same input.`,
                fix: 'Update the prompt together with the changed inputs.',
              },
            ]);
          return byLabel.get(label)!;
        });
      }
    } catch (error) {
      if (error instanceof ToolRequestError) issues.push(...error.issues);
      else throw error;
    }
  }
  let validated: ImageRequest | undefined;
  try {
    validated = imageRequest(request);
  } catch (error) {
    const validation =
      error instanceof VideoRequestError
        ? error.issues
        : [{ field: 'request', message: error instanceof Error ? error.message : String(error) }];
    for (const issue of validation) {
      const field = issue.field
        .replace(/^references/, 'inputs')
        .replace('.range.', '.')
        .replace(/\.asset_id$/, '.asset')
        .replace(/^output\.aspect$/, 'aspect_ratio')
        .replace(/^output\.size$/, 'size')
        .replace(/^output\.duration_seconds$/, 'duration_seconds')
        .replace(/^output\.format$/, 'output_format')
        .replace(/^audio\.output$/, 'audio_output')
        .replace(/^count$/, 'batch_size');
      if (
        !issues.some(i => i.field === field) &&
        !((field === 'prompt' || field === 'inputs') && issues.some(i => i.field.startsWith('inputs[')))
      ) {
        const mapping =
          field === 'prompt' ? [...toolInputLabels(refs)].map(([id, label]) => `${label} = ${id}`).join('; ') : '';
        issues.push({
          ...issue,
          field,
          ...(field === 'prompt'
            ? {
                fix: mapping
                  ? 'Valid prompt labels for these inputs: ' + mapping + '.'
                  : 'These inputs have no numbered prompt labels. Describe frame guides without a numbered label.',
              }
            : {}),
        });
      }
    }
  }
  if (issues.length) throw new ToolRequestError(issues);
  return validated!;
}
/** A draft that was not saved: the first problem as its error, and each field's problem when there are several. */
export function requestToolResultError(error: unknown, operation: 'create' | 'edit'): ToolFailureResult {
  const fields = error instanceof ToolRequestError || error instanceof VideoRequestError ? error.issues : undefined;
  return {
    ok: false,
    saved: false,
    error: fields?.[0]?.message ?? (error instanceof Error ? error.message : String(error)),
    ...(fields ? { fields } : {}),
    ...(error instanceof ToolFailure && error.internal ? { internal: true as const } : {}),
    next_action:
      operation === 'create'
        ? 'Correct these fields and retry create_request. No request was created.'
        : 'Correct these fields and retry edit_request. The request is unchanged.',
  };
}
