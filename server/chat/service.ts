import { videoDetail, videoSteps } from '../../shared/video-settings.js';
import { bindChatMentions, agentMentionContext } from './mentions.js';

import { loraRoute, isVideoWorkflow } from '../../shared/workflows.js';
import type { MentionBinding } from '../../shared/chat-mentions.js';
import { createReadInputTool } from './read-input.js';
import {
  requestToolSchemas,
  prepareToolRequest,
  requestToolRules,
  requestToolResultError,
  toolInputLabels,
  toolPromptBindings,
  toolPromptReferencePattern,
  type ToolAsset,
} from './request-tools.js';
import { visualContext } from './visual-context.js';
import { recordTurnEvent, finishTurn } from './transcript.js';
import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Agent, AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import type { ChatView, ChatMode, ChatWorkflow, ChatGroup, ChatCard, ChatRevision } from '../../shared/chat.js';
import type { StudioPaths } from '../storage.js';
import { imageRequest, seeds, type ImageRequest } from '../workflows.js';
import type { Jobs } from '../jobs.js';
import { createChatAgent, type ChatAccounting } from './provider.js';
import { chatCredential } from './credentials.js';
import { chatPromptSnapshot, chatWorkflows, chatTitlePrompt } from './prompts.js';
import {
  chatReferenceLabels,
  preserveChatLabels,
  validateChatReferences,
  validateCastReferences,
  withCastLooks,
} from './references.js';
import { compactConversation, settingsOnlyMessage, type ConversationSummary } from './context.js';
import { castFromBrief, castOf, mergeCast, briefWithCast, referenceKey, sameCast, type CastEntry } from '../../shared/cast.js';
import { shotsFromBrief, shotPickKey, shotNameKey, shotFromTitle } from '../../shared/shots.js';

/** Agent snapshots mirror the flat tool fields; canonical requests remain persisted unchanged. */
function agentRequest(request: ImageRequest, assets: ToolAsset[] = []) {
  const bindings = new Map(
    [...toolPromptBindings(request.references ?? [])].map(([id, label]) => [label, '[[' + id + ']]']),
  );
  const prompt =
    referenceMode() === 'stable'
      ? request.prompt.replace(toolPromptReferencePattern, label => bindings.get(label) ?? label)
      : request.prompt;
  return {
    prompt,
    batch_size: request.count,
    seed: request.seed,
    aspect_ratio: request.output.aspect,
    loras: request.loras ?? [],
    ...(request.title ? { title: request.title } : {}),
    ...(request.note ? { note: request.note } : {}),
    ...(request.mode === 'nsfw' ? { mode: request.mode } : {}),
    ...(isVideoWorkflow(request.workflow)
      ? {
          duration_seconds: request.output.duration_seconds,
          audio_output: request.audio?.output,
          steps: videoSteps(request),
          detail: videoDetail(request),
        }
      : {}),
    ...(request.references
      ? {
          inputs: request.references.map(ref => ({
            id: ref.id,
            asset: assets.find(a => a.asset_id === ref.asset_id)?.handle ?? ref.asset_id,
            role: ref.role,
            ...(ref.framing ? { framing: ref.framing } : {}),
            ...(ref.range ?? {}),
            ...(ref.kind === 'video' ? { include_audio: Boolean(ref.include_audio) } : {}),
          })),
        }
      : {}),
  };
}
/** How the agent refers to inputs in prompts. Read in one place (tests switch it per case). */
function referenceMode(): 'stable' | 'direct' {
  return process.env.SEED_AGENT_REFERENCE_MODE === 'direct' ? 'direct' : 'stable';
}
/**
 * The reply a person sees. The agent's final message (after its last tool call) is its answer, written knowing what
 * the tools actually did, so a substantial one stands alone: text written before the tools ran can describe drafts
 * that turned out differently. When the final message is only a short closing line ("The drafts are ready"), the
 * explanation written earlier in the turn is kept in front of it. Model control tokens are removed, and a part that
 * mostly repeats another is kept once.
 */
