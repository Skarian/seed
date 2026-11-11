import { bindChatMentions } from './mentions.js';
import { loraRoute } from '../../shared/workflows.js';
import type { MentionBinding } from '../../shared/chat-mentions.js';
import { createReadInputTool } from './read-input.js';
import { requestToolRules, type ToolAsset } from './request-tools.js';
import { visualContext } from './visual-context.js';
import { recordTurnEvent, finishTurn, TurnStopped } from './transcript.js';
import { addPlan, latest, now, openGroup, referenceMode, settlePlan, type StoredChat } from './model.js';
import { type ToolHost, type ToolSession } from './tools/define.js';
import { draftTools } from './tools/drafts.js';
import { planTools } from './tools/plan.js';
import { briefTool } from './tools/brief.js';
import { kindTool, styleCatalog } from './tools/kind.js';
import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';

import type { Agent, AgentTool } from '@earendil-works/pi-agent-core';
import type { ChatView, ChatMode, ChatWorkflow, ChatGroup, ChatCard, ChatRevision } from '../../shared/chat.js';
import type { StudioPaths } from '../storage.js';
import { imageRequest, seeds, type ImageRequest } from '../workflows.js';
import type { Jobs } from '../jobs.js';
import { createChatAgent, type ChatAccounting } from './provider.js';
import { chatCredential } from './credentials.js';
import { chatPromptSnapshot, chatWorkflows, chatTitlePrompt } from './prompts.js';
import { preserveChatLabels, validateChatReferences } from './references.js';
import {
  agentContext,
  agentHistory,
  compactConversation,
  inputRanges,
  nameInputs,
  settingsOnlyMessage,
  toolAssetsOf,
  type ContextAsset,
} from './context.js';
import { isTerminal, jobActive } from '../../shared/jobs.js';
import { movePlan, planOpen } from '../../shared/plan.js';
import { castOf, mergeCast, briefWithCast, type CastEntry } from '../../shared/cast.js';
import { applyChoice, chosenAs, noChoices, renameReference, shotLabel, type Choice } from '../../shared/choices.js';
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

