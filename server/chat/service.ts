import { bindChatMentions, agentMentionContext } from './mentions.js';
import { loraRoute } from '../../shared/workflows.js';
import type { MentionBinding } from '../../shared/chat-mentions.js';
import { createReadInputTool } from './read-input.js';
import { requestToolRules, toolInputLabels, type ToolAsset } from './request-tools.js';
import { visualContext } from './visual-context.js';
import { recordTurnEvent, finishTurn } from './transcript.js';
import {
  agentRequest,
  chatKinds,
  latest,
  now,
  openGroup,
  referenceMode,
  settlePlan,
  type StoredChat,
} from './model.js';
import { current as activeChat, defineTool, ToolFailure, type ToolHost, type ToolSession } from './tools/define.js';
import { draftTools } from './tools/drafts.js';
import { planTools } from './tools/plan.js';
import { briefTool } from './tools/brief.js';
import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';

import type { Agent, AgentTool } from '@earendil-works/pi-agent-core';
import type { ChatView, ChatMode, ChatWorkflow, ChatGroup, ChatCard, ChatRevision } from '../../shared/chat.js';
import type { StudioPaths } from '../storage.js';
import { imageRequest, seeds, type ImageRequest } from '../workflows.js';
import type { Job, Jobs } from '../jobs.js';
import { createChatAgent, type ChatAccounting } from './provider.js';
import { chatCredential } from './credentials.js';
import { chatPromptSnapshot, chatWorkflows, chatTitlePrompt } from './prompts.js';
import { chatReferenceLabels, preserveChatLabels, validateChatReferences } from './references.js';
import { compactConversation, settingsOnlyMessage } from './context.js';
import { jobActive } from '../../shared/jobs.js';
import { movePlan, planOpen } from '../../shared/plan.js';
import { castOf, mergeCast, briefWithCast, type CastEntry } from '../../shared/cast.js';
import {
  applyChoice,
  approvedReference,
  chosenAs,
  noChoices,
  referenceSkipped,
  renameReference,
  type Choice,
} from '../../shared/choices.js';
import { shotsFromBrief, shotNameKey, shotFromTitle } from '../../shared/shots.js';

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
      // Left-overs of a tool call (a lone brace or bracket on its own line) are never words for a person.
      .replace(/^\s*[{}[\]()]+[,;]?\s*$/gm, '')
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
const terminal = ['completed', 'failed', 'cancelled'];

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
    jobs.onSaved = job => this.jobSaved(job.source?.chat_id);
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
          movePlan(group, 'released');
          delete group.submission_error;
          changed = true;
        }
      }
      if (chat.activity === 'thinking' || chat.activity === 'preparing') {
        if (chat.activity === 'thinking') chat.error = 'Interrupted by server restart. Send a message to continue.';
        chat.activity = 'idle';
        settlePlan(chat);
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
          activity: chat.activity,
          error: chat.error,
          stream_message: [...chat.messages].reverse().find(m => m.transcript),
        });
      } catch {
        this.listeners.get(chat.id)?.delete(listener); /* A disconnected observer cannot undo a committed save. */
      }
    }
  }
  /** Job progress reaches a project's watchers at most every 400 ms, as a hint to read the project again. */
  private jobTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private jobSaved(chatId: string | undefined) {
    if (!chatId || !this.listeners.has(chatId) || this.jobTimers.has(chatId)) return;
    this.jobTimers.set(
      chatId,
      setTimeout(() => {
        this.jobTimers.delete(chatId);
        for (const listener of this.listeners.get(chatId) ?? []) {
          try {
            listener({ jobs: true });
          } catch {
            this.listeners.get(chatId)?.delete(listener);
          }
        }
      }, 400),
    );
  }
  private get(id: string): StoredChat {
    const row = this.db.prepare('SELECT body_json FROM chats WHERE id=?').get(id) as { body_json: string } | undefined;
    if (!row) throw Error('Chat not found.');
    return JSON.parse(row.body_json);
  }
  private jobIds(chat: ChatView) {
    return [...new Set(chat.groups.flatMap(g => g.cards.flatMap(c => c.revisions.flatMap(r => r.job_ids))))];
  }
  private chatJobs(chat: ChatView) {
    return this.jobIds(chat)
      .map(id => this.jobs.get(id))
      .filter((job): job is Job => Boolean(job));
  }
  private generating(chat: ChatView, jobs = this.chatJobs(chat)) {
    return jobs.some(
      job => jobActive(job) && !this.db.prepare('SELECT id FROM job_cancel_intents WHERE id=?').get(job.id),
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
    const { runs, ...view } = chat,
      jobs = this.chatJobs(chat);
    view.activity = this.tasks.has(id)
      ? 'thinking'
      : this.preparing.has(id)
        ? 'preparing'
        : this.generating(chat, jobs)
          ? 'generating'
          : 'idle';
    for (const job of jobs) for (const asset of job.outputs) if (!chat.assets.includes(asset)) chat.assets.push(asset);
    return {
      ...view,
      cast: castOf(chat),
      asset_manifest: this.contextAssets(chat),
      jobs: jobs.map(job => this.jobs.publicJob(job)),
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
   * Choose (or clear) the take used for a shot, or the approved reference picture of a cast name ('skip' when it needs
   * none). Not an agent setting: allowed while Seed replies, no version check.
   */
  choose(id: string, choice: Choice) {
    const chat = this.get(id);
    const { asset } = choice,
      reference = 'reference' in choice;
    if (!reference && (!choice.shot || !['image', 'clip'].includes(choice.kind))) throw Error('Choose a shot.');
    if (asset && asset !== 'skip') {
      if (reference && this.jobs.media.get(asset)?.kind !== 'image') throw Error('A reference must be an image.');
      const known =
        this.jobIds(chat).some(j => this.jobs.get(j)?.outputs.includes(asset)) || chat.assets.includes(asset);
      // A reference can come from another project (a new project with the same brief): it is attached here.
      if (!known && reference) {
        this.assertAssets(chat, [asset], false);
        chat.assets = [...chat.assets, asset];
      } else if (!known) throw Error('Choose a result from this project.');
    } else if (asset === 'skip' && !reference) throw Error('Choose a result for the shot.');
    chat.choices = applyChoice(chat.choices ?? noChoices(), choice);
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
      entry = {
        kind: entry.kind,
        name: entry.name.replace(/\s+/g, ' ').trim(),
        look: entry.look.replace(/\s+/g, ' ').trim(),
      };
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
      if (entry && old.name !== entry.name && chat.choices)
        chat.choices = renameReference(chat.choices, old.name, entry.name);
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
    if (this.chatJobs(chat).some(job => !terminal.includes(job.state)))
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
      if (planOpen(group)) movePlan(group, scope === 'reply' && group.cards.length ? 'reviewing' : 'stopped');
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
      const shotLabel = (key: string) => {
        if (key.startsWith('#')) return 'Shot ' + key.slice(1);
        const listed = shotsFromBrief(chat.brief).find(s => shotNameKey(s.name) === key);
        return listed ? `Shot ${listed.n}: ${listed.name}` : `the shot “${key}”`;
      };
      const chosen = chosenAs(chat.choices, id).map(c =>
        'reference' in c
          ? `approved reference for ${c.reference}`
          : `chosen ${c.kind === 'clip' ? 'clip' : 'keyframe'} for ${shotLabel(c.shot)}`,
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
  /** What the tools may do to a project. */
  private host(): ToolHost {
    return {
      get: id => this.get(id),
      save: chat => this.save(chat),
      choose: (id, choice) => this.choose(id, choice),
      revision: (chat, request, number, source) => this.revision(chat, request, number, source),
      assertAssets: (chat, ids) => this.assertAssets(chat, ids),
      contextAssets: chat => this.contextAssets(chat),
      jobs: this.jobs,
    };
  }
  private toolSession(id: string, epoch: number, runId: string, assets: ToolAsset[], target?: string): ToolSession {
    const chat = this.get(id);
    return {
      host: this.host(),
      id,
      epoch,
      runId,
      assets,
      target,
      snapshots: new Map(chat.groups.flatMap(g => g.cards).map(c => [c.id, latest(c).number])),
      castWarned: new Set(),
    };
  }
  /** One kind's request tools and the plan tools, for a fresh session (tests drive them directly). */
  private workflowTools(id: string, epoch: number, workflow: ChatWorkflow, runId: string, assets: ToolAsset[]) {
    const session = this.toolSession(id, epoch, runId, assets);
    return [...draftTools(session, workflow), ...planTools(session)];
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
      /** Run the latest message again (Try again): no second copy of it is added to the conversation. */
      retry?: boolean;
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
    const lastUser = [...chat.messages].reverse().find(m => m.role === 'user');
    if (!(input.retry && lastUser?.text === input.text))
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
    if (group && !input.keep_plan) movePlan(group, 'revising');
    chat.activity = 'thinking';
    chat.error = null;
    chat.version++;
    const run = {
      id: randomUUID(),
      workflow: chat.workflow,
      source_assets: [...input.assets],
      target_request_id: target?.id,
      accounting: [] as ChatAccounting[],
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
      // A reply names pictures, never Seed's handles: [[input21]] reads as the picture's own name.
      const named = (text: string) =>
        text.replace(/\[\[\s*(input\d+)\s*\]\]/gi, (_whole, handle: string) => {
          const a = toolAssets.find(x => x.handle === handle.toLowerCase());
          const name = a && manifest.find(m => m.id === a.asset_id)?.name;
          return name ? '“' + name + '”' : 'the picture';
        });
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
          reference: approvedReference(chat.choices, e.name)
            ? (() => {
                const handle = toolAssets.find(t => t.asset_id === approvedReference(chat.choices, e.name))?.handle;
                return handle
                  ? `approved: [[${handle}]] is ${e.name}; write ${e.name}’s name beside [[${handle}]]`
                  : `approved: the input whose chosen_for is “approved reference for ${e.name}”`;
              })()
            : referenceSkipped(chat.choices, e.name)
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
      const session = this.toolSession(id, epoch, runId, toolAssets, target);
      const kindTools = (workflow: ChatWorkflow) => [
        ...draftTools(session, workflow),
        ...planTools(session),
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
      const updateBrief = briefTool(session, manifest);
      const chooseKind: AgentTool = defineTool({
        name: 'choose_kind',
        label: 'Choose kind',
        description:
          'Choose what kind of media to prepare before creating requests: image (a new still from words), edit (change an existing image; needs an image input), video (a new clip from words only), animate (a clip guided by image, video or audio inputs, such as a start frame). Call it on its own, wait for its result, and only then call create_request, whenever the needed kind differs from the active kind. It does not generate media.',
        properties: { kind: { type: 'string', enum: Object.keys(chatKinds) } },
        run: input => {
          const kind = String(input.kind) as keyof typeof chatKinds,
            workflow = chatKinds[kind];
          if (!workflow) throw new ToolFailure('Unknown kind.', { choices: Object.keys(chatKinds) }, true);
          const now = activeChat(session);
          // Drafts of other kinds already in the open plan stay; new drafts of this kind join the same plan.
          if (now.workflow !== workflow) {
            now.workflow = workflow;
            now.version++;
            this.save(now);
          }
          const next = chatPromptSnapshot(this.paths, now.mode, workflow);
          nextTurn = {
            systemPrompt: next.system + '\n\n' + requestToolRules(referenceMode(), workflow),
            tools: [chooseKind, updateBrief, ...kindTools(workflow)],
          };
          return {
            kind,
            available_loras: loraCatalog(workflow),
            next_action:
              'Prepare the drafts now with create_request, or edit_request for an existing draft. Drafts of other kinds stay in the plan; editing one with these tools turns it into this kind and keeps its title and prompt unless you change them.',
          };
        },
      });
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
        message.text = named(replyText(message.transcript.steps));
        this.save(c);
        lastUpdate = Date.now();
      });
      await agent.prompt('Conversation and application context (data):\n' + context, images);
      const current = this.get(id),
        run = current.runs.find(r => r.id === runId)!;
      run.state = current.epoch !== epoch ? 'stopped' : 'completed';
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
          message.text = named(replyText(message.transcript.steps));
          message.reasoning_text = message.transcript.steps
            .filter(s => s.kind === 'reasoning')
            .map(s => s.text ?? '')
            .join('\n');
        }
        for (const card of current.groups.flatMap(g => g.cards))
          for (const revision of card.revisions)
            if (revision.run_id === runId) revision.after_message_id = current.messages.at(-1)?.id ?? null;
        settlePlan(current);
        current.activity = 'idle';
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
        settlePlan(current);
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
      if (!prepare) movePlan(group, 'released');
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
    if (!prepare) movePlan(group, 'released');
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
      movePlan(made, 'stopped');
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
        // Other writes (a pick, a cast edit, the title) may land during preparation: commit onto a fresh read, and only
        // if the same revisions are still the approved ones.
        this.db.transaction(() => {
          const final = this.get(id),
            plan = final.groups.find(g => g.id === groupId);
          const now = plan?.cards.filter(c => latest(c).decision === 'approved') ?? [];
          if (
            final.epoch !== epoch ||
            plan?.state !== 'reviewing' ||
            now.length !== approved.length ||
            approved.some((c, i) => now[i]!.id !== c.id || latest(now[i]!).number !== latest(c).number)
          )
            throw Error('Review was stopped or changed.');
          for (const card of now)
            this.assertAssets(final, [...new Set((latest(card).request.references ?? []).map(r => r.asset_id))]);
          now.forEach((card, i) => (latest(card).job_ids = staged[i]!.commit().jobs.map(j => j.id)));
          movePlan(plan, 'released');
          final.activity = 'idle';
          delete plan.submission_error;
          this.save(final);
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