function replyText(steps: Array<{ kind: string; text?: string }>) {
  const clean = (t: string) =>
    t
      .replace(/<\|?\/?[a-z_]+\|?>/gi, '')
      .replace(/^\s*thought\s*$/gim, '')
      .trim();
  const texts = (from: number) =>
    steps
      .slice(from)
      .filter(s => s.kind === 'text')
      .map(s => clean(s.text ?? ''))
      .filter(Boolean);
  const lastTool = steps.map(s => s.kind).lastIndexOf('tool');
  const final = lastTool >= 0 ? texts(lastTool + 1).join('\n\n') : '';
  const parts = final.length >= 160 ? [final] : texts(0);
  // The model often restates its summary after the tools ran. A part that mostly repeats another (same words, a few
  // changed) is kept once, in its longer form, at the place it first appeared.
  const words = (t: string) => new Set(t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const kept: string[] = [];
  for (const part of parts) {
    const w = words(part);
    const twin = kept.findIndex(k => {
      const kw = words(k);
      const shared = [...w].filter(x => kw.has(x)).length;
      return shared / Math.max(1, Math.min(w.size, kw.size)) >= 0.8;
    });
    if (twin < 0) kept.push(part);
    else if (part.length > kept[twin]!.length) kept[twin] = part;
  }
  return kept.join('\n\n');
}
interface StoredChat extends ChatView {
  title_manual?: boolean;
  title_accounting?: ChatAccounting[];
  title_error?: string;
  summary?: ConversationSummary;
  runs: Array<{
    id: string;
    workflow?: ChatWorkflow | null;
    source_assets?: string[];
    target_request_id?: string;
    prompt: ReturnType<typeof chatPromptSnapshot>;
    accounting: ChatAccounting[];
    messages: AgentMessage[];
    state: string;
    summary?: ConversationSummary;
  }>;
}
const terminal = ['completed', 'failed', 'cancelled'];
const latest = (card: ChatCard) => card.revisions.at(-1)!;
/** User-facing kinds of work and the workflow each one runs. */
const chatKinds = {
  image: 'text-to-image',
  edit: 'image-to-image',
  video: 'text-to-video',
  animate: 'reference-to-video',
} as const satisfies Record<string, ChatWorkflow>;
const openGroup = (chat: ChatView) => chat.groups.find(g => !['released', 'stopped'].includes(g.state));
const now = () => new Date().toISOString();

export class Chats {
  private listeners = new Map<string, Set<(value: unknown) => void>>();
  subscribe(id: string, listener: (value: unknown) => void) {
    this.get(id);
    let group = this.listeners.get(id);
    if (!group) {
      group = new Set();
      this.listeners.set(id, group);
    }
    group.add(listener);
    return () => {
      group!.delete(listener);
      if (!group!.size) this.listeners.delete(id);
    };
  }
  private agents = new Map<string, Agent>();
  private tasks = new Map<string, Promise<void>>();
  private preparing = new Set<string>();
  private titles = new Map<string, { agent: Agent; task: Promise<void> }>();
  constructor(
    private db: Database.Database,
    private paths: StudioPaths,
    private jobs: Jobs,
    private transport?: typeof fetch,
  ) {
    for (const row of db.prepare('SELECT body_json FROM chats').all() as { body_json: string }[]) {
      const chat = JSON.parse(row.body_json) as StoredChat;
      let changed = false;
      for (const card of chat.groups.flatMap(g => g.cards))
        for (const revision of card.revisions)
          for (const id of revision.job_ids) {
            const job = jobs.get(id);
            if (job && !job.source) {
              job.source = { chat_id: chat.id, card_id: card.id, revision: revision.number };
              db.prepare('UPDATE jobs SET snapshot_json=? WHERE id=?').run(JSON.stringify(job), id);
            }
          }
      if (chat.groups.some(g => g.after_message_id === undefined)) {
        for (const group of chat.groups)
          if (group.after_message_id === undefined) group.after_message_id = chat.messages.at(-1)?.id ?? null;
        changed = true;
      }
      for (const group of chat.groups) {
        if (
          group.state !== 'reviewing' ||
          !group.cards.length ||
          group.cards.some(c => latest(c).decision === 'undecided' || latest(c).job_ids.length)
        )
          continue;
        if (group.cards.some(c => latest(c).decision === 'approved')) {
          if (!group.submission_error) {
            group.submission_error =
              chat.activity === 'preparing'
                ? 'Preparation was interrupted by server restart. Retry to continue.'
                : 'These approved requests did not start. Retry to continue.';
            changed = true;
          }
        } else {
          group.state = 'released';
          delete group.submission_error;
          changed = true;
        }
      }
      if (chat.activity === 'thinking' || chat.activity === 'preparing') {
        if (chat.activity === 'thinking') chat.error = 'Interrupted by server restart. Send a message to continue.';
        chat.activity = 'idle';
        changed = true;
        for (const run of chat.runs) if (run.state === 'running') run.state = 'interrupted';
        for (const message of chat.messages)
          if (message.transcript?.state === 'running') {
            finishTurn(message.transcript, 'failed');
            message.transcript.error = 'Interrupted by server restart.';
          }
      }
      if (changed) this.save(chat);
    }
  }
  private save(chat: StoredChat) {
    chat.updated_at = now();
    this.db
      .prepare('INSERT INTO chats VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body_json=excluded.body_json')
      .run(chat.id, chat.mode, JSON.stringify(chat));
    for (const listener of this.listeners.get(chat.id) ?? []) {
      try {
        listener({
          version: chat.version,
          partial: chat.partial ?? '',
          partial_reasoning: chat.partial_reasoning ?? '',
          activity: chat.activity,
          error: chat.error,
          stream_message: [...chat.messages].reverse().find(m => m.transcript),
        });
      } catch {
        this.listeners.get(chat.id)?.delete(listener); /* A disconnected observer cannot undo a committed save. */
      }
    }
  }
  private get(id: string): StoredChat {
    const row = this.db.prepare('SELECT body_json FROM chats WHERE id=?').get(id) as { body_json: string } | undefined;
    if (!row) throw Error('Chat not found.');
    return JSON.parse(row.body_json);
  }
  private event(chat: StoredChat, text: string) {
    chat.messages.push({ id: randomUUID(), role: 'event', text, assets: [], created_at: now() });
  }
  private jobIds(chat: ChatView) {
    return [...new Set(chat.groups.flatMap(g => g.cards.flatMap(c => c.revisions.flatMap(r => r.job_ids))))];
  }
  private activeJobs(chat: ChatView) {
    return this.jobIds(chat)
      .map(id => this.jobs.get(id))
      .filter(job => job && !terminal.includes(job.state));
  }
  private generating(chat: ChatView) {
    return this.activeJobs(chat).some(
      job =>
        !['needs_attention', 'blocked'].includes(job!.state) &&
        !job!.recovery_blocked &&
        !this.db.prepare('SELECT id FROM job_cancel_intents WHERE id=?').get(job!.id),
    );
  }
  private busy(chat: ChatView) {
    return this.agentBusy(chat) || this.generating(chat);
  }
  /** Rendering results never blocks the conversation; only an agent turn or plan preparation does. */
  private agentBusy(chat: ChatView) {
    return this.tasks.has(chat.id) || this.preparing.has(chat.id);
  }
  private checkVersion(chat: ChatView, version: number) {
    if (chat.version !== version) throw Error('Chat changed in another tab. Refresh and send again.');
  }
  view(id: string) {
    const chat = this.get(id);
    const { runs, ...view } = chat;
    view.activity = this.tasks.has(id)
      ? 'thinking'
      : this.preparing.has(id)
        ? 'preparing'
        : this.generating(chat)
          ? 'generating'
          : 'idle';
    for (const job of this.jobIds(chat).map(id => this.jobs.get(id)))
      for (const asset of job?.outputs ?? []) if (!chat.assets.includes(asset)) chat.assets.push(asset);
    return {
      ...view,
      cast: castOf(chat),
      asset_manifest: this.contextAssets(chat),
      jobs: this.jobIds(chat)
        .map(id => this.jobs.get(id))
        .filter(Boolean)
        .map(job => this.jobs.publicJob(job!)),
      accounting: [...runs.flatMap(run => run.accounting), ...(chat.title_accounting ?? [])],
    };
  }
  list(mode: ChatMode) {
    return (this.db.prepare('SELECT id FROM chats WHERE mode=?').all(mode) as { id: string }[])
      .map(row => {
        const c = this.view(row.id);
        return {
          id: c.id,
          title: c.title,
          last_reply_id: c.messages.filter(m => m.role === 'assistant').at(-1)?.id ?? '',
          activity: c.activity,
          ready_to_review: c.activity === 'idle' && c.groups.some(g => g.state === 'reviewing' && g.cards.length > 0),
          error:
            c.error ??
            c.groups.find(g => g.state === 'reviewing' && g.submission_error)?.submission_error ??
            c.jobs.find(j => j?.state === 'failed')?.error,
          status: c.jobs.some(j => j?.state === 'failed')
            ? 'Failed'
            : c.jobs.length && c.jobs.every(j => j && terminal.includes(j.state))
              ? 'Completed'
              : '',
          updated_at: c.updated_at,
        };
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  create(mode: ChatMode) {
    const id = randomUUID();
    this.save({
      id,
      mode,
      title: 'New chat',
      workflow: null,
      version: 0,
      epoch: 0,
      reasoning: false,
      messages: [],
      groups: [],
      assets: [],
      runs: [],
      activity: 'idle',
      error: null,
      created_at: now(),
      updated_at: now(),
    });
    return this.view(id);
  }
  settings(
    id: string,
    version: number,
    values: { title?: string; workflow?: ChatWorkflow | null; reasoning?: boolean; brief?: string; frame?: string },
  ) {
    const chat = this.get(id);
    this.checkVersion(chat, version);
    if (this.agentBusy(chat)) throw Error('Wait for Seed to finish before changing chat settings.');
    if (values.title !== undefined) {
      if (!values.title.trim() || values.title.length > 120) throw Error('Choose a title of 1–120 characters.');
      chat.title = values.title.trim();
      chat.title_manual = true;
    }
    if (values.workflow !== undefined) {
      if (values.workflow !== null && !Object.hasOwn(chatWorkflows, values.workflow)) throw Error('Unknown workflow.');
      chat.workflow = values.workflow;
    }
    if (values.reasoning !== undefined) chat.reasoning = values.reasoning;
    if (values.brief !== undefined) {
      if (values.brief.length > 8000) throw Error('Keep the brief under 8000 characters.');
      const text = values.brief.trim();
      // The owner's own edit: a name deleted from the brief altogether leaves the cast; a reworded line never does.
      chat.cast = mergeCast(castOf(chat), text).filter(e => {
        const first = e.name.replace(/^(the|dr|mr|mrs|ms|prof|capt|captain)\.?\s+/i, '').split(' ')[0]!;
        return text.toLowerCase().includes(first.toLowerCase());
      });
      chat.brief = text;
      chat.brief_updated_by = 'you';
      chat.brief_updated_at = now();
    }
    if (values.frame !== undefined) {
      if (values.frame && !/^\d{1,2}(\.\d{1,2})?:\d{1,2}(\.\d{1,2})?$/.test(values.frame))
        throw Error('Choose a frame shape such as 2.39:1.');
      if (values.frame) chat.frame = values.frame;
      else delete chat.frame;
    }
    chat.version++;
    this.save(chat);
    return this.view(id);
  }
  /**
   * Choose (or clear) the take used for a shot ("<shot>:image" or "<shot>:clip"), or the approved reference image of a
   * character or place in the brief ("ref:<Name>"). Not an agent setting: allowed while Seed replies, no version check.
   */
  pick(id: string, key: string, asset: string | null) {
    const chat = this.get(id);
    // "Not needed" for a cast entry: no picture, it just stops asking for one.
    if (/^skip:[^\n]{1,60}$/.test(key)) {
      const picks = { ...(chat.picks ?? {}) };
      if (asset) picks[key] = 'skip';
      else delete picks[key];
      chat.picks = picks;
      chat.version++;
      this.save(chat);
      return this.view(id);
    }
    if (!/^(?:.{1,130}:(image|clip)|ref:[^\n]{1,60})$/.test(key)) throw Error('Choose a shot.');
    if (key.startsWith('ref:') && asset && this.jobs.media.get(asset)?.kind !== 'image')
      throw Error('A reference must be an image.');
    const picks = { ...(chat.picks ?? {}) };
    if (asset) {
      const known =
        this.jobIds(chat).some(j => this.jobs.get(j)?.outputs.includes(asset)) || chat.assets.includes(asset);
      // A reference can come from another project (a new project with the same brief): it is attached here.
      if (!known && key.startsWith('ref:') && this.jobs.media.get(asset)?.kind === 'image') {
        this.assertAssets(chat, [asset], false);
        chat.assets = [...chat.assets, asset];
      } else if (!known) throw Error('Choose a result from this project.');
      picks[key] = asset;
    } else delete picks[key];
    chat.picks = picks;
    chat.version++;
    this.save(chat);
    return this.view(id);
  }
  /**
   * Adds, changes or removes one character, place or prop. A rename carries its approved picture (or Not needed) with
   * it; the brief's cast sections are rewritten to match. Not an agent setting: allowed while Seed replies.
   */
  editCast(id: string, from: string | null, entry: CastEntry | null) {
    const chat = this.get(id);
    const cast = castOf(chat).map(e => ({ ...e }));
    const at = from ? cast.findIndex(e => e.name.toLowerCase() === from.toLowerCase()) : -1;
    if (from && at < 0) throw Error('That name is not in the cast.');
    if (entry) {
      entry = { kind: entry.kind, name: entry.name.replace(/\s+/g, ' ').trim(), look: entry.look.replace(/\s+/g, ' ').trim() };
      if (!['character', 'place', 'prop'].includes(entry.kind)) throw Error('Choose character, place or prop.');
      if (!/^\p{L}/u.test(entry.name) || entry.name.length > 60) throw Error('Give a name of up to 60 characters.');
      if (entry.look.length > 600) throw Error('Keep the look under 600 characters.');
      if (cast.some((e, i) => i !== at && e.name.toLowerCase() === entry!.name.toLowerCase()))
        throw Error(`${entry.name} is already in the cast.`);
    }
    const removed: string[] = [],
      renames: Record<string, string> = {};
    if (at >= 0) {
      const old = cast[at]!;
      if (!entry) removed.push(old.name);
      else if (old.name !== entry.name) renames[old.name] = entry.name;
      if (entry && old.name !== entry.name) {
        const picks = { ...(chat.picks ?? {}) };
        for (const k of [referenceKey(old.name), 'skip:' + old.name])
          if (picks[k] !== undefined) {
            picks[k.startsWith('ref:') ? referenceKey(entry.name) : 'skip:' + entry.name] = picks[k]!;
            delete picks[k];
          }
        chat.picks = picks;
      }
      if (entry) cast[at] = entry;
      else cast.splice(at, 1);
    } else if (entry) cast.push(entry);
    else throw Error('Nothing to change.');
    chat.cast = cast;
    chat.brief = briefWithCast(chat.brief, cast, removed, renames);
    chat.brief_updated_by = 'you';
    chat.brief_updated_at = now();
    chat.version++;
    this.save(chat);
    return this.view(id);
  }
  delete(id: string) {
    const chat = this.get(id);
    if (this.busy(chat)) throw Error('Stop generation before deleting this chat, then try again.');
    if (this.activeJobs(chat).length)
      throw Error(
        'Remote cancellation or output saving is still pending. Check the worker status and try deletion after it settles.',
      );
    this.titles.get(id)?.agent.abort();
    this.db.prepare('DELETE FROM chats WHERE id=?').run(id);
  }
  /** scope 'reply' stops only the agent's turn: running results continue and an open plan stays open. */
  stop(id: string, scope: 'chat' | 'reply' = 'chat') {
    this.titles.get(id)?.agent.abort();
    const chat = this.get(id);
    chat.epoch++;
    chat.version++;
    chat.activity = 'idle';
    for (const run of chat.runs) if (run.state === 'running') run.state = 'stopped';
    for (const message of chat.messages)
      if (message.transcript?.state === 'running') finishTurn(message.transcript, 'stopped');
    for (const group of chat.groups)
      if (group.state !== 'released')
        group.state = scope === 'reply' && group.state !== 'stopped' && group.cards.length ? 'reviewing' : 'stopped';
    this.db.transaction(() => {
      if (scope === 'chat') this.jobs.stopJobs(this.jobIds(chat));
      this.save(chat);
    })();
    this.agents.get(id)?.abort();
    return this.view(id);
  }
  private assertAssets(chat: StoredChat, ids: string[], allowExisting = true) {
    if (ids.length > 24 || new Set(ids).size !== ids.length) throw Error('Choose up to 24 distinct assets.');
    for (const id of ids) {
      const asset = this.jobs.media.get(id);
      if (!asset || (asset.metadata.state ?? 'ready') !== 'ready')
        throw Error('An attached asset is missing or still uploading.');
      const row = this.db
        .prepare(
          `SELECT COALESCE(json_extract(metadata_json,'$.mode'),(SELECT json_extract(snapshot_json,'$.request.mode') FROM jobs WHERE jobs.id=json_extract(assets.metadata_json,'$.job_id')),'sfw') mode FROM assets WHERE id=?`,
        )
        .get(id) as { mode: string };
      if (!(allowExisting && chat.assets.includes(id)) && row.mode !== chat.mode)
        throw Error('Choose assets available in this chat.');
    }
  }
  private contextAssets(chat: StoredChat) {
    return chat.assets.map(id => {
      const asset = this.jobs.media.get(id);
      const own = this.db.prepare('SELECT note FROM asset_notes WHERE id=?').get(id) as { note: string } | undefined;
      const inherited = this.db
        .prepare('SELECT n.note FROM sequence_frames f JOIN asset_notes n ON n.id=f.sequence_id WHERE f.asset_id=?')
        .get(id) as { note: string } | undefined;
      // A generated result is named by the draft that made it and its take, so Seed can tell "Shot 2 · take 1" from "Shot 1".
      const job = typeof asset?.metadata?.job_id === 'string' ? this.jobs.get(asset.metadata.job_id) : undefined;
      // A shot renumbered in the brief is named by its current number ("Shot 6: First Light", not "Shot 5: …").
      const renumbered = (t: string) => {
        const own = shotFromTitle(t);
        if (own.n === null) return t;
        const listed = shotsFromBrief(chat.brief).find(s => shotNameKey(s.name) === shotNameKey(own.name));
        return listed && listed.n !== own.n ? t.replace(/^shot\s*\d+/i, 'Shot ' + listed.n) : t;
      };
      const title = job?.request.title
        ? `${renumbered(job.request.title)}${(job.request.count ?? 1) > 1 ? ` · take ${(job.submission_index ?? 0) + 1} of ${job.request.count}` : ''}`
        : undefined;
      const shotLabel = (k: string) => {
        const m = k.match(/^shot:(.+):(?:image|clip)$/);
        if (!m) return 'Shot ' + k.split(':')[0];
        const listed = shotsFromBrief(chat.brief).find(s => shotNameKey(s.name) === m[1]);
        return listed ? `Shot ${listed.n}: ${listed.name}` : `the shot “${m[1]}”`;
      };
      const chosen = Object.entries(chat.picks ?? {})
        .filter(([, a]) => a === id)
        .map(([k]) =>
          k.startsWith('ref:')
            ? `approved reference for ${k.slice(4)}`
            : `chosen ${k.endsWith(':clip') ? 'clip' : 'keyframe'} for ${shotLabel(k)}`,
        );
      return {
        id,
        name: title ?? asset?.name ?? 'Missing media',
        ...(chosen.length ? { chosen_for: chosen.join(', ') } : {}),
        kind: asset?.kind,
        metadata: asset?.metadata,
        note: own?.note || inherited?.note || '',
      };
    });
  }
  private request(chat: StoredChat, workflow: ChatWorkflow, raw: unknown, previous?: ImageRequest): ImageRequest {
    const value = raw as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Provide request settings.');
    if (chat.mode === 'sfw' && Object.hasOwn(value, 'mode')) throw Error('This request cannot supply a mode field.');
    let request: ImageRequest;
    request = imageRequest({ ...value, workflow, mode: chat.mode === 'sfw' ? 'sfw' : (value.mode ?? 'nsfw') });
    if (previous) {
      request = preserveChatLabels(previous, request);
      if (value.note === undefined && previous.note) request.note = previous.note;
    }
    validateChatReferences(request);
    if (request.workflow !== 'image-to-image') this.jobs.loras.resolve(request.loras, loraRoute(request), request.mode);
    for (const ref of request.references ?? [])
      if (!chat.assets.includes(ref.asset_id)) throw Error('Reference must be provided in this conversation.');
    this.assertAssets(chat, [...new Set((request.references ?? []).map(r => r.asset_id))]);
    return request;
  }
  private revision(chat: StoredChat, request: ImageRequest, number: number, sourceJobId?: string): ChatRevision {
    const notes = Object.fromEntries(
      this.contextAssets(chat)
        .filter(a => request.references?.some(r => r.asset_id === a.id))
        .map(a => [a.id, a.note]),
    );
    return {
      number,
      request,
      notes,
      decision: 'undecided',
      job_ids: [],
      ...(sourceJobId ? { source_job_id: sourceJobId } : {}),
      after_message_id: chat.messages.at(-1)?.id ?? null,
    };
  }
  private workflowTools(
    id: string,
    epoch: number,
    workflow: ChatWorkflow,
    runId: string,
    assets: ToolAsset[],
    target?: string,
  ): AgentTool[] {
    const initial = this.get(id),
      snapshots = new Map(initial.groups.flatMap(g => g.cards).map(c => [c.id, latest(c).number]));
    const schemas = requestToolSchemas(
      workflow,
      initial.mode,
      this.jobs.loras
        .list(initial.mode)
        .filter(l => l.source_status === 'ready')
        .some(l =>
          workflow === 'text-to-image'
            ? l.route === 'image'
            : workflow === 'text-to-video'
              ? l.route === 'fl'
              : l.route !== 'image',
        ),
    );
    const mode = referenceMode();
    const leaveOut: AgentTool = {
      name: 'leave_out_request',
      label: 'Leave out request',
      description:
        'Leave a draft out of the open plan (left_out true), or put it back (left_out false). Use it whenever the user narrows the plan, drops a direction or asks for fewer drafts, so the plan matches what you say. The draft stays visible to the user, unselected, and is not deleted. Copy request_id from the current review.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { request_id: { type: 'string' }, left_out: { type: 'boolean' } },
        required: ['request_id', 'left_out'],
      } as any,
      execute: async (_call, raw) => {
        const current = this.get(id);
        if (current.epoch !== epoch) throw Error('This run is no longer active.');
        const value = raw as { request_id?: unknown; left_out?: unknown },
          group = openGroup(current),
          card = group?.cards.find(c => c.id === String(value.request_id));
        if (!card)
          throw Error(
            JSON.stringify({ ok: false, error: 'Request not found. Use a request_id listed in the current review.' }),
          );
        // A plan always keeps at least one selected draft: leaving out every draft would leave "Make 0 images" while the
        // reply says the plan is ready. To drop the whole plan, the user sets it aside.
        if (value.left_out !== false && !card.left_out && group!.cards.filter(c => !c.left_out).length <= 1)
          throw Error(
            JSON.stringify({
              ok: false,
              error:
                'This is the last selected draft, so it stays in. To change it, edit it; if the user wants no drafts at all, tell them to set the plan aside.',
            }),
          );
        if (value.left_out === false) delete card.left_out;
        else card.left_out = true;
        const kept = group!.cards.filter(c => !c.left_out).length;
        this.save(current);
        const result = {
          ok: true,
          request_id: card.id,
          left_out: Boolean(card.left_out),
          drafts_selected: kept,
          drafts_left_out: group!.cards.length - kept,
          next_action: 'Describe the plan by the drafts still selected.',
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
      },
    };
    // The order of drafts in the plan is the order of the film or book: the agent can set it.
    const orderTool: AgentTool = {
      name: 'order_requests',
      label: 'Order drafts',
      description:
        'Put the drafts of the open plan in a new order (for example story or page order). Send every request_id of the current review once, in the new order.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { request_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 16 } },
        required: ['request_ids'],
      } as any,
      execute: async (_call, raw) => {
        const current = this.get(id);
        if (current.epoch !== epoch) throw Error('This run is no longer active.');
        const group = openGroup(current);
        const ids = ((raw as { request_ids?: unknown }).request_ids ?? []) as unknown[];
        const cards = group?.cards ?? [];
        if (
          !group ||
          ids.length !== cards.length ||
          new Set(ids).size !== ids.length ||
          ids.some(x => !cards.some(c => c.id === x))
        )
          throw Error(
            JSON.stringify({
              ok: false,
              error: 'Send every request_id of the current review exactly once, in the new order.',
            }),
          );
        group.cards = ids.map(x => cards.find(c => c.id === x)!);
        this.save(current);
        const result = {
          ok: true,
          order: group.cards.map(c => latest(c).request.title ?? c.id),
          next_action: 'Say the new order in one short sentence.',
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
      },
    };
    // The owner's choice of take for a shot, made by Seed when the owner asks in words ("use take 2 for shot 2").
    // Who-is-who mix-ups already refused in this turn: never refused twice, so a turn cannot loop on them.
    const castWarned = new Set<string>();
    const chooseTake: AgentTool = {
      name: 'choose_take',
      label: 'Choose take',
      description:
        'Mark a made result as the chosen take for a numbered shot, when the user asks (for example "use take 2 for shot 2"). Give the shot number and the input handle of the result (an image is the chosen keyframe, a video the chosen clip). Use it once per shot the user names.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { shot: { type: 'string', maxLength: 8 }, input: { type: 'string', maxLength: 20 } },
        required: ['shot', 'input'],
      } as any,
      execute: async (_call, raw) => {
        const current = this.get(id);
        if (current.epoch !== epoch) throw Error('This run is no longer active.');
        const value = raw as { shot?: unknown; input?: unknown };
        const shot = String(value.shot ?? '')
          .replace(/^shot\s*/i, '')
          .trim();
        const asset = assets.find(
          a =>
            a.handle ===
            String(value.input ?? '')
              .replace(/[[\]]/g, '')
              .trim(),
        );
        if (!/^\d{1,3}$/.test(shot) || !asset || (asset.kind !== 'image' && asset.kind !== 'video'))
          throw Error(
            JSON.stringify({ ok: false, error: 'Give a shot number and the input handle of a made image or clip.' }),
          );
        // The choice is stored by the shot's name (from the brief's shot list, else the result's own title), so it
        // follows the shot when shots are renumbered.
        const named =
          shotsFromBrief(current.brief).find(s => s.n === Number(shot))?.name ??
          (() => {
            const meta = this.jobs.media.get(asset.asset_id)?.metadata as { job_id?: unknown } | undefined;
            const job = typeof meta?.job_id === 'string' ? this.jobs.get(meta.job_id) : undefined;
            const own = job?.request.title ? shotFromTitle(job.request.title) : undefined;
            return own && own.n === Number(shot) ? own.name : '';
          })();
        const view = this.pick(
          id,
          shotPickKey(Number(shot), named, asset.kind === 'video' ? 'clip' : 'image'),
          asset.asset_id,
        );
        const result = {
          ok: true,
          shot,
          chosen: asset.kind === 'video' ? 'clip' : 'keyframe',
          picks: Object.keys(view.picks ?? {}),
          next_action: 'Say in one short sentence which take is now chosen for the shot.',
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
      },
    };
    // The owner's approval of a reference image for a character, place or prop of the brief, when they ask in words.
    const approveReference: AgentTool = {
      name: 'approve_reference',
      label: 'Approve reference',
      description:
        'Approve a made image as the reference for a character, place or prop listed in cast_and_places, when the user asks (for example "approve take 3 as Ines\'s reference"). Give the name exactly as cast_and_places lists it and the input handle of the image. Shots that include that name are then drafted from it. Use it once per name.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { name: { type: 'string', maxLength: 60 }, input: { type: 'string', maxLength: 20 } },
        required: ['name', 'input'],
      } as any,
      execute: async (_call, raw) => {
        const current = this.get(id);
        if (current.epoch !== epoch) throw Error('This run is no longer active.');
        const value = raw as { name?: unknown; input?: unknown };
        const wanted = String(value.name ?? '')
          .trim()
          .toLowerCase();
        const entry = castOf(current).find(e => e.name.toLowerCase() === wanted);
        const asset = assets.find(
          a =>
            a.handle ===
            String(value.input ?? '')
              .replace(/[[\]]/g, '')
              .trim(),
        );
        if (!entry)
          throw Error(
            JSON.stringify({
              ok: false,
              error: 'That name is not in cast_and_places. Add it to the brief first (update_brief), then approve.',
              names: castOf(current).map(e => e.name),
            }),
          );
        if (!asset || asset.kind !== 'image')
          throw Error(JSON.stringify({ ok: false, error: 'Give the input handle of a made image.' }));
        this.pick(id, referenceKey(entry.name), asset.asset_id);
        const result = {
          ok: true,
          name: entry.name,
          approved: true,
          next_action: 'Say in one short sentence that this image is now the approved reference for the name.',
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
      },
    };
    return [
      ...(['create', 'edit'] as const).map((operation): AgentTool => ({
        name: operation + '_request',
        label: operation === 'create' ? 'Create request' : 'Edit request',
        description:
          operation === 'create'
            ? 'Prepare one new request for user review. Does not generate media.'
            : 'Change an existing request. Copy request_id from context. Send only changed fields; all omitted fields stay unchanged.',
        parameters: schemas[operation],
        execute: async (_call, raw) => {
          try {
            const current = this.get(id);
            if (current.epoch !== epoch) throw Error('This run is no longer active.');
            // choose_kind earlier in this step switched the kind of work: the draft is saved as that kind (its
            // fields are checked again for it), so the agent never reports drafts that were silently dropped.
            const kind: ChatWorkflow = current.workflow ?? workflow;
            // A plan can hold several kinds of work (keyframes, their edits and their animations); each draft has its own.
            let group = openGroup(current);
            const value = raw as Record<string, unknown>;
            const editId = operation === 'edit' ? String(value.request_id) : target;
            const card = editId ? group?.cards.find(c => c.id === editId) : undefined;
            if (editId && !card)
              throw Error(
                'Request not found. Use a request_id listed in current review. A failed create has no request_id.',
              );
            if (card && snapshots.get(card.id) !== latest(card).number)
              throw Error(
                'Request changed after this agent started. Read the current request before editing; no changes were saved.',
              );
            // Editing a draft with another kind's tools changes its kind in place (a shot becomes an edit of a
            // reference, or its animation): it starts from that kind's defaults and keeps its title and prompt.
            const changesKind = Boolean(card && card.workflow !== kind);
            // A clip draft never turns back into a picture: the user's clip plan would be lost without a word.
            if (changesKind && /video/.test(card!.workflow) && !/video/.test(kind))
              throw Error(
                JSON.stringify({
                  ok: false,
                  error:
                    'This draft is a clip. A picture is a new draft: use create_request for it, and leave the clip draft as it is unless the user asks to remove it.',
                }),
              );
            const prior = card ? latest(card).request : undefined;
            const request = prepareToolRequest(
              {
                workflow: kind,
                mode: current.mode,
                assets,
                previous: changesKind ? undefined : prior,
                referenceMode: mode,
                cloudWorkflows: this.jobs.pool.cloudWorkflows(),
              },
              changesKind
                ? (({ request_id: _id, ...rest }) => ({ title: prior!.title, prompt: prior!.prompt, ...rest }))(value)
                : value,
            );
            for (const ref of request.references ?? [])
              if (!current.assets.includes(ref.asset_id)) throw Error('Input is not attached to this chat.');
            this.assertAssets(current, [...new Set((request.references ?? []).map(r => r.asset_id))]);
            validateChatReferences(request);
            request.prompt = validateCastReferences(
              request,
              castOf(current),
              current.picks ?? {},
              castWarned,
            );
            // A saved style named in the prompt must also be selected, so the words and the controls agree.
            if (request.workflow !== 'image-to-image') {
              const named = this.jobs.loras
                .list(current.mode)
                .filter(
                  l => l.name && l.name.length > 3 && request.prompt.toLowerCase().includes(l.name.toLowerCase()),
                );
              if (named.length && !(request.loras ?? []).some(x => named.some(l => l.id === x.id)))
                throw Error(
                  `The prompt names the saved style “${named[0]!.name}” but does not select it. Set loras to id ${named[0]!.id}, revision ${named[0]!.revision}, and take the style name out of the prompt; if it cannot be used for this kind of draft, say so.`,
                );
            }
            // Each referenced character's look from the brief rides along in words, so a new frame keeps it.
            request.prompt = withCastLooks(request, castOf(current), current.picks ?? {});
            // Sound nobody asked for is a creative change: a new clip stays silent unless the user's recent messages
            // ask for sound (an existing draft keeps the sound it already had).
            const askedText = current.messages
              .filter(m => m.role === 'user')
              .slice(-3)
              .map(m => m.text)
              .join(' ');
            const soundAsked =
              /\b(sound|audio|music|score|soundtrack|ambien\w*|noise|voice|dialog\w*|speak\w*|sings?|hear|footsteps|waves crashing)\b/i.test(
                askedText,
              ) && !/\b(silent|no sound|no audio|without (?:sound|audio)|mute)\b/i.test(askedText);
            const silenced =
              isVideoWorkflow(request.workflow) &&
              request.audio?.output !== 'silent' &&
              !soundAsked &&
              prior?.audio?.output !== request.audio?.output;
            if (silenced) request.audio = { ...request.audio, output: 'silent' };
            // A silent clip must not keep describing sound: its sound section reads "Silence." (the model would
            // otherwise be told one thing by the setting and another by the words).
            // Only when the clip becomes silent in this change (or Seed wrote new sound text): a sound section the
            // previous version already had, including anything the owner typed there, is left as it was.
            const priorSound = prior ? silentSoundSection(prior.prompt) === prior.prompt : true;
            if (
              isVideoWorkflow(request.workflow) &&
              request.audio?.output === 'silent' &&
              (silenced ||
                prior?.audio?.output !== 'silent' ||
                (priorSound && silentSoundSection(request.prompt) !== request.prompt))
            )
              request.prompt = silentSoundSection(request.prompt);
            if (request.workflow !== 'image-to-image')
              this.jobs.loras.resolve(request.loras, loraRoute(request), request.mode);
            if (!group) {
              group = {
                id: randomUUID(),
                after_message_id: [...current.messages].reverse().find(m => m.role === 'user')?.id ?? null,
                workflow: kind,
                state: 'assembling',
                cards: [],
              };
              current.groups.push(group);
            }
            let saved: ChatCard;
            const before = card ? latest(card).request : undefined;
            if (card) {
              card.revisions.push(this.revision(current, request, latest(card).number + 1, latest(card).source_job_id));
              card.workflow = kind;
              saved = card;
            } else {
              if (group.cards.length >= 16) throw Error('A review supports at most 16 requests.');
              // A second draft with the same title is almost always a duplicate: point the agent at editing the first.
              const twin = request.title
                ? group.cards.find(
                    c => (latest(c).request.title ?? '').trim().toLowerCase() === request.title!.trim().toLowerCase(),
                  )
                : undefined;
              if (twin)
                throw Error(
                  `A draft titled "${request.title}" is already in this plan (request_id ${twin.id}). Change it with edit_request instead of creating another, or give the new draft a different title if it is truly separate work.`,
                );
              saved = { id: randomUUID(), workflow: kind, revisions: [this.revision(current, request, 1)] };
              group.cards.push(saved);
            }
            latest(saved).run_id = runId;
            snapshots.set(saved.id, latest(saved).number);
            if (target === saved.id) target = undefined;
            delete group.submission_error;
            this.save(current);
            // A verified receipt: what actually changed and which named images the draft now uses. Replies must match it.
            const named = (refs: ImageRequest['references']) =>
              (refs ?? []).map(r => ({
                role: r.role,
                image: this.contextAssets(current).find(a => a.id === r.asset_id)?.name ?? 'an input',
              }));
            const changed = before
              ? (['prompt', 'title', 'count', 'output', 'audio', 'loras', 'seed', 'detail'] as const)
                  .filter(k => JSON.stringify((before as any)[k]) !== JSON.stringify((request as any)[k]))
                  .map(String)
              : [];
            const inputsBefore = named(before?.references),
              inputsNow = named(request.references);
            if (before && JSON.stringify(inputsBefore) !== JSON.stringify(inputsNow)) changed.push('inputs');
            // A words-only draft made while the user attached images: say so in the result, so the reply cannot claim otherwise.
            const attached = [...current.messages].reverse().find(m => m.role === 'user')?.assets ?? [];
            const wordsOnly =
              (request.workflow === 'text-to-image' || request.workflow === 'text-to-video') &&
              attached.some(a => this.jobs.media.get(a)?.kind === 'image');
            const result = {
              ok: true,
              saved: true,
              status: 'draft saved for review; this draft has not been made yet',
              next_action: before
                ? 'Report only the fields listed in changed, and name the images in inputs_now. If something the user asked for is not in changed, say plainly that it was not changed.'
                : 'Tell the user the draft is ready to review and has not been made yet. Name the images in inputs_now.',
              ...(before ? { changed, inputs_before: inputsBefore } : {}),
              inputs_now: inputsNow,
              // A style the user asked for cannot ride on a picture made from references: the reply must say so.
              ...(request.workflow === 'image-to-image' &&
              !(request.loras ?? []).length &&
              current.messages
                .filter(m => m.role === 'user')
                .slice(-3)
                .some(m => /\bstyle\b/i.test(m.text))
                ? {
                    no_style:
                      'No style is attached to this draft: styles cannot be used on pictures made from references (FLUX 3 Image Klein). Do not say it is in the style. If the user asked for a style on this draft, tell them in one sentence that the look is described in words instead, and that a picture from words (Krea 2) can use the style with less likeness; if their style was for another draft, say nothing about it here.',
                  }
                : {}),
              // A style asked for on a draft that can carry one, but not attached: the reply must not claim it.
              ...(request.workflow !== 'image-to-image' &&
              !(request.loras ?? []).length &&
              current.messages
                .filter(m => m.role === 'user')
                .slice(-1)
                .some(m => /\bstyle\b/i.test(m.text))
                ? {
                    style_missing:
                      'This draft has no style attached. If the user asked for a style on this draft, call edit_request with loras set to that style (from the styles listed for this kind) before replying; never say a draft uses a style unless its request shows it in loras.',
                  }
                : {}),
              ...(silenced
                ? {
                    saved_silent:
                      'Saved silent: the user did not ask for sound. Say the clip is silent and that sound can be added if they want it; do not describe any sound design.',
                  }
                : {}),
              ...(wordsOnly
                ? {
                    words_only:
                      'The user attached images, but this draft is made from words only and does not use them. Do not say it uses or follows the attached image. If the user wants the image to guide this shot, call choose_kind with edit (or animate) and edit_request this draft with the image as its input; otherwise tell them plainly that this draft is words only.',
                  }
                : {}),
              // A changed shot whose brief line still describes the old version: the agent is shown that line, so a
              // change of mind reaches the shot list (the Storyboard reads it) and not only the draft.
              ...(() => {
                if (!before || !changed.includes('prompt')) return {};
                const own = shotFromTitle(request.title ?? '');
                if (own.n === null) return {};
                const line = shotsFromBrief(this.get(id).brief).find(
                  s => shotNameKey(s.name) === shotNameKey(own.name) || s.n === own.n,
                );
                return line
                  ? {
                      brief_shot: `${line.n}. ${line.name}: ${line.action}`,
                      brief_shot_note:
                        'This is how the brief’s shot list still describes this shot. If the user’s change replaces any of it, call update_brief with that line rewritten (and its name, when the name no longer fits), and give the draft the same “Shot N: Name” title; otherwise leave the brief as it is.',
                    }
                  : {};
              })(),
              request_id: saved.id,
              revision: latest(saved).number,
              request: agentRequest(request, assets),
              reference_labels: Object.fromEntries(toolInputLabels(request.references ?? [])),
            };
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
          } catch (error) {
            throw Error(JSON.stringify(requestToolResultError(error, operation)));
          }
        },
      })),
      leaveOut,
      orderTool,
      chooseTake,
      approveReference,
    ];
  }
  send(
    id: string,
    input: {
      version: number;
      text: string;
      assets: string[];
      mention_bindings?: MentionBinding[];
      card_id?: string;
      revision?: number;
      attach_request?: boolean;
      keep_plan?: boolean;
    },
  ) {
    const chat = this.get(id);
    this.checkVersion(chat, input.version);
    if (this.agentBusy(chat)) throw Error('Seed is still replying. Wait for it or stop it, then send.');
    if (!input.text.trim() || input.text.length > 16000) throw Error('Write a message of 1–16000 characters.');
    const key = chatCredential(this.paths);
    if (!key) throw Error('Add your OpenRouter key in Settings → API keys.');
    for (const job of this.jobIds(chat).map(id => this.jobs.get(id)))
      for (const asset of job?.outputs ?? []) if (!chat.assets.includes(asset)) chat.assets.push(asset);
    this.assertAssets(chat, input.assets);
    for (const asset of input.assets) if (!chat.assets.includes(asset)) chat.assets.push(asset);
    const group = openGroup(chat);
    let target: ChatCard | undefined;
    if (input.card_id) {
      target = group?.cards.find(c => c.id === input.card_id);
      if (!target || latest(target).number !== input.revision)
        throw Error('This card changed or already started. Refresh it.');
      // Feedback on one draft uses that draft's kind of tools, whatever kind Seed worked in last.
      if (target.workflow !== chat.workflow) chat.workflow = target.workflow;
    }
    if (input.attach_request && !target) throw Error('Choose the request to attach.');
    const contextCards = target
      ? [target]
      : ((group ?? [...chat.groups].reverse().find(g => g.workflow === chat.workflow))?.cards ?? []);
    const mentionBindings = bindChatMentions(
      input.text,
      input.mention_bindings,
      this.contextAssets(chat),
      target
        ? { card_id: target.id, revision: latest(target).number, references: latest(target).request.references ?? [] }
        : undefined,
    );
    this.assertAssets(
      chat,
      mentionBindings.map(binding => binding.asset_id),
    );
    const inherited = settingsOnlyMessage(input.text)
      ? []
      : contextCards.flatMap(c => latest(c).request.references?.map(r => r.asset_id) ?? []);
    const priorInputs = [...chat.messages].reverse().find(m => m.role === 'user' && m.assets.length)?.assets ?? [];
    const selected = [
      ...new Set([
        ...input.assets,
        ...mentionBindings.map(binding => binding.asset_id),
        ...inherited,
        ...(!input.assets.length && !inherited.length && !settingsOnlyMessage(input.text) ? priorInputs : []),
      ]),
    ];
    if (selected.filter(id => this.jobs.media.get(id)?.kind === 'image').length > 9)
      throw Error('Choose at most nine images for this message.');
    const snapshot = chatPromptSnapshot(this.paths, chat.mode, chat.workflow);
    snapshot.system += '\n\n' + requestToolRules(referenceMode(), chat.workflow ?? undefined);
    snapshot.hash = createHash('sha256')
      .update(
        JSON.stringify({ version: snapshot.version, system: snapshot.system, summarySystem: snapshot.summarySystem }),
      )
      .digest('hex');
    chat.messages.push({
      id: randomUUID(),
      role: 'user',
      text: input.text,
      mention_bindings: mentionBindings,
      assets: input.assets,
      ...(input.attach_request && target
        ? {
            request_attachment: {
              card_id: target.id,
              revision: latest(target).number,
              request: structuredClone(latest(target).request),
              notes: structuredClone(latest(target).notes),
            },
          }
        : {}),
      created_at: now(),
    });
    const needsTitle = chat.messages.filter(m => m.role === 'user').length === 1 && !chat.title_manual;
    if (input.keep_plan && input.card_id)
      throw Error('Choose either a draft to revise or talk without changing the plan.');
    if (group && !input.keep_plan) group.state = 'revising';
    chat.activity = 'thinking';
    chat.error = null;
    chat.partial = '';
    chat.partial_reasoning = '';
    chat.version++;
    const run = {
      id: randomUUID(),
      workflow: chat.workflow,
      source_assets: [...input.assets],
      target_request_id: target?.id,
      prompt: snapshot,
      accounting: [] as ChatAccounting[],
      messages: [] as AgentMessage[],
      state: 'running',
    };
    chat.runs.push(run);
    chat.messages.push({
      id: run.id,
      role: 'assistant',
      text: '',
      assets: [],
      created_at: now(),
      transcript: { started_at: now(), state: 'running', steps: [] },
    });
    this.save(chat);
    const task = this.run(
      chat.id,
      chat.epoch,
      run.id,
      key,
      snapshot,
      selected,
      target?.id,
      contextCards.map(c => c.id),
      Boolean(input.keep_plan),
    ).finally(() => {
      if (this.tasks.get(id) === task) {
        this.tasks.delete(id);
        this.agents.delete(id);
      }
    });
    this.tasks.set(id, task);
    if (needsTitle) {
      try {
        this.generateTitle(id, input.text, key);
      } catch (error) {
        const current = this.get(id);
        current.title_error = (error as Error).message;
        this.save(current);
      }
    }
    return this.view(id);
  }
  /** Project names stay distinguishable: a repeated name gets a number ("The Last Lamp 2"). */
  private uniqueTitle(chat: StoredChat, title: string) {
    const taken = new Set(
      (this.db.prepare('SELECT id FROM chats WHERE mode=? AND id<>?').all(chat.mode, chat.id) as { id: string }[]).map(
        r => this.get(r.id).title.toLowerCase(),
      ),
    );
    if (!taken.has(title.toLowerCase())) return title;
    for (let n = 2; n < 100; n++) if (!taken.has(`${title} ${n}`.toLowerCase())) return `${title} ${n}`;
    return title;
  }
  private generateTitle(id: string, firstMessage: string, key: string) {
    const agent = createChatAgent({
      apiKey: key,
      systemPrompt: chatTitlePrompt(this.paths),
      reasoning: false,
      maxTokens: 128,
      fetch: this.transport,
      onAccounting: value => {
        try {
          const chat = this.get(id);
          chat.title_accounting = [value];
          this.save(chat);
        } catch {
          /* Chat may have been deleted. */
        }
      },
    });
    const task = (async () => {
      try {
        await agent.prompt(firstMessage);
        const final = agent.state.messages.at(-1);
        if (final?.role !== 'assistant' || final.stopReason !== 'stop')
          throw Error('Title generation did not complete.');
        const title = final.content
          .filter(p => p.type === 'text')
          .map(p => p.text)
          .join('')
          .trim()
          .replace(/^['"“”]+|['"“”]+$/g, '')
          .replace(/\s+/g, ' ')
          .slice(0, 70);
        if (!title) throw Error('Title generation returned no title.');
        const chat = this.get(id);
        if (!chat.title_manual) {
          chat.title = this.uniqueTitle(chat, title);
          this.save(chat);
        }
      } catch (error) {
        try {
          const chat = this.get(id);
          chat.title_error = (error as Error).message;
          this.save(chat);
        } catch {
          /* Chat was deleted. */
        }
      } finally {
        this.titles.delete(id);
      }
    })();
    this.titles.set(id, { agent, task });
  }
  private async run(
    id: string,
    epoch: number,
    runId: string,
    key: string,
    snapshot: ReturnType<typeof chatPromptSnapshot>,
    selected: string[],
    target?: string,
    contextCardIds: string[] = [],
    discussOnly = false,
  ) {
    try {
      const chat = this.get(id);
      const ranges = new Map<string, Array<{ start_seconds: number; duration_seconds: number; input_id: string }>>();
      for (const ref of chat.groups
        .flatMap(g => g.cards)
        .filter(c => contextCardIds.includes(c.id))
        .flatMap(c => latest(c).request.references ?? [])) {
        if (ref.range)
          ranges.set(ref.asset_id, [...(ranges.get(ref.asset_id) ?? []), { ...ref.range, input_id: ref.id }]);
      }
      const visual = await visualContext(
        this.paths.data,
        selected.map(assetId => this.jobs.media.get(assetId)).filter(Boolean),
        ranges,
      );
      const images = visual.images,
        imageIds = visual.evidence.filter(e => e.type === 'image').map(e => e.asset_id),
        unavailableImages = visual.unavailable;
      if (this.get(id).epoch !== epoch) return;
      const manifest = this.contextAssets(chat),
        group = openGroup(chat);
      const toolAssets = manifest
        .map((a, index) => ({
          handle: 'input' + (index + 1),
          asset_id: a.id,
          kind: a.kind as 'image' | 'video' | 'audio',
          duration_seconds: Number(a.metadata?.duration) || undefined,
        }))
        .filter(a => a.kind);
      const defaultLabels = toolInputLabels(
        toolAssets.map(a => ({ id: a.handle, asset_id: a.asset_id, kind: a.kind, role: 'reference' as const })),
      );
      const availableInputs = toolAssets.map(a => ({
        ...a,
        ...(referenceMode() === 'direct' ? { prompt_label: defaultLabels.get(a.handle) } : {}),
        ...(a.kind === 'video'
          ? {
              soundtrack_token: '[[' + a.handle + ':audio]]',
              soundtrack_usage: 'Set include_audio true to use this soundtrack.',
            }
          : {}),
        prompt_token: '[[' + a.handle + ']]',
        name: manifest.find(m => m.id === a.asset_id)?.name,
        ...(manifest.find(m => m.id === a.asset_id)?.chosen_for
          ? { chosen_for: manifest.find(m => m.id === a.asset_id)!.chosen_for }
          : {}),
      }));

      const account = (value: ChatAccounting) => {
        const c = this.get(id),
          r = c.runs.find(r => r.id === runId)!;
        const prior = value.id ? r.accounting.findIndex(v => v.id === value.id) : -1;
        if (prior < 0) r.accounting.push(value);
        else r.accounting[prior] = value;
        this.save(c);
      };
      const history = chat.messages
        .filter(m => m.role !== 'event' && m.id !== runId)
        .map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          ...agentMentionContext(
            m.text,
            m.mention_bindings,
            toolAssets,
            chat.groups
              .flatMap(g => g.cards)
              .filter(c => contextCardIds.includes(c.id))
              .map(c => ({
                card_id: c.id,
                revision: latest(c).number,
                references: latest(c).request.references ?? [],
              })),
          ),
        }));
      const compact = await compactConversation(history, chat.summary, async input => {
        const summarizer = createChatAgent({
          apiKey: key,
          systemPrompt: snapshot.summarySystem,
          reasoning: false,
          fetch: this.transport,
          onAccounting: account,
        });
        this.agents.set(id, summarizer);
        await summarizer.prompt(input);
        if (this.get(id).epoch !== epoch) throw Error('Stopped.');
        const final = summarizer.state.messages.at(-1);
        if (final?.role !== 'assistant' || final.stopReason !== 'stop')
          throw Error('Conversation summarization did not complete.');
        return final.content
          .filter(p => p.type === 'text')
          .map(p => p.text)
          .join('\n');
      });
      const afterSummary = this.get(id);
      if (afterSummary.epoch !== epoch) return;
      afterSummary.summary = compact.summary;
      afterSummary.runs.find(r => r.id === runId)!.summary = compact.summary;
      this.save(afterSummary);
      const currentRun = chat.runs.find(r => r.id === runId)!;
      let previousAttempt;
      if (!currentRun.source_assets?.length) {
        for (const priorRun of [...chat.runs].reverse().filter(r => r.id !== runId)) {
          if (priorRun.workflow !== chat.workflow || priorRun.target_request_id !== currentRun.target_request_id) break;
          previousAttempt = [...(chat.messages.find(m => m.id === priorRun.id)?.transcript?.steps ?? [])]
            .reverse()
            .find(s => s.kind === 'tool' && ['create_request', 'edit_request'].includes(s.name ?? ''));
          if (previousAttempt || priorRun.source_assets?.length) break;
        }
      }
      let previousResult: unknown = previousAttempt?.result;
      const previousText = (previousAttempt?.result as any)?.content
        ?.filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('\n');
      if (previousText) {
        try {
          previousResult = JSON.parse(previousText);
        } catch {
          previousResult = { message: previousText.slice(0, 3000), truncated: previousText.length > 3000 };
        }
      }
      const last_attempt =
        previousAttempt && previousAttempt.state !== 'succeeded'
          ? { tool: previousAttempt.name, input: previousAttempt.input, saved: false, result: previousResult }
          : undefined;
      const loraCatalog = (workflow: ChatWorkflow | null) =>
        this.jobs.loras
          .list(chat.mode)
          .filter(l => l.source_status === 'ready')
          .filter(l =>
            workflow === 'text-to-image'
              ? l.route === 'image'
              : workflow === 'text-to-video'
                ? l.route === 'fl'
                : workflow === 'reference-to-video'
                  ? l.route !== 'image'
                  : false,
          )
          .map(l => ({
            id: l.id,
            revision: l.revision,
            name: l.name,
            version: l.version,
            description: l.description ?? '',
            trigger_words: l.trigger_words ?? [],
            source_status: l.source_status,
            default_scale: l.default_scale,
            min_scale: l.min_scale,
            max_scale: l.max_scale,
            compatible_with:
              l.route === 'image'
                ? 'Krea images'
                : l.route === 'fl'
                  ? 'Text to video and first/last-frame guides'
                  : 'General image/video/audio references',
          }));
      const available_loras = loraCatalog(chat.workflow);
      const context = JSON.stringify({
        project_brief: chat.brief || null,
        // Each character and place in the brief, and whether the owner has approved a reference image for it.
        cast_and_places: castOf(chat).map(e => ({
          name: e.name,
          kind: e.kind,
          // The exact token of the approved picture, so the model never guesses which handle is whose.
          reference: chat.picks?.[referenceKey(e.name)]
            ? (() => {
                const handle = toolAssets.find(t => t.asset_id === chat.picks![referenceKey(e.name)])?.handle;
                return handle
                  ? `approved: [[${handle}]] is ${e.name}; write ${e.name}’s name beside [[${handle}]]`
                  : `approved: the input whose chosen_for is “approved reference for ${e.name}”`;
              })()
            : chat.picks?.['skip:' + e.name]
              ? 'not needed (the owner said so)'
              : 'none yet',
        })),
        delivery_frame: chat.frame
          ? `The owner delivers this project at ${chat.frame}; drafts are made at the closest supported shape and cropped to it afterwards, so keep important action inside a ${chat.frame} frame.`
          : null,
        active_kind: Object.entries(chatKinds).find(([, w]) => w === chat.workflow)?.[0] ?? null,
        available_loras,
        worker_policy:
          'Approved requests queue for a compatible worker. Workers are rented and quit by the owner in the GPU panel; no chat tool acquires compute. Enabled local image workers download selected text-to-image LoRAs on first use and reuse cached files; adding LoRAs does not require local setup or an engine restart. Cloud workers install LoRAs when launched, so their installed inventory must match. Do not invent prices or per-image costs; when asked about cost or time, say that the rental screen shows the hourly rate and the stop time before anything starts; a time estimate appears in the plan bar only once Seed has measured that kind of work, so never promise one. Explain the billing facts. Count drafts and takes separately (four drafts with two takes each make eight images). Billing facts: cloud GPUs are rented by the hour from the moment they start, including the first model download and any idle time, until they are released (by the owner, the idle release or the time limit). There are no credits and no per-image charges; never describe costs in credits. The rental screen shows the hourly rate and limits, and its cost figures are estimates, not a cap. The Seed PC costs nothing per hour.',
        last_attempt,
        earlier_conversation_summary: compact.summary?.text,
        conversation: compact.recent,
        assets: manifest,
        available_inputs: availableInputs,
        images_in_order: imageIds,
        visual_evidence_in_order: visual.evidence,
        video_evidence_note:
          'Video images are sampled frames, not a full video. Audio has not been supplied. Do not claim to hear audio.',
        unavailable_images: unavailableImages,
        unavailable_inputs: visual.unavailable_inputs,
        request_context: chat.groups.flatMap(g =>
          g.cards
            .filter(c => contextCardIds.includes(c.id))
            .map(c => ({
              id: c.id,
              state: g.state,
              ...(c.left_out ? { left_out: true } : {}),
              ...latest(c),
              request: agentRequest(latest(c).request, toolAssets),
              reference_labels: Object.fromEntries(chatReferenceLabels(latest(c).request)),
            })),
        ),
        review: group?.cards.map(c => ({ id: c.id, revision: latest(c).number, decision: latest(c).decision })),
        feedback_card: target,
      });
      if (context.length > 400000)
        throw Error(
          'Current requests and attachments exceed the context budget. Start another chat with fewer assets.',
        );
      const kindTools = (workflow: ChatWorkflow) => [
        ...this.workflowTools(id, epoch, workflow, runId, toolAssets, target),
        ...(workflow === 'reference-to-video' && toolAssets.some(a => a.kind === 'video')
          ? [
              createReadInputTool({
                data: this.paths.data,
                assets: toolAssets,
                getAsset: assetId => this.jobs.media.get(assetId),
              }),
            ]
          : []),
      ];
      // The agent chooses the kind of work itself; choosing loads that kind's guide and request tools for the next model request.
      let nextTurn: { systemPrompt: string; tools: AgentTool[] } | undefined;
      // The brief is the project's lasting memory; Seed rewrites it whole when the person settles something lasting.
      const updateBrief: AgentTool = {
        name: 'update_brief',
        label: 'Update brief',
        description:
          'Replace the project brief with an updated version. Use it when the user settles something lasting: the story, characters (exact look and wardrobe), locations, the visual look, always/never rules, the deliverables and the shot list. Send the whole brief as short Markdown, with a "## " heading for each section that applies: Story, Characters, Locations, Look, Rules, Shots. Number the shots. Keep what the user decided; do not invent details. It does not change drafts or generate anything.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { brief: { type: 'string', maxLength: 8000 } },
          required: ['brief'],
        } as any,
        execute: async (_call, raw) => {
          const current = this.get(id);
          if (current.epoch !== epoch) throw Error('This run is no longer active.');
          // The brief is read by people: input handles ("input1", "[[input2]]") become the images' names.
          const handleName = new Map(toolAssets.map(a => [a.handle, manifest.find(m => m.id === a.asset_id)?.name]));
          const text = String((raw as { brief?: unknown }).brief ?? '')
            .replace(/\[\[\s*(input\d+)\s*\]\]|\b(input\d+)\b/gi, (whole, a?: string, b?: string) => {
              const name = handleName.get((a ?? b ?? '').toLowerCase());
              return name ? `“${name}”` : whole;
            })
            .trim();
          if (!text || text.length > 8000)
            throw Error(JSON.stringify({ ok: false, error: 'Send the whole brief, 1-8000 characters.' }));
          // The cast is a record: the brief adds to it and updates looks, but leaving a name out does not remove it.
          const before = castOf(current);
          current.cast = mergeCast(before, text);
          const listed = castFromBrief(text).map(e => e.name.toLowerCase());
          const added = current.cast.filter(e => !before.some(x => x.name.toLowerCase() === e.name.toLowerCase()));
          const kept = current.cast.filter(
            e => !listed.includes(e.name.toLowerCase()) && !castFromBrief(text).some(x => sameCast(x.name, e.name)),
          );
          current.brief = briefWithCast(text, current.cast);
          current.brief_updated_by = 'seed';
          current.brief_updated_at = now();
          this.save(current);
          const result = {
            ok: true,
            saved: true,
            ...(added.length ? { cast_added: added.map(e => e.name) } : {}),
            ...(kept.length
              ? {
                  cast_kept: kept.map(e => e.name),
                  cast_kept_note:
                    'These stay in the cast and were put back in the brief. If the user asked to drop one, tell them to remove it under Cast & places.',
                }
              : {}),
            next_action: 'Mention briefly what you recorded in the brief. Keep every draft consistent with it.',
          };
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
        },
      };
      const chooseKind: AgentTool = {
        name: 'choose_kind',
        label: 'Choose kind',
        description:
          'Choose what kind of media to prepare before creating requests: image (a new still from words), edit (change an existing image; needs an image input), video (a new clip from words only), animate (a clip guided by image, video or audio inputs, such as a start frame). Call it on its own, wait for its result, and only then call create_request, whenever the needed kind differs from the active kind. It does not generate media.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { kind: { type: 'string', enum: Object.keys(chatKinds) } },
          required: ['kind'],
        } as any,
        execute: async (_call, raw) => {
          const kind = String((raw as { kind?: unknown }).kind) as keyof typeof chatKinds,
            workflow = chatKinds[kind];
          const current = this.get(id);
          if (!workflow)
            throw Error(JSON.stringify({ ok: false, error: 'Unknown kind.', choices: Object.keys(chatKinds) }));
          if (current.epoch !== epoch) throw Error('This run is no longer active.');
          // Drafts of other kinds already in the open plan stay; new drafts of this kind join the same plan.
          if (current.workflow !== workflow) {
            current.workflow = workflow;
            current.version++;
            this.save(current);
          }
          const next = chatPromptSnapshot(this.paths, current.mode, workflow);
          nextTurn = {
            systemPrompt: next.system + '\n\n' + requestToolRules(referenceMode(), workflow),
            tools: [chooseKind, updateBrief, ...kindTools(workflow)],
          };
          const result = {
            ok: true,
            kind,
            available_loras: loraCatalog(workflow),
            next_action:
              'Prepare the drafts now with create_request, or edit_request for an existing draft. Drafts of other kinds stay in the plan; editing one with these tools turns it into this kind and keeps its title and prompt unless you change them.',
          };
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
        },
      };
      // Talking without changing the plan: no request tools, so the open plan cannot change in this turn.
      const tools = discussOnly ? [] : [chooseKind, updateBrief, ...(chat.workflow ? kindTools(chat.workflow) : [])];
      const agent = createChatAgent({
        apiKey: key,
        systemPrompt: discussOnly
          ? snapshot.system +
            '\n\nThe user chose to talk without changing the open plan. Answer in conversation only. Do not prepare or change requests, and do not write tool calls.'
          : snapshot.system,
        tools,
        reasoning: chat.reasoning,
        fetch: this.transport,
        onAccounting: account,
        nextTurn: () => {
          const value = nextTurn;
          nextTurn = undefined;
          return value;
        },
      });
      this.agents.set(id, agent);
      let lastUpdate = 0,
        messageIndex = -1;
      agent.subscribe(event => {
        if (event.type === 'message_start' && event.message.role === 'assistant') messageIndex++;
        if (
          ![
            'message_update',
            'message_end',
            'tool_execution_start',
            'tool_execution_update',
            'tool_execution_end',
          ].includes(event.type)
        )
          return;
        if (event.type === 'message_update' && Date.now() - lastUpdate < 100) return;
        const c = this.get(id);
        if (c.epoch !== epoch) return;
        const message = c.messages.find(m => m.id === runId);
        if (!message?.transcript) return;
        recordTurnEvent(message.transcript, event, messageIndex);
        message.text = replyText(message.transcript.steps);
        this.save(c);
        lastUpdate = Date.now();
      });
      await agent.prompt('Conversation and application context (data):\n' + context, images);
      const current = this.get(id),
        run = current.runs.find(r => r.id === runId)!;
      run.messages = agent.state.messages;
      run.state = current.epoch !== epoch ? 'stopped' : 'completed';
      // Image bytes stay in assets, not duplicated indefinitely in persisted runs.
      run.messages = run.messages.map(m =>
        m.role === 'user'
          ? {
              ...m,
              content: typeof m.content === 'string' ? m.content : m.content.filter(part => part.type !== 'image'),
            }
          : m,
      );
      if (current.epoch === epoch) {
        const final = agent.state.messages.at(-1);
        if (final?.role === 'assistant' && ['error', 'aborted', 'length'].includes(final.stopReason)) {
          this.save(current);
          throw Error(
            final.stopReason === 'length'
              ? 'Agent output limit reached. Send feedback to continue.'
              : final.errorMessage?.includes('timed out')
                ? 'The model response timed out after 10 minutes. Saved request changes are preserved; send a follow-up to continue.'
                : final.errorMessage || 'The model response was interrupted. Send a follow-up to continue.',
          );
        }
        const toolResults = agent.state.messages.filter(m => m.role === 'toolResult');
        const message = current.messages.find(m => m.id === runId)!;
        if (message.transcript) {
          finishTurn(message.transcript, toolResults.at(-1)?.isError ? 'failed' : 'completed');
          message.text = replyText(message.transcript.steps);
          message.reasoning_text = message.transcript.steps
            .filter(s => s.kind === 'reasoning')
            .map(s => s.text ?? '')
            .join('\n');
        }
        for (const card of current.groups.flatMap(g => g.cards))
          for (const revision of card.revisions)
            if (revision.run_id === runId) revision.after_message_id = current.messages.at(-1)?.id ?? null;
        const pending = openGroup(current);
        if (pending) {
          if (pending.cards.length) {
            pending.state = 'reviewing';
            for (const card of pending.cards)
              if (card.timeline_start && card.timeline_start > latest(card).number)
                card.timeline_start = latest(card).number;
          } else current.groups = current.groups.filter(g => g.id !== pending.id);
        }
        current.activity = 'idle';
        current.partial = '';
        current.partial_reasoning = '';
      }
      this.save(current);
    } catch (error) {
      const current = this.get(id);
      current.runs.find(r => r.id === runId)!.state = 'failed';
      if (current.epoch === epoch) {
        const message = current.messages.find(m => m.id === runId);
        if (message?.transcript) {
          finishTurn(message.transcript, 'failed');
          message.transcript.error = (error as Error).message;
        }
        current.error = (error as Error).message;
        current.activity = 'idle';
        const pending = openGroup(current);
        if (pending?.cards.length) {
          pending.state = 'reviewing';
          for (const card of pending.cards)
            if (card.timeline_start && card.timeline_start > latest(card).number)
              card.timeline_start = latest(card).number;
        }
      }
      this.save(current);
    }
  }
  revise(id: string, cardId: string, number: number, raw: unknown) {
    const chat = this.get(id);
    for (const job of this.jobIds(chat).map(j => this.jobs.get(j)))
      for (const asset of job?.outputs ?? []) if (!chat.assets.includes(asset)) chat.assets.push(asset);
    if (this.tasks.has(id) || this.preparing.has(id)) throw Error('Wait for the request to finish preparing.');
    const group = openGroup(chat),
      card = group?.cards.find(c => c.id === cardId);
    if (!group || !card || latest(card).number !== number) throw Error('Request changed or already started.');
    // The owner can change a draft's kind in place (for example, turn a words-only shot into an edit of a reference);
    // the draft keeps its place, title and history in the plan.
    const asked = (raw as { workflow?: unknown } | null)?.workflow;
    const workflow =
      typeof asked === 'string' && Object.hasOwn(chatWorkflows, asked) ? (asked as ChatWorkflow) : card.workflow;
    const { workflow: _w, ...fields } = (raw ?? {}) as Record<string, unknown>;
    const request = this.request(chat, workflow, fields, workflow === card.workflow ? latest(card).request : undefined);
    card.revisions.push(this.revision(chat, request, number + 1, latest(card).source_job_id));
    card.workflow = workflow;
    delete group.submission_error;
    chat.version++;
    this.save(chat);
    return this.view(id);
  }
  async decide(id: string, cardId: string, number: number, decision: 'approved' | 'denied') {
    const chat = this.get(id);
    if (this.tasks.has(id) || this.preparing.has(id)) throw Error('Wait for this chat to finish.');
    const group = openGroup(chat),
      card = group?.cards.find(c => c.id === cardId);
    if (!group || group.state !== 'reviewing' || !card || latest(card).number !== number)
      throw Error('Review the current completed proposal.');
    if (decision === 'approved' && !latest(card).approved_snapshot) {
      const current = this.get(id);
      if (
        current.version !== chat.version ||
        current.epoch !== chat.epoch ||
        this.tasks.has(id) ||
        this.preparing.has(id)
      )
        throw Error('Chat changed during approval. Review again.');
      latest(card).notes = this.revision(chat, latest(card).request, number).notes;
      latest(card).request.resolved_seeds = seeds(latest(card).request);
      latest(card).approved_snapshot = true;
    }
    if (latest(card).decision !== decision) delete group.submission_error;
    latest(card).decision = decision;
    const settled = group.cards.every(c => latest(c).decision !== 'undecided'),
      prepare = settled && group.cards.some(c => latest(c).decision === 'approved');
    if (settled) {
      delete group.submission_error;
      chat.activity = prepare ? 'preparing' : 'idle';
      if (!prepare) group.state = 'released';
    }
    // Persist the handoff together with the final decision, before any async work.
    chat.version++;
    this.save(chat);
    if (prepare) await this.release(id, group.id, chat.epoch);
    return this.view(id);
  }
  /**
   * One versioned decision for a whole plan: every listed card is approved or set aside at its exact revision.
   * Repeating an already-applied decision (double-click, reconnect) returns the current view without running anything twice.
   */
  async decideAll(
    id: string,
    groupId: string,
    decisions: Array<{ card: string; revision: number; decision: 'approved' | 'denied' }>,
  ) {
    const chat = this.get(id),
      group = chat.groups.find(g => g.id === groupId);
    if (!group) throw Error('This plan no longer exists.');
    const listed = new Map(decisions.map(d => [d.card, d]));
    if (
      listed.size !== decisions.length ||
      group.cards.length !== listed.size ||
      group.cards.some(c => !listed.has(c.id))
    )
      throw Error('Decide every draft in this plan.');
    const stale = group.cards.filter(c => latest(c).number !== listed.get(c.id)!.revision);
    if (stale.length)
      throw Error(
        'Drafts changed since you reviewed them: ' +
          stale.map(c => latest(c).request.title || 'untitled draft').join(', ') +
          '. Review again.',
      );
    const applied = group.cards.every(c => latest(c).decision === listed.get(c.id)!.decision);
    if (group.state !== 'reviewing') {
      if (applied) return this.view(id);
      throw Error('This plan has already been decided.');
    }
    if (this.tasks.has(id) || this.preparing.has(id)) throw Error('Wait for Seed to finish this plan.');
    for (const card of group.cards) {
      const decision = listed.get(card.id)!.decision,
        revision = latest(card);
      if (decision === 'approved' && !revision.approved_snapshot) {
        revision.notes = this.revision(chat, revision.request, revision.number).notes;
        revision.request.resolved_seeds = seeds(revision.request);
        revision.approved_snapshot = true;
      }
      revision.decision = decision;
    }
    delete group.submission_error;
    const prepare = group.cards.some(c => latest(c).decision === 'approved');
    chat.activity = prepare ? 'preparing' : 'idle';
    if (!prepare) group.state = 'released';
    chat.version++;
    this.save(chat);
    if (prepare) await this.release(id, group.id, chat.epoch);
    return this.view(id);
  }
  /** A user-authored draft made directly in this project: it is approved as written and starts at once. */
  async makeDirect(id: string, raw: unknown, clientRequestId?: string) {
    const chat = this.get(id);
    // A retried submission (lost response, reconnect) returns the earlier result instead of making it twice.
    if (clientRequestId && chat.groups.some(g => g.client_request_id === clientRequestId)) return this.view(id);
    if (this.agentBusy(chat)) throw Error('Wait for Seed to finish, then make this.');
    const workflow = (raw as { workflow?: ChatWorkflow })?.workflow;
    if (!workflow || !Object.hasOwn(chatWorkflows, workflow)) throw Error('Choose what kind of media to make.');
    const { workflow: _kind, ...settings } = raw as Record<string, unknown>;
    const inputs = [
      ...new Set(((settings.references ?? []) as Array<{ asset_id?: unknown }>).map(r => String(r?.asset_id))),
    ];
    this.assertAssets(chat, inputs);
    for (const asset of inputs) if (!chat.assets.includes(asset)) chat.assets.push(asset);
    const request = this.request(chat, workflow, settings);
    const revision = { ...this.revision(chat, request, 1), decision: 'approved' as const, approved_snapshot: true };
    revision.request.resolved_seeds = seeds(revision.request);
    const group: ChatGroup = {
      id: randomUUID(),
      after_message_id: chat.messages.at(-1)?.id ?? null,
      workflow,
      state: 'reviewing',
      cards: [{ id: randomUUID(), workflow, revisions: [revision] }],
      direct: true,
      ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
    };
    // Keep an open plan first so plan revisions still find it.
    chat.groups.push(group);
    chat.activity = 'preparing';
    chat.version++;
    this.save(chat);
    await this.release(id, group.id, chat.epoch);
    const after = this.get(id),
      made = after.groups.find(g => g.id === group.id);
    if (made && made.state === 'reviewing') {
      made.state = 'stopped';
      after.version++;
      this.save(after);
    }
    return this.view(id);
  }
  private async release(id: string, groupId: string, epoch: number) {
    this.preparing.add(id);
    try {
      await this.jobs.serialize(async () => {
        const chat = this.get(id),
          group = chat.groups.find(g => g.id === groupId);
        if (chat.epoch !== epoch || group?.state !== 'reviewing') return;

        const approved = group.cards.filter(c => latest(c).decision === 'approved');
        const staged: Array<Awaited<ReturnType<Jobs['prepareSubmission']>>> = [];
        for (const card of approved) {
          this.assertAssets(chat, [...new Set((latest(card).request.references ?? []).map(r => r.asset_id))]);
          staged.push(
            await this.jobs.prepareSubmission(latest(card).request, `${group.id}-${card.id}-${latest(card).number}`, {
              chat_id: id,
              card_id: card.id,
              revision: latest(card).number,
              ...(latest(card).source_job_id ? { job_id: latest(card).source_job_id } : {}),
            }),
          );
        }
        // Recheck approval after asynchronous media preparation.
        const final = this.get(id);
        if (final.epoch !== chat.epoch || final.version !== chat.version) throw Error('Review was stopped or changed.');
        this.db.transaction(() => {
          for (let i = 0; i < staged.length; i++)
            latest(approved[i]!).job_ids = staged[i]!.commit().jobs.map(j => j.id);
          group.state = 'released';
          chat.activity = 'idle';
          delete group.submission_error;
          this.save(chat);
        })();
      });
    } catch (error) {
      const chat = this.get(id),
        group = chat.groups.find(g => g.id === groupId);
      if (chat.epoch === epoch && group?.state === 'reviewing') {
        group.submission_error = (error as Error).message;
        chat.activity = 'idle';
        this.save(chat);
      }
    } finally {
      // Keep the guard until stopped preparation drains; its finally must not clear a newer attempt.
      this.preparing.delete(id);
    }
  }
  branch(jobIds: string[], fresh: boolean, draft = false) {
    if (!jobIds.length || jobIds.length > 16 || new Set(jobIds).size !== jobIds.length)
      throw Error('Choose one request to branch.');
    const originals = jobIds.map(id => {
      const job = this.jobs.get(id);
      if (!job) throw Error('Job no longer available.');
      return job;
    });
    const original = originals[0]!;
    if (originals.some(j => j.submission_id !== original.submission_id))
      throw Error('Choose outputs from one request.');
    return this.db.transaction(() => {
      const chat = original.source?.chat_id
        ? this.get(original.source.chat_id)
        : this.get(this.create(original.request.mode).id);
      if (this.tasks.has(chat.id) || this.preparing.has(chat.id) || openGroup(chat))
        throw Error('Resolve or stop current proposals in the original chat first.');
      const request = {
        ...original.request,
        count: originals.length,
        seed: fresh ? 'random' : original.seed,
        resolved_seeds: fresh ? undefined : originals.map(j => j.seed),
      };
      chat.assets = [...new Set([...chat.assets, ...(request.references ?? []).map(r => r.asset_id)])];
      const workflow = request.workflow as ChatWorkflow;
      chat.workflow = workflow;
      chat.groups.push({
        id: randomUUID(),
        after_message_id: chat.messages.at(-1)?.id ?? null,
        workflow,
        state: 'reviewing',
        cards: [
          {
            id: randomUUID(),
            workflow,
            ...(draft ? { timeline_start: 2 } : {}),
            revisions: [{ ...this.revision(chat, request, 1), source_job_id: original.id }],
          },
        ],
      });
      chat.version++;
      this.save(chat);
      return this.view(chat.id);
    })();
  }
  repeat(id: string, cardId: string, number: number, fresh: boolean, failedOnly = false, jobId?: string) {
    const chat = this.get(id);
    if (this.tasks.has(id) || this.preparing.has(id) || openGroup(chat))
      throw Error('Resolve or stop current proposals first.');
    const card = chat.groups.flatMap(g => g.cards).find(c => c.id === cardId),
      revision = card?.revisions.find(r => r.number === number);
    if (!card || !revision) throw Error('Revision not found.');
    const originals = revision.job_ids
      .map(id => this.jobs.get(id))
      .filter(j => j && (!failedOnly || j.state === 'failed') && (!jobId || j.id === jobId));
    if (jobId && !originals.length) throw Error('Output not found in this request.');
    if (failedOnly && !originals.length) throw Error('No definitively failed jobs to retry.');
    const requests = [
      {
        ...revision.request,
        count: originals.length || revision.request.count,
        seed: fresh ? 'random' : jobId ? originals[0]!.seed : revision.request.seed,
        resolved_seeds: !fresh && originals.length ? originals.map(j => j!.seed) : undefined,
      },
    ];
    const group: ChatGroup = {
      id: randomUUID(),
      after_message_id: chat.messages.at(-1)?.id ?? null,
      workflow: card.workflow,
      state: 'reviewing',
      cards: requests.map(request => ({
        id: randomUUID(),
        workflow: card.workflow,
        revisions: [this.revision(chat, request, 1)],
      })),
    };
    chat.groups.push(group);
    chat.version++;
    this.save(chat);
    return this.view(id);
  }
  /** Brings a set-aside draft back as a new plan; with `join`, into the plan under review ("Bring back all"). */
  restore(id: string, cardId: string, number: number, raw: unknown, join = false) {
    const chat = this.get(id);
    const open = openGroup(chat);
    if (this.tasks.has(id) || this.preparing.has(id) || (open && !(join && open.state === 'reviewing')))
      throw Error('Resolve or stop current proposals first.');
    const source = chat.groups.flatMap(g => g.cards).find(c => c.id === cardId),
      prior = source?.revisions.find(r => r.number === number);
    if (!source || !prior) throw Error('Revision not found.');
    const request = this.request(chat, source.workflow, raw, prior.request);
    const card: ChatCard = {
      timeline_start: latest(source).number + 1,
      id: randomUUID(),
      workflow: source.workflow,
      revisions: [...source.revisions, this.revision(chat, request, latest(source).number + 1)],
    };
    if (open && join) open.cards.push(card);
    else
      chat.groups.push({
        id: randomUUID(),
        after_message_id: chat.messages.at(-1)?.id ?? null,
        workflow: source.workflow,
        state: 'reviewing',
        cards: [card],
      });
    chat.version++;
    this.save(chat);
    return this.view(id);
  }
  async close() {
    for (const title of this.titles.values()) title.agent.abort();
    await Promise.allSettled([...this.titles.values()].map(t => t.task));
    for (const [id] of this.agents) this.stop(id);
    await Promise.allSettled([...this.tasks.values()]);
  }
}

/** Rewrites a prompt's sound section (overall_soundscape:, Sound:) to "Silence." unless it already says so. */
export function silentSoundSection(prompt: string) {
  const lines = prompt.split('\n');
  const head = /^\s*(?:overall_soundscape|sound|audio)\s*:/i;
  const at = lines.findIndex(l => head.test(l));
  if (at < 0) return prompt;
  let end = at + 1;
  while (
    end < lines.length &&
    lines[end]!.trim() &&
    !/^\s*(?:[a-z]+(?:_[a-z]+)+|[A-Z][\w ]{1,24})\s*:|^\s*\[Shot \d+\]/.test(lines[end]!)
  )
    end++;
  const label = lines[at]!.match(head)![0];
  const rest = lines.slice(at, end).join(' ').slice(label.length).trim();
  if (/^(silence|silent|none|n\/a)\.?$/i.test(rest)) return prompt;
  return [...lines.slice(0, at), label + ' Silence.', ...lines.slice(end)].join('\n');
}