/** The text of an agent's last message, or undefined when its reply did not finish normally. */
function finishedText(agent: Agent, separator: string) {
  const final = agent.state.messages.at(-1);
  if (final?.role !== 'assistant' || final.stopReason !== 'stop') return undefined;
  return final.content
    .filter(p => p.type === 'text')
    .map(p => p.text)
    .join(separator);
}

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
    // An untitled project was once named "New chat"; one the owner named so keeps its name.
    db.prepare(
      `UPDATE chats SET body_json=json_set(body_json,'$.title','') WHERE json_extract(body_json,'$.title')='New chat' AND json_extract(body_json,'$.title_manual') IS NOT 1`,
    ).run();
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
                ? 'Seed restarted while this plan was getting ready. Choose Make to try again.'
                : 'These drafts were approved but did not start. Choose Make to try again.';
            changed = true;
          }
        } else {
          movePlan(group, 'stopped');
          delete group.submission_error;
          changed = true;
        }
      }
      if (chat.activity === 'thinking' || chat.activity === 'preparing') {
        if (chat.activity === 'thinking') chat.error = 'Seed restarted while replying. Send a message to continue.';
        chat.activity = 'idle';
        settlePlan(chat);
        changed = true;
        for (const message of chat.messages)
          if (message.transcript?.state === 'running') {
            finishTurn(message.transcript, 'failed');
            message.transcript.end = 'restart';
          }
      }
      if (changed) this.save(chat);
    }
  }
  /**
   * Each project's view revision. Every save of the project or of one of its jobs takes a new, larger number
   * (microseconds since the epoch, so a restart never goes back), and every copy sent carries it.
   */
  private revisions = new Map<string, number>();
  private lastRevision = 0;
  private advance(id: string) {
    this.lastRevision = Math.max(Date.now() * 1000, this.lastRevision + 1);
    this.revisions.set(id, this.lastRevision);
    return this.lastRevision;
  }
  private viewRevision = (id: string) => this.revisions.get(id) ?? this.advance(id);
  private save(chat: StoredChat) {
    chat.updated_at = now();
    const revision = this.advance(chat.id);
    this.db
      .prepare('INSERT INTO chats VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body_json=excluded.body_json')
      .run(chat.id, chat.mode, JSON.stringify(chat));
    this.notify(chat.id, () => ({
      version: chat.version,
      revision,
      activity: this.activityOf(chat),
      error: chat.error,
      stream_message: [...chat.messages].reverse().find(m => m.transcript),
    }));
  }
  /** Sends each watcher its own copy of the value; a disconnected one is dropped and cannot undo a committed save. */
  private notify(id: string, value: () => unknown) {
    for (const listener of this.listeners.get(id) ?? []) {
      try {
        listener(value());
      } catch {
        this.listeners.get(id)?.delete(listener);
      }
    }
  }
  /** Job progress reaches a project's watchers at most every 400 ms, as a hint to read the project again. */
  private jobTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private jobSaved(chatId: string | undefined) {
    if (chatId) this.advance(chatId);
    if (!chatId || !this.listeners.has(chatId) || this.jobTimers.has(chatId)) return;
    this.jobTimers.set(
      chatId,
      setTimeout(() => {
        this.jobTimers.delete(chatId);
        this.notify(chatId, () => ({ jobs: true }));
      }, 400),
    );
  }
  private get(id: string): StoredChat {
    const row = this.db.prepare('SELECT body_json FROM chats WHERE id=?').get(id) as { body_json: string } | undefined;
    if (!row) throw Error('Project not found.');
    return JSON.parse(row.body_json);
  }
  private jobIds(chat: ChatView) {
    return [...new Set(chat.groups.flatMap(g => g.cards.flatMap(c => c.revisions.flatMap(r => r.job_ids))))];
  }
  private chatJobs(chat: ChatView) {
    return this.jobs.many(this.jobIds(chat));
  }
  /** Adds the project's results to its assets, so Seed and the owner can use them; returns the project's jobs. */
  private withResults(chat: ChatView, jobs = this.chatJobs(chat)) {
    for (const job of jobs) for (const asset of job.outputs) if (!chat.assets.includes(asset)) chat.assets.push(asset);
    return jobs;
  }
  private generating(chat: ChatView, jobs = this.chatJobs(chat)) {
    const active = jobs.filter(jobActive).map(job => job.id);
    if (!active.length) return false;
    const cancelled = this.db
      .prepare('SELECT COUNT(*) AS n FROM job_cancel_intents WHERE id IN (SELECT value FROM json_each(?))')
      .get(JSON.stringify(active)) as { n: number };
    return cancelled.n < active.length;
  }
  /**
   * What the project is doing now, the one reading the view and the live stream both send: Seed's own work (replying or
   * preparing a plan, stored so a restart can tell it was cut off), else a GPU making its takes, else nothing.
   */
  private activityOf(chat: ChatView, jobs = this.chatJobs(chat)): ChatView['activity'] {
    if (chat.activity === 'thinking' || chat.activity === 'preparing') return chat.activity;
    return this.generating(chat, jobs) ? 'generating' : 'idle';
  }
  /** Rendering results never blocks the conversation; only an agent turn or plan preparation does. */
  private agentBusy(chat: ChatView) {
    return this.tasks.has(chat.id) || this.preparing.has(chat.id);
  }
  private checkVersion(chat: ChatView, version: number) {
    if (chat.version !== version) throw Error('This project changed in another tab. Refresh and try again.');
  }
  view(id: string) {
    const chat = this.get(id);
    const { accounting, ...view } = chat,
      jobs = this.withResults(chat);
    view.activity = this.activityOf(chat, jobs);
    return {
      ...view,
      revision: this.viewRevision(id),
      cast: castOf(chat),
      asset_manifest: this.contextAssets(chat),
      jobs: jobs.map(job => this.jobs.publicJob(job)),
      accounting: [...accounting, ...(chat.title_accounting ?? [])],
    };
  }
  list(mode: ChatMode) {
    return (this.db.prepare('SELECT body_json FROM chats WHERE mode=?').all(mode) as { body_json: string }[])
      .map(row => {
        // A summary only: the list never builds a project's assets, notes or accounting.
        const c = JSON.parse(row.body_json) as StoredChat,
          jobs = this.chatJobs(c),
          activity = this.activityOf(c, jobs);
        return {
          id: c.id,
          title: c.title,
          activity,
          ready_to_review: activity === 'idle' && c.groups.some(g => g.state === 'reviewing' && g.cards.length > 0),
          failed: jobs.some(j => j.state === 'failed'),
          created_at: c.created_at,
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
      title: '',
      workflow: null,
      version: 0,
      epoch: 0,
      reasoning: false,
      messages: [],
      groups: [],
      assets: [],
      accounting: [],
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
    if (this.agentBusy(chat)) throw Error('Wait for Seed to finish before changing project settings.');
    if (values.title !== undefined) {
      if (!values.title.trim() || values.title.length > 120) throw Error('Choose a title of 1–120 characters.');
      chat.title = values.title.trim();
      chat.title_manual = true;
    }
    if (values.workflow !== undefined) {
      if (values.workflow !== null && !Object.hasOwn(chatWorkflows, values.workflow))
        throw Error('Choose image, edit, video or animate.');
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
      this.withResults(chat);
      const known = chat.assets.includes(asset);
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
    if (this.agentBusy(chat) || this.generating(chat))
      throw Error('Stop Seed and the takes being made before deleting this project.');
    if (this.chatJobs(chat).some(job => !isTerminal(job.state)))
      throw Error('A GPU is still stopping or saving this project’s takes. Delete it again once that finishes.');
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
    if (ids.length > 24 || new Set(ids).size !== ids.length) throw Error('Choose up to 24 different inputs.');
    for (const id of ids) {
      const asset = this.jobs.media.get(id);
      if (!asset || (asset.metadata.state ?? 'ready') !== 'ready')
        throw Error('An attached input is missing or still uploading.');
      const row = this.db
        .prepare(
          `SELECT COALESCE(json_extract(metadata_json,'$.mode'),(SELECT json_extract(snapshot_json,'$.request.mode') FROM jobs WHERE jobs.id=json_extract(assets.metadata_json,'$.job_id')),'sfw') mode FROM assets WHERE id=?`,
        )
        .get(id) as { mode: string };
      if (!(allowExisting && chat.assets.includes(id)) && row.mode !== chat.mode)
        throw Error('Choose inputs available in this project.');
    }
  }
  /** The project's assets as Seed reads them, from one read of the assets and their notes and one of their jobs. */
  private contextAssets(chat: StoredChat): ContextAsset[] {
    const rows = this.db
      .prepare(
        `SELECT a.id, a.name, a.kind, a.metadata_json, n.note,
          (SELECT s.note FROM sequence_frames f JOIN asset_notes s ON s.id=f.sequence_id WHERE f.asset_id=a.id) inherited
        FROM assets a LEFT JOIN asset_notes n ON n.id=a.id WHERE a.id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(chat.assets)) as Array<{
      id: string;
      name: string;
      kind: string;
      metadata_json: string;
      note: string | null;
      inherited: string | null;
    }>;
    const assets = new Map(
      rows.map(r => [r.id, { ...r, metadata: JSON.parse(r.metadata_json) as Record<string, any> }]),
    );
    const jobs = new Map(
      this.jobs
        .many([...assets.values()].map(a => a.metadata.job_id).filter(j => typeof j === 'string'))
        .map(j => [j.id, j]),
    );
    const shots = shotsFromBrief(chat.brief);
    // A shot renumbered in the brief is named by its current number ("Shot 6: First Light", not "Shot 5: …").
    const renumbered = (t: string) => {
      const own = shotFromTitle(t);
      if (own.n === null) return t;
      const listed = shots.find(s => shotNameKey(s.name) === shotNameKey(own.name));
      return listed && listed.n !== own.n ? t.replace(/^shot\s*\d+/i, 'Shot ' + listed.n) : t;
    };
    return chat.assets.map(id => {
      const asset = assets.get(id);
      // A generated result is named by the draft that made it and its take, so Seed can tell "Shot 2 · take 1" from "Shot 1".
      const job = jobs.get(asset?.metadata.job_id);
      const title = job?.request.title
        ? `${renumbered(job.request.title)}${(job.request.count ?? 1) > 1 ? ` · take ${(job.submission_index ?? 0) + 1} of ${job.request.count}` : ''}`
        : undefined;
      const chosen = chosenAs(chat.choices, id).map(c =>
        'reference' in c
          ? `approved reference for ${c.reference}`
          : `chosen ${c.kind === 'clip' ? 'clip' : 'keyframe'} for ${shotLabel(shots, c.shot)}`,
      );
      return {
        id,
        name: title ?? asset?.name ?? 'Missing media',
        ...(chosen.length ? { chosen_for: chosen.join(', ') } : {}),
        kind: asset?.kind,
        metadata: asset?.metadata,
        note: asset?.note || asset?.inherited || '',
      };
    });
  }
  private request(chat: StoredChat, workflow: ChatWorkflow, raw: unknown, previous?: ImageRequest): ImageRequest {
    const value = raw as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Provide the draft’s settings.');
    if (chat.mode === 'sfw' && Object.hasOwn(value, 'mode'))
      throw Error('A draft in this project cannot set a mode field.');
    let request = imageRequest({ ...value, workflow, mode: chat.mode === 'sfw' ? 'sfw' : (value.mode ?? 'nsfw') });
    if (previous) {
      request = preserveChatLabels(previous, request);
      if (value.note === undefined && previous.note) request.note = previous.note;
    }
    validateChatReferences(request);
    if (request.workflow !== 'image-to-image') this.jobs.loras.resolve(request.loras, loraRoute(request), request.mode);
    for (const ref of request.references ?? [])
      if (!chat.assets.includes(ref.asset_id)) throw Error('Add this input to the project first.');
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
  /** One kind's request tools, the plan tools, and for references to video with a clip attached, read_input. */
  private kindTools(session: ToolSession, workflow: ChatWorkflow) {
    const { assets } = session;
    return [
      ...draftTools(session, workflow),
      ...planTools(session),
      ...(workflow === 'reference-to-video' && assets.some(a => a.kind === 'video')
        ? [createReadInputTool({ data: this.paths.data, assets, getAsset: id => this.jobs.media.get(id) })]
        : []),
    ];
  }
  /** A kind's tools for a fresh session (tests drive them directly). */
  private workflowTools(id: string, epoch: number, workflow: ChatWorkflow, runId: string, assets: ToolAsset[]) {
    return this.kindTools(this.toolSession(id, epoch, runId, assets), workflow);
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
    this.withResults(chat);
    this.assertAssets(chat, input.assets);
    for (const asset of input.assets) if (!chat.assets.includes(asset)) chat.assets.push(asset);
    const group = openGroup(chat);
    let target: ChatCard | undefined;
    if (input.card_id) {
      target = group?.cards.find(c => c.id === input.card_id);
      if (!target || latest(target).number !== input.revision)
        throw Error('This draft changed or already started. Refresh it.');
      // Feedback on one draft uses that draft's kind of tools, whatever kind Seed worked in last.
      if (target.workflow !== chat.workflow) chat.workflow = target.workflow;
    }
    if (input.attach_request && !target) throw Error('Choose the draft to attach.');
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
    const run = { id: randomUUID() };
    chat.messages.push({
      id: run.id,
      role: 'assistant',
      text: '',
      assets: [],
      created_at: now(),
      transcript: {
        started_at: now(),
        state: 'running',
        steps: [],
        scope: { workflow: chat.workflow, source_assets: [...input.assets], target_request_id: target?.id },
      },
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
        this.updateIfPresent(id, chat => (chat.title_error = (error as Error).message));
      }
    }
    return this.view(id);
  }
  /** Changes a project that may have been deleted meanwhile, as a late title or its accounting can find it. */
  private updateIfPresent(id: string, change: (chat: StoredChat) => void) {
    try {
      const chat = this.get(id);
      change(chat);
      this.save(chat);
    } catch {
      /* The project was deleted. */
    }
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
      onAccounting: value => this.updateIfPresent(id, chat => (chat.title_accounting = [value])),
    });
    const task = (async () => {
      try {
        await agent.prompt(firstMessage);
        const text = finishedText(agent, '');
        if (text === undefined) throw Error('Title generation did not complete.');
        const title = text
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
        this.updateIfPresent(id, chat => (chat.title_error = (error as Error).message));
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
      const visual = await visualContext(
        this.paths.data,
        selected.map(assetId => this.jobs.media.get(assetId)).filter(Boolean),
        inputRanges(chat, contextCardIds),
      );
      if (this.get(id).epoch !== epoch) return;
      const manifest = this.contextAssets(chat),
        toolAssets = toolAssetsOf(manifest),
        named = (text: string) => nameInputs(text, toolAssets, manifest);
      const account = (value: ChatAccounting) => {
        const c = this.get(id);
        const prior = value.id ? c.accounting.findIndex(v => v.id === value.id) : -1;
        if (prior < 0) c.accounting.push(value);
        else c.accounting[prior] = value;
        this.save(c);
      };
      const history = agentHistory(chat, runId, toolAssets, contextCardIds);
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
        const text = finishedText(summarizer, '\n');
        if (text === undefined) throw new TurnStopped('summary');
        return text;
      });
      const afterSummary = this.get(id);
      if (afterSummary.epoch !== epoch) return;
      afterSummary.summary = compact.summary;
      this.save(afterSummary);
      const context = agentContext({
        chat,
        runId,
        target,
        cardIds: contextCardIds,
        manifest,
        toolAssets,
        styles: styleCatalog(this.jobs, chat.mode, chat.workflow),
        compact,
        visual,
      });
      if (context.length > 400000) throw new TurnStopped('too_large');
      const session = this.toolSession(id, epoch, runId, toolAssets, target);
      // Choosing a kind loads that kind's guide and draft tools for the agent's next model request.
      let nextTurn: { systemPrompt: string; tools: AgentTool[] } | undefined;
      const updateBrief = briefTool(session, manifest);
      const chooseKind = kindTool(session, workflow => {
        const next = chatPromptSnapshot(this.paths, chat.mode, workflow);
        nextTurn = {
          systemPrompt: next.system + '\n\n' + requestToolRules(referenceMode(), workflow),
          tools: turnTools(workflow),
        };
      });
      const turnTools = (workflow: ChatWorkflow | null) => [
        chooseKind,
        updateBrief,
        ...(workflow ? this.kindTools(session, workflow) : []),
      ];
      // Talking without changing the plan: no request tools, so the open plan cannot change in this turn.
      const tools = discussOnly ? [] : turnTools(chat.workflow);
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
        // Message updates and ends and every tool event change the transcript; updates at most every 100 ms.
        if (!/^(message_(update|end)|tool_execution_)/.test(event.type)) return;
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
      await agent.prompt('Conversation and application context (data):\n' + context, visual.images);
      const current = this.get(id);
      if (current.epoch === epoch) {
        const final = agent.state.messages.at(-1);
        if (final?.role === 'assistant' && ['error', 'aborted', 'length'].includes(final.stopReason)) {
          this.save(current);
          // The turn limit (a TurnStopped in the agent's stream) reaches here as its message alone.
          const end =
            final.stopReason === 'length'
              ? 'length'
              : final.errorMessage === 'turn_limit'
                ? 'turn_limit'
                : final.errorMessage?.includes('timed out')
                  ? 'timeout'
                  : 'provider';
          throw new TurnStopped(end, end === 'provider' ? final.errorMessage : undefined);
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
      if (current.epoch === epoch) {
        const message = current.messages.find(m => m.id === runId);
        if (message?.transcript) {
          finishTurn(message.transcript, 'failed');
          if (error instanceof TurnStopped) message.transcript.end = error.end;
          const detail = error instanceof TurnStopped ? error.detail : (error as Error).message;
          if (detail) message.transcript.error = detail;
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
    this.withResults(chat);
    if (this.agentBusy(chat)) throw Error('Wait for Seed to finish, then edit this draft.');
    const group = openGroup(chat),
      card = group?.cards.find(c => c.id === cardId);
    if (!group || !card || latest(card).number !== number)
      throw Error('This draft changed or already started. Refresh it.');
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
    if (this.agentBusy(chat)) throw Error('Wait for Seed to finish this plan.');
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
    // Every draft set aside: the plan stops, unmade.
    if (!prepare) movePlan(group, 'stopped');
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
    // Keep an open plan first so plan revisions still find it.
    const group = addPlan(chat, 'reviewing', workflow, [{ id: randomUUID(), workflow, revisions: [revision] }], {
      direct: true,
      ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
    });
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
            throw Error('The plan was stopped or changed while it was getting ready. Review it, then choose Make.');
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
  /** Puts a made draft back up for review as a new plan (Try again): with `fresh`, new seeds; else the same ones. */
  repeat(id: string, cardId: string, number: number, fresh: boolean) {
    const chat = this.get(id);
    if (this.agentBusy(chat) || openGroup(chat)) throw Error('Make or stop the open plan first.');
    const card = chat.groups.flatMap(g => g.cards).find(c => c.id === cardId),
      revision = card?.revisions.find(r => r.number === number);
    if (!card || !revision) throw Error('That version of the draft no longer exists.');
    const originals = this.jobs.many(revision.job_ids);
    const request = {
      ...revision.request,
      count: originals.length || revision.request.count,
      seed: fresh ? 'random' : revision.request.seed,
      resolved_seeds: !fresh && originals.length ? originals.map(j => j.seed) : undefined,
    };
    addPlan(chat, 'reviewing', card.workflow, [
      { id: randomUUID(), workflow: card.workflow, revisions: [this.revision(chat, request, 1)] },
    ]);
    chat.version++;
    this.save(chat);
    return this.view(id);
  }
  /** Brings a set-aside draft back as a new plan; with `join`, into the plan under review ("Bring back all"). */
  restore(id: string, cardId: string, number: number, raw: unknown, join = false) {
    const chat = this.get(id);
    const open = openGroup(chat);
    if (this.agentBusy(chat) || (open && !(join && open.state === 'reviewing')))
      throw Error('Make or stop the open plan first.');
    const source = chat.groups.flatMap(g => g.cards).find(c => c.id === cardId),
      prior = source?.revisions.find(r => r.number === number);
    if (!source || !prior) throw Error('That version of the draft no longer exists.');
    const request = this.request(chat, source.workflow, raw, prior.request);
    const card: ChatCard = {
      timeline_start: latest(source).number + 1,
      id: randomUUID(),
      workflow: source.workflow,
      revisions: [...source.revisions, this.revision(chat, request, latest(source).number + 1)],
    };
    if (open && join) open.cards.push(card);
    else addPlan(chat, 'reviewing', source.workflow, [card]);
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
