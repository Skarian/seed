import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  projects as projectsApi,
  randomKey,
  kindOf,
  workflowOf,
  isVideoKind,
  type ChatCard,
  type ChatGroup,
  type ChatMessage,
  type Project,
  type Kind,
} from '../api.js';
import { useApp, useNow, useProject, useStoredState } from '../data.js';
import { Icon } from '../icons.js';
import { Markdown, MenuButton, Confirm, Dialog, Thumb, cleanReply, LocalBoundary, onTabKeys, tabStop } from '../ui.js';
import {
  latest,
  titleOf,
  outputNoun,
  plural,
  duration,
  cardJobs,
  isFailed,
  estimateSeconds,
  estimateText,
  assetName,
} from '../format.js';
import { StatusControl } from '../App.js';
import { PlanCard, type Selection } from './PlanCard.js';
import { ResultGroup } from './ResultGroup.js';
import { Composer, type ComposerContext } from './Composer.js';
import { ComputeSheet } from './ComputeSheet.js';
import { ResultsView } from './ResultsView.js';
import { shotsFromBrief } from '../../../shared/shots.js';
import { referenceKey } from '../../../shared/cast.js';
import { readiness, type StyleEntry } from './readiness.js';
import { buildRequest, defaultMake, defaultRoles, type Attachment, type MakeSettings } from './requests.js';
import { useStyles } from './styles.js';
import { checkDraft, readablePrompt } from './checks.js';
import { BriefBar } from './Brief.js';

const openStates = ['reviewing', 'revising', 'assembling'];
const isOpenPlan = (g: ChatGroup) => openStates.includes(g.state) && !g.direct;

export function ProjectPage({ id, view, focus }: { id: string; view: 'conversation' | 'results'; focus?: string }) {
  const app = useApp();
  const { project, setProject, reload, error } = useProject(id);
  // Screen readers hear when Seed finishes a reply and when results arrive, once each (not every streamed word).
  const [announce, setAnnounce] = useState('');
  const finished = project?.messages
    .filter(m => m.role === 'assistant' && m.transcript && m.transcript.state !== 'running')
    .at(-1);
  const heard = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!finished) return;
    if (heard.current !== undefined && heard.current !== finished.id && finished.text)
      setAnnounce('Seed replied: ' + cleanReply(finished.text).split(/(?<=[.!?])\s/)[0]);
    heard.current = finished.id;
  }, [finished?.id]);
  const doneCount = project?.jobs.filter(j => j.state === 'completed').length ?? 0,
    seenDone = useRef<number | null>(null);
  useEffect(() => {
    seenDone.current = null;
  }, [id]);
  useEffect(() => {
    // Count from the project as it first loads: results that already exist are not news.
    if (!project) return;
    if (seenDone.current !== null && doneCount > seenDone.current)
      setAnnounce(`${doneCount - seenDone.current} ${doneCount - seenDone.current === 1 ? 'result' : 'results'} ready`);
    seenDone.current = doneCount;
  }, [doneCount, Boolean(project)]);
  // "/" jumps to the message box from anywhere in the project, as in chat apps.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key !== '/' ||
        e.defaultPrevented ||
        (e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')
      )
        return;
      const box = document.querySelector<HTMLTextAreaElement>('.composer textarea');
      if (box) {
        e.preventDefault();
        box.focus();
      }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  const projectRef = useRef<Project | null>(null);
  projectRef.current = project;
  // A take chosen elsewhere (Compare) updates this project at once.
  useEffect(() => {
    const changed = (e: Event) => {
      const p = (e as CustomEvent<Project>).detail;
      if (p?.id === id) {
        projectRef.current = p;
        setProject(p);
      }
    };
    addEventListener('seed:project', changed);
    return () => removeEventListener('seed:project', changed);
  }, [id]);
  // Choosing "crop to 2.39:1 after" makes 2.39:1 the project's delivery frame, saved with the project.
  useEffect(() => {
    const chosen = (e: Event) => {
      const { projectId, frame } = (e as CustomEvent<{ projectId: string; frame: string }>).detail;
      const p = projectRef.current;
      if (projectId !== id || !p || p.frame === frame) return;
      void projectsApi
        .setFrame(p, frame)
        .then(next => {
          projectRef.current = next;
          setProject(next);
        })
        .catch(() => {});
    };
    addEventListener('seed:frame', chosen);
    return () => removeEventListener('seed:frame', chosen);
  }, [id]);
  const styles = useStyles(app.mode);
  const plan = project?.groups.find(isOpenPlan);
  const replying = project ? ['thinking', 'preparing'].includes(project.activity) : false;

  // Composer state survives navigation per project.
  const [text, setText] = useStoredState('seed.draft.' + id, '');
  const [reading, setReading] = useState(false),
    lastScroll = useRef(0);
  // The mode is kept with the text it was written for, so a reload never sends a direct-make prompt to the planner.
  const [mode, setMode] = useStoredState<'ask' | 'make'>('seed.mode.' + id, 'ask');
  const [settings, setSettings] = useStoredState<MakeSettings>('seed.make.' + id, defaultMake);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Finished attachments survive a reload, like the text beside them (uploads still in progress do not).
  useEffect(() => {
    try {
      setAttachments(JSON.parse(localStorage.getItem('seed.attach.' + id) ?? '[]'));
    } catch {
      setAttachments([]);
    }
  }, [id]);
  useEffect(() => {
    try {
      localStorage.setItem(
        'seed.attach.' + id,
        JSON.stringify(attachments.filter(a => a.asset_id && !a.progress && !a.error)),
      );
    } catch {
      /* memory only */
    }
  }, [attachments]);
  const [context, setContext] = useState<ComposerContext>(() => {
    // A Refine or Animate target is kept with the text it was typed for.
    try {
      const saved = JSON.parse(localStorage.getItem('seed.target.' + id) ?? 'null');
      return saved?.type === 'using' ? saved : { type: 'talk' };
    } catch {
      return { type: 'talk' };
    }
  });
  useEffect(() => {
    try {
      if (context.type === 'using') localStorage.setItem('seed.target.' + id, JSON.stringify(context));
      else localStorage.removeItem('seed.target.' + id);
    } catch {
      /* memory only */
    }
  }, [context, id]);
  const [selection, setSelection] = useState<Selection>({});
  const [compute, setCompute] = useState<null | {
    role: 'image' | 'video';
    action: string;
    seconds?: number | null;
    then: () => Promise<void>;
  }>(null);
  const [conflict, setConflict] = useState<null | { label: string; run: () => Promise<void>; subject?: string }>(null);
  const [confirmDelete, setConfirmDelete] = useState(false),
    [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(''),
    [problem, setProblem] = useState(''),
    [typing, setTyping] = useState(false);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [focusToken, setFocusToken] = useState(0),
    [flash, setFlash] = useState<string | undefined>(focus);
  const lastSent = useRef<{ text: string; assets: string[] } | null>(null);

  // Context follows the plan: an open plan means messages revise it unless the user chose otherwise.
  useEffect(() => {
    setContext(c =>
      plan
        ? c.type === 'talk'
          ? { type: 'plan' }
          : c
        : c.type === 'plan' || c.type === 'keep' || c.type === 'draft'
          ? { type: 'talk' }
          : c,
    );
  }, [Boolean(plan)]);
  // Ticks and acknowledged warnings belong to the plan and survive a reload on this device.
  useEffect(() => {
    if (!plan) {
      setSelection({});
      return;
    }
    try {
      setSelection(JSON.parse(localStorage.getItem('seed.plan.sel.' + plan.id) ?? '{}'));
      setAcknowledged(new Set(JSON.parse(localStorage.getItem('seed.plan.ack.' + plan.id) ?? '[]')));
    } catch {
      /* start fresh */
    }
  }, [plan?.id]);
  useEffect(() => {
    if (!plan) return;
    try {
      localStorage.setItem('seed.plan.sel.' + plan.id, JSON.stringify(selection));
      localStorage.setItem('seed.plan.ack.' + plan.id, JSON.stringify([...acknowledged]));
    } catch {
      /* memory only */
    }
  }, [selection, acknowledged]);
  // When Seed narrows or widens the plan, its choice replaces earlier ticks on those drafts.
  const leftOut = plan?.cards.map(c => c.id + (c.left_out ? '-' : '')).join() ?? '';
  const lastLeftOut = useRef(leftOut);
  useEffect(() => {
    const first = !lastLeftOut.current;
    const before = new Set(lastLeftOut.current.split(','));
    lastLeftOut.current = leftOut;
    const now = new Set(leftOut.split(','));
    // A plan appearing (first load, or a different plan) keeps the ticks restored for it.
    const ids = (set: Set<string>) => new Set([...set].map(x => x.replace(/-$/, '')));
    const was = ids(before);
    if (first || ![...ids(now)].some(x => was.has(x))) return;
    setSelection(s =>
      Object.fromEntries(
        Object.entries(s).filter(
          ([id]) => (before.has(id) && now.has(id)) || (before.has(id + '-') && now.has(id + '-')),
        ),
      ),
    );
  }, [leftOut]);
  // A result handed over from elsewhere (viewer, Library, compare).
  useEffect(() => {
    const use = app.pendingUse;
    if (!use || !project) return;
    if (use.item.project && use.item.project !== id) return;
    app.clearPendingUse();
    if (use.intent === 'more' || use.intent === 'reuse') {
      const card = project.groups.flatMap(g => g.cards).find(c => c.id === use.item.job?.source?.card_id);
      if (card) {
        if (use.intent === 'more') void remake(card, 'more');
        else reuse(card);
      }
      return;
    }
    // Ask Seed to check a take: Seed looks at the picture and compares it with the brief, the shot and its references.
    if (use.intent === 'check') {
      void run('', () =>
        projectsApi.send(projectRef.current ?? project, {
          text: (() => {
            // The shot's own record (framing, who is in it, where) is the yardstick, so the check is about this shot.
            const shot = use.item.job?.request.shot;
            const spec = shot
              ? ` This shot is ${[shot.framing, shot.cast?.length ? 'with ' + shot.cast.join(' and ') : '', shot.place ? 'at ' + shot.place : ''].filter(Boolean).join(', ')}.`
              : '';
            return `Give me a second opinion on ${use.item.title}.${spec} Look at the picture and compare it with the shot's framing and action and with the approved references of everyone and everything in it (face, hair, wardrobe, props, the place). Say only what you can clearly see; for anything small or unclear, say you are not sure. List what matches and what may not, briefly. Don't draft anything unless I ask.`;
          })(),
          assets: [use.item.asset],
        }),
      );
      return;
    }
    // Use as input is a plain attachment: it can revise a waiting plan or start one, as the words say.
    if (use.intent === 'input') {
      setAttachments(list =>
        list.some(a => a.asset_id === use.item.asset)
          ? list
          : [...list, { key: use.item.asset, asset_id: use.item.asset, name: use.item.title, kind: use.item.kind }],
      );
      setMode('ask');
      setFocusToken(t => t + 1);
      return;
    }
    setMode('ask');
    setContext({ type: 'using', item: use.item, intent: use.intent });
    setFocusToken(t => t + 1);
    // Keep the chosen source visibly anchored: highlight it where it lives in the stream.
    const source = use.item.job?.source?.card_id;
    if (source && use.item.job?.source?.chat_id === id) setFlash(source);
    else {
      follow.current = true;
      requestAnimationFrame(() => {
        const el = scroller.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [app.pendingUse, project?.id]);

  async function run(label: string, fn: () => Promise<Project | void>) {
    setBusy(label);
    setProblem('');
    try {
      const value = await fn();
      if (value) {
        projectRef.current = value;
        setProject(value);
      }
      app.refreshTasks();
      app.refreshProjects();
      return true;
    } catch (e) {
      setProblem((e as Error).message);
      return false;
    } finally {
      setBusy('');
    }
  }
  /** Runs an action that needs a new plan; if one is open, ask first. Never discards or runs the open plan silently. */
  function needsNewPlan(label: string, action: () => Promise<void>) {
    if (plan) setConflict({ label, run: action });
    else void action();
  }
  const setAside = (g: ChatGroup = plan!) =>
    run('Setting the plan aside', () =>
      projectsApi.decide(
        id,
        g.id,
        g.cards.map(c => ({ card: c.id, revision: latest(c).number, decision: 'denied' as const })),
      ),
    );

  // A message written while Seed replies waits and sends itself when the reply ends.
  const [queued, setQueued] = useState(false);
  useEffect(() => {
    if (queued && !replying && project?.activity === 'idle') {
      setQueued(false);
      if (text.trim()) void send();
    }
  }, [queued, replying, project?.activity]);
  async function send() {
    if (!project) return;
    const assets = attachments.filter(a => a.asset_id).map(a => a.asset_id!);
    let body = text.trim(),
      extra: { card_id?: string; revision?: number; keep_plan?: boolean } = {};
    if (context.type === 'keep') extra = { keep_plan: true };
    if (context.type === 'draft') extra = { card_id: context.card, revision: context.revision };
    if (context.type === 'using') {
      assets.unshift(context.item.asset);
      body =
        (context.intent === 'refine'
          ? context.item.kind === 'video'
            ? 'Make a new take of this clip (“' + context.item.title + '”): '
            : 'Edit this image (“' + context.item.title + '”): '
          : context.intent === 'animate'
            ? 'Animate this image (“' + context.item.title + '”) as the start frame: '
            : 'Use “' + context.item.title + '” as an input: ') + body;
    }
    // Refine and Animate mean an operation on that exact image: set the kind before Seed reads the message.
    // A clip cannot be edited as an image: refining it drafts a new take that uses the clip as its reference.
    const kind =
      context.type === 'using'
        ? (
            {
              refine: context.item.kind === 'video' ? 'reference-to-video' : 'image-to-image',
              animate: 'reference-to-video',
            } as Record<string, string>
          )[context.intent]
        : undefined;
    const go = async (addToPlan = false) => {
      lastSent.current = { text: body, assets };
      follow.current = true;
      const ok = await run('', async () => {
        // Always send against the newest version (a plan may have just been set aside).
        let current = projectRef.current ?? project;
        if (kind && !addToPlan && current.workflow !== kind) {
          try {
            current = await projectsApi.setKind(current, kind);
          } catch {
            /* the agent can still choose */
          }
        }
        return projectsApi.send(current, { text: body, assets: [...new Set(assets)], ...extra });
      });
      if (ok) {
        setText('');
        setAttachments([]);
        setContext(c =>
          c.type === 'using' || c.type === 'draft' || c.type === 'keep'
            ? { type: plan && addToPlan ? 'plan' : 'talk' }
            : c,
        );
      }
    };
    // A plan can hold several kinds of work: an animation or edit of a result joins the waiting plan as its own draft.
    if (context.type === 'using' && plan) {
      await go(true);
      return;
    }
    await go();
  }
  async function retry() {
    const last = lastSent.current ?? lastUserMessage(project);
    if (!project || !last) return;
    await run('', () => projectsApi.send(project, { text: last.text, assets: last.assets }));
  }
  function makeItMyself(fromTurn?: ChatMessage) {
    const last = substantialRequest(project);
    if (!last) return;
    // If the model wrote its request as text, its prompt is the best starting point.
    const leaked = fromTurn?.text.match(/prompt\s*[:=]\s*"((?:[^"\\]|\\.){12,})"/)?.[1]?.replace(/\\"/g, '"');
    setMode('make');
    setText(
      leaked ?? last.text.replace(/^(Edit this image|Make a new take of this clip|Animate this image|Use) [^:]*: /, ''),
    );
    const kind: Kind = last.assets.length
      ? project!.asset_manifest?.find(a => a.id === last.assets[0])?.kind === 'image' &&
        /animat|move|video|clip/i.test(last.text)
        ? 'animate'
        : 'edit'
      : /video|clip|animat/i.test(last.text)
        ? 'video'
        : 'image';
    setSettings({ ...settings, kind });
    setAttachments(
      defaultRoles(
        kind,
        last.assets.map(a => {
          const m = project!.asset_manifest?.find(x => x.id === a);
          return { key: a, asset_id: a, name: m?.name ?? 'Input', kind: m?.kind ?? 'image' };
        }),
      ),
    );
    setFocusToken(t => t + 1);
  }

  /** Make directly from the composer: approved as written, runs at once (after GPU consent if needed). */
  async function makeDirect() {
    if (!project) return;
    const inputs = defaultRoles(settings.kind, attachments);
    const all =
      context.type === 'using'
        ? defaultRoles(settings.kind, [
            {
              key: context.item.asset,
              asset_id: context.item.asset,
              name: context.item.title,
              kind: context.item.kind,
              role:
                context.intent === 'animate'
                  ? 'first_frame'
                  : context.intent === 'refine'
                    ? context.item.kind === 'video'
                      ? 'reference'
                      : 'source'
                    : undefined,
            },
            ...inputs,
          ])
        : inputs;
    const request = buildRequest(settings, text, all, titleFromPrompt(text));
    const key = randomKey();
    const go = async () => {
      const ok = await run('Starting', () => projectsApi.makeDirect(id, request, key));
      if (ok) {
        setText('');
        setAttachments([]);
        if (context.type === 'using') setContext({ type: plan ? 'plan' : 'talk' });
      }
    };
    const need = readiness(request as unknown as Parameters<typeof readiness>[0], app.pool, styles);
    if (need.blocked) {
      setProblem(need.label);
      return;
    }
    if (need.needs)
      setCompute({
        role: need.needs,
        action: `make ${outputNoun(request as never, settings.count)}`,
        seconds: estimateSeconds(project?.jobs ?? [], (request as { workflow: string }).workflow, settings.count),
        then: go,
      });
    else await go();
  }

  /** GPU time for some drafts, summed per workflow. Null when any of them has no comparable past job. */
  function planSeconds(cards: ChatCard[]) {
    let total = 0;
    for (const c of cards) {
      const r = latest(c).request,
        s = estimateSeconds(project?.jobs ?? [], r.workflow, r.count);
      if (s === null) return null;
      total += s;
    }
    return total;
  }

  /** Make the open plan: one decision for every draft, after GPU consent if a new rental is needed. */
  async function makePlan(only?: 'image' | 'video') {
    if (!plan) return;
    // "Make 2 images" in a mixed plan leaves its clips saved (Bring back) instead of making them.
    const ofKind = (c: ChatCard) => !only || isVideoKind(kindOf[latest(c).request.workflow]) === (only === 'video');
    const decisions = plan.cards.map(c => ({
      card: c.id,
      revision: latest(c).number,
      decision:
        (selection[c.id] ?? !c.left_out) && ofKind(c) && !readiness(latest(c).request, app.pool, styles).blocked
          ? ('approved' as const)
          : ('denied' as const),
    }));
    const chosen = plan.cards.filter((_, i) => decisions[i]!.decision === 'approved');
    if (!chosen.length) return;
    const go = async () => {
      const ok = await run('Making', () => projectsApi.decide(id, plan.id, decisions));
      if (ok) setFlash(plan.id);
    };
    // A plan can mix kinds: ask for each kind of GPU it needs in turn (image first), then make everything at once.
    const roles = [
      ...new Set(
        chosen
          .map(c => readiness(latest(c).request, app.pool, styles).needs)
          .filter((r): r is 'image' | 'video' => !!r),
      ),
    ].sort();
    const ask = async (i: number): Promise<void> => {
      const role = roles[i];
      if (!role) return go();
      const these = chosen.filter(c => readiness(latest(c).request, app.pool, styles).needs === role);
      const outputs = these.reduce((n, c) => n + latest(c).request.count, 0);
      setCompute({
        role,
        action:
          'make ' +
          outputNoun(latest(these[0]!).request, outputs) +
          (roles.length > 1 && i === 0 ? ' (the clips need a video GPU next)' : ''),
        seconds: planSeconds(these),
        then: () => ask(i + 1),
      });
    };
    await ask(0);
  }

  /** More like this, Retry and Make again run at once as direct makes: no new plan, no extra Make, no conflict with an open plan. */
  async function remake(card: ChatCard, how: 'more' | 'retry' | 'cancelled' | 'again') {
    if (!project) return;
    const r = latest(card).request;
    // Retry and redo-cancelled replace only the takes that did not finish, with their own seeds.
    const failed = cardJobs(project, card).filter(j => (how === 'cancelled' ? j.state === 'cancelled' : isFailed(j)));
    const { mode: _m, resolved_seeds, ...rest } = r;
    const count = how === 'retry' || how === 'cancelled' ? Math.max(1, failed.length) : r.count;
    const seedsFor =
      how === 'retry' || how === 'cancelled' ? failed.map(j => j.seed) : how === 'again' ? resolved_seeds : undefined;
    const request = {
      ...rest,
      count,
      title: how === 'more' ? nextVersion(project, titleOf(r)) : titleOf(r),
      seed: how === 'more' ? 'random' : (seedsFor?.[0] ?? r.seed),
      ...(seedsFor && seedsFor.length === count ? { resolved_seeds: seedsFor } : {}),
    };
    const go = async () => {
      await run('Starting', () => projectsApi.makeDirect(id, request, randomKey()));
    };
    const need = readiness(r, app.pool, styles);
    if (need.blocked) {
      setProblem(need.label);
      return;
    }
    if (need.needs)
      setCompute({
        role: need.needs,
        action: 'make ' + outputNoun(r, count),
        seconds: estimateSeconds(project.jobs, r.workflow, count),
        then: go,
      });
    else await go();
  }
  /** Load a result's exact prompt and settings into Make, to change one thing and run it. */
  function reuse(card: ChatCard) {
    const r = latest(card).request,
      kind = kindOf[r.workflow];
    setMode('make');
    // The words people read, not the engine's compiled form (no section keys or <Picture 1> tokens).
    setText(project ? readablePrompt(r, project, app.tasks) : r.prompt);
    setSettings({
      ...settings,
      kind,
      aspect: r.output.aspect === 'source' ? settings.aspect : r.output.aspect,
      count: r.count,
      ...(isVideoKind(kind)
        ? {
            videoSize: r.output.size,
            duration: r.output.duration_seconds ?? 5,
            sound: r.audio?.output ?? 'generated',
            detail: r.detail ?? 'standard',
          }
        : { imageSize: r.output.size }),
      style: r.loras?.[0],
      target: r.target ?? 'auto',
      seed: r.resolved_seeds?.[0] ?? r.seed,
    });
    setAttachments(
      (r.references ?? []).map(ref => ({
        key: ref.id,
        asset_id: ref.asset_id,
        name: project?.asset_manifest?.find(a => a.id === ref.asset_id)?.name ?? 'Input',
        kind: ref.kind,
        role: ref.role,
        framing: ref.framing,
        start: ref.range?.start_seconds,
        length: ref.range?.duration_seconds,
        include_audio: ref.include_audio,
      })),
    );
    setFocusToken(t => t + 1);
  }
  const actions = {
    onVariations: (card: ChatCard) => void remake(card, 'more'),
    onRetryFailed: (card: ChatCard) => void remake(card, 'retry'),
    onMakeAgain: (card: ChatCard) => void remake(card, 'again'),
    onRedoCancelled: (card: ChatCard) => void remake(card, 'cancelled'),
    onReuse: reuse,
    onApproveReference: (name: string, asset: string | null) =>
      void projectsApi
        .pick(id, referenceKey(name), asset)
        .then(p => {
          projectRef.current = p;
          setProject(p);
          app.toast(asset ? `Approved as ${name}’s reference` : `${name} has no approved reference now`);
        })
        .catch(e => app.toast((e as Error).message)),
    onPrepare: (card: ChatCard) =>
      needsNewPlan('Prepare a variation', async () => {
        await run('', () => projectsApi.repeat(id, card.id, latest(card).number, { fresh: true }));
      }),
    onBringBack: (card: ChatCard) =>
      needsNewPlan('Bring back', async () => {
        const {
          workflow: _w,
          mode: _m,
          resolved_seeds: _s,
          ...request
        } = latest(card).request as never as Record<string, unknown>;
        await run('', () => projectsApi.restore(id, card.id, latest(card).number, request));
      }),
  };

  // Scroll: follow new content unless the user scrolled up; jump to a focused group.
  const scroller = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const signature = project
    ? [
        project.messages.length,
        project.messages.at(-1)?.text.length,
        project.groups.map(g => g.state + g.cards.map(c => c.revisions.length).join()).join(),
        project.jobs.filter(j => j.state === 'completed').length,
      ].join('|')
    : '';
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && follow.current && !flash) el.scrollTop = el.scrollHeight;
  }, [signature, view]);
  // Images load after layout; keep following the bottom while the content grows.
  useEffect(() => {
    const el = scroller.current,
      inner = el?.firstElementChild;
    if (!el || !inner) return;
    const observer = new ResizeObserver(() => {
      if (follow.current && !flash) el.scrollTop = el.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [Boolean(project), view, flash]);
  useEffect(() => {
    if (!flash || !project) return;
    const el =
      document.getElementById('group-' + flash) ??
      document.querySelector<HTMLElement>(`[data-group="${flash}"]`) ??
      document.getElementById('card-' + flash) ??
      document.getElementById('draft-' + flash);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      const t = setTimeout(() => setFlash(undefined), 1600);
      return () => clearTimeout(t);
    }
  }, [flash, Boolean(project)]);

  const timeline = useMemo(() => (project ? buildTimeline(project) : []), [project]);
  const finishedGroups = project
    ? project.groups.filter(
        g =>
          g.state === 'released' &&
          g.cards.every(
            c =>
              latest(c).decision !== 'approved' ||
              latest(c).job_ids.every(j => project.jobs.find(x => x.id === j)?.state === 'completed'),
          ),
      )
    : [];
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const collapsedIds = new Set(
    finishedGroups
      .slice(0, Math.max(0, finishedGroups.length - 6))
      .map(g => g.id)
      .filter(g => !expanded.has(g)),
  );

  const selectedCards = plan
    ? plan.cards.filter(
        c => (selection[c.id] ?? !c.left_out) && !readiness(latest(c).request, app.pool, styles).blocked,
      )
    : [];
  const outputs = selectedCards.reduce((n, c) => n + latest(c).request.count, 0);
  // What Make makes, by kind: "4 images", "2 clips" or "4 images and 2 clips" for a mixed plan.
  const madeOf = (video: boolean) =>
    selectedCards
      .filter(c => isVideoKind(kindOf[latest(c).request.workflow]) === video)
      .reduce((n, c) => n + latest(c).request.count, 0);
  const makeNoun =
    madeOf(true) && madeOf(false)
      ? `${plural(madeOf(false), 'image')} and ${plural(madeOf(true), 'clip')}`
      : outputNoun(
          selectedCards[0] ? latest(selectedCards[0]).request : plan?.cards[0] && latest(plan.cards[0]).request,
          outputs,
        );
  const planReady = plan && plan.state === 'reviewing' && !replying;
  const openChecks = plan
    ? selectedCards.flatMap(c =>
        checkDraft(c, project!, plan.cards.length).filter(
          x => x.fixes.length && !x.soft && !acknowledged.has(c.id + ':' + x.text),
        ),
      )
    : [];
  const unresolved = openChecks.length;
  // The final button names what the person is accepting, not just "anyway".
  const anyway = openChecks.every(c => c.code === 'added-sound')
    ? 'Make with sound'
    : openChecks.every(c => c.code === 'unused-input')
      ? selectedCards.some(c => isVideoKind(kindOf[latest(c).request.workflow]))
        ? 'Make, image drafts without the reference'
        : 'Make without the attached image'
      : openChecks.every(c => c.code === 'shape')
        ? (() => {
            const shapes = [...new Set(selectedCards.map(c => latest(c).request.output.aspect))];
            return shapes.length === 1 ? 'Make at ' + shapes[0] : 'Make ' + makeNoun + ' as drafted';
          })()
        : `Make despite ${unresolved === 1 ? '1 check' : unresolved + ' checks'}`;
  // Seed answered the latest message without changing the plan (often a clarifying question):
  // the plan still shows the earlier version, so running it is a secondary, clearly named choice.
  const lastTurn = project
    ? [...project.messages].reverse().find(m => m.role === 'assistant' && m.transcript)
    : undefined;
  const lastAsk = project ? [...project.messages].reverse().find(m => m.role === 'user') : undefined;
  const planStale = Boolean(
    plan &&
    lastTurn &&
    lastAsk &&
    Date.parse(lastAsk.created_at) <= Date.parse(lastTurn.created_at) &&
    lastTurn.transcript?.state === 'completed' &&
    plan.cards.every(c => !c.revisions.some(r => r.run_id === lastTurn.id)) &&
    /\?\s*$/.test(cleanReply(lastTurn.text)),
  );
  // Seed changed the plan and also asked something (often about an unsupported setting): quote it next to Make.
  const lastReply = lastTurn?.transcript?.state === 'completed' ? cleanReply(lastTurn.text) : '';
  // Only for a real decision (a substitution or limit), not a polite "anything else?".
  // Answering with a button (a fix, or keeping a setting) settles Seed's question too.
  const answered = plan
    ? plan.cards.some(
        c => (latest(c).number > 1 && !latest(c).run_id) || [...acknowledged].some(k => k.startsWith(c.id + ':')),
      )
    : false;
  const question =
    plan &&
    !planStale &&
    !unresolved &&
    !answered &&
    /\?\s*$/.test(lastReply) &&
    /support|instead|can.?t|cannot|not available|only (offer|support|do)|unable|which (one|option|format)|would you (prefer|like)/i.test(
      lastReply,
    ) &&
    plan.cards.some(c => c.revisions.some(r => r.run_id === lastTurn!.id))
      ? (
          lastReply
            .split(/(?<=[.!])\s+/)
            .filter(s => s.includes('?'))
            .at(-1) ?? ''
        )
          .replace(/[*_`#]/g, '')
          .trim()
          .slice(0, 220)
      : '';
  const planNeed = selectedCards
    .map(c => readiness(latest(c).request, app.pool, styles))
    .find(r => r.needs || r.billing);
  // On wide screens the board sits beside the conversation once there are results, unless the person turned that off.
  const [beside, setBeside] = useStoredState('seed.board.beside', false);
  const canSplit = app.split && Boolean(project?.jobs.length),
    split = canSplit && beside;

  if (error && !project)
    return (
      <>
        <Header
          project={null}
          view={view}
          split={false}
          canSplit={false}
          onBeside={() => {}}
          onRename={() => {}}
          onDelete={() => {}}
        />
        <div className="scroll">
          <div className="col">
            <div className="notice error" style={{ marginTop: 24 }}>
              This project could not be opened: {error}{' '}
              <div className="actions">
                <button className="btn small" onClick={() => app.go({ name: 'home' })}>
                  Go to your latest project
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
      <Header
        project={project}
        view={view}
        split={split}
        canSplit={canSplit}
        onBeside={setBeside}
        onRename={() => setRenaming(true)}
        onDelete={() => setConfirmDelete(true)}
      />
      <div
        className="view-panel"
        role={split ? undefined : 'tabpanel'}
        id="project-view"
        aria-labelledby={split ? undefined : view === 'results' ? 'project-tab-results' : 'project-tab-conversation'}
      >
        {view === 'results' && project && !split ? (
          <ResultsView
            project={project}
            onAsk={text => {
              app.go({ name: 'project', id: project.id, view: 'conversation' });
              void run('', () => projectsApi.send(projectRef.current ?? project, { text, assets: [] }));
            }}
            onChanged={p => {
              projectRef.current = p;
              setProject(p);
            }}
          />
        ) : (
          <div className={split ? 'split' : 'single'}>
            <div className={'convo' + (reading ? ' reading' : '')}>
              {project && (project.messages.length > 0 || project.brief) && (
                <BriefBar
                  project={project}
                  busy={replying || Boolean(busy)}
                  onSaved={p => {
                    projectRef.current = p;
                    setProject(p);
                  }}
                  openDrafts={plan?.cards.length ?? 0}
                  onUpdateDrafts={() =>
                    void run('', () =>
                      projectsApi.send(projectRef.current ?? project, {
                        text: 'I changed the brief. Update every open draft so it matches the brief now, change nothing else, and tell me exactly what changed in each one. Do not run anything.',
                        assets: [],
                      }),
                    )
                  }
                />
              )}
              <div
                className="scroll"
                ref={scroller}
                onScroll={e => {
                  const el = e.currentTarget;
                  follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                  // Phones: reading down tucks the brief bar away; any scroll up (or reaching the top) shows it again.
                  if (app.narrow) {
                    const delta = el.scrollTop - lastScroll.current;
                    if (Math.abs(delta) > 12) setReading(delta > 0 && el.scrollTop > 120);
                  }
                  lastScroll.current = el.scrollTop;
                }}
              >
                <div className="col">
                  {!project ? (
                    <div className="stream">
                      <span className="statusline">
                        <span className="dot live" />
                        Opening…
                      </span>
                    </div>
                  ) : !timeline.length ? (
                    <EmptyProject
                      making={mode === 'make'}
                      onStarter={t => {
                        setText(t);
                        setFocusToken(n => n + 1);
                      }}
                    />
                  ) : (
                    <div className="stream" role="log" aria-label="Conversation" aria-relevant="additions">
                      {timeline.map(item => (
                        <LocalBoundary
                          key={item.type === 'message' ? item.message.id : item.group.id}
                          label={item.type === 'message' ? 'This message' : 'This plan or result'}
                        >
                          {item.type === 'message' ? (
                            <Message
                              key={item.message.id}
                              message={item.message}
                              project={project}
                              planAfter={item.groupsAfter.some(isOpenPlan)}
                              onRetry={() => void retry()}
                              onEdit={() => {
                                const last = lastSent.current ?? lastUserMessage(project);
                                if (!last) return;
                                setText(last.text);
                                setFocusToken(n => n + 1);
                              }}
                              onContinue={() =>
                                void run('', () =>
                                  projectsApi.send(projectRef.current ?? project, {
                                    text: 'Continue where you stopped and finish the rest of my last request. Tell me what you finished.',
                                    assets: [],
                                  }),
                                )
                              }
                              onMakeItMyself={() => makeItMyself(item.message)}
                            />
                          ) : isOpenPlan(item.group) ? (
                            <PlanCard
                              key={item.group.id}
                              project={project}
                              group={item.group}
                              snapshot={app.pool}
                              styles={styles}
                              busy={Boolean(busy) || replying}
                              selection={selection}
                              onSelection={setSelection}
                              flash={flash}
                              onRevise={async (card, request) =>
                                run('Saving', () => projectsApi.revise(id, card.id, latest(card).number, request))
                              }
                              onAskAbout={card => {
                                setMode('ask');
                                setContext({
                                  type: 'draft',
                                  card: card.id,
                                  revision: latest(card).number,
                                  title: titleOf(latest(card).request),
                                });
                                setFocusToken(t => t + 1);
                              }}
                              onSetAside={() => void setAside(item.group)}
                              acknowledged={acknowledged}
                              onAcknowledge={key => setAcknowledged(s => new Set([...s, key]))}
                              onEditMyself={(card, ids) => {
                                // The draft becomes an edit of the attached image right where it is: same place in the
                                // plan, same title and words, the first image as its source and any others as references.
                                const r = latest(card).request;
                                const images = ids.filter(
                                  a => (project.asset_manifest?.find(x => x.id === a)?.kind ?? 'image') === 'image',
                                );
                                if (!images.length) return;
                                void run('Saving', () =>
                                  projectsApi.revise(id, card.id, latest(card).number, {
                                    workflow: 'image-to-image',
                                    title: r.title,
                                    prompt: r.prompt,
                                    count: r.count,
                                    seed: 'random',
                                    output: { aspect: 'source', size: r.output.size },
                                    references: images.slice(0, 10).map((asset_id, i) => ({
                                      id: 'input' + (i + 1),
                                      asset_id,
                                      kind: 'image',
                                      role: i === 0 ? 'source' : 'reference',
                                    })),
                                  }),
                                ).then(ok => {
                                  if (ok)
                                    app.toast(
                                      `“${titleOf(r)}” is now an edit of “${assetName(project, images[0]!, app.tasks)}”. Edits keep the source’s shape.`,
                                    );
                                });
                              }}
                            />
                          ) : (
                            <ResultGroup
                              key={item.group.id}
                              project={project}
                              group={item.group}
                              styles={styles}
                              collapsed={collapsedIds.has(item.group.id)}
                              onExpand={() => setExpanded(s => new Set([...s, item.group.id]))}
                              actions={actions}
                              flash={flash}
                            />
                          )}
                        </LocalBoundary>
                      ))}
                      {problem && (
                        <div className="notice error" role="alert">
                          {problem}{' '}
                          <button className="link" onClick={() => setProblem('')}>
                            Dismiss
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div
                className="dock"
                onFocus={e => {
                  if ((e.target as HTMLElement).tagName === 'TEXTAREA') setTyping(true);
                }}
                onBlur={e => {
                  if ((e.target as HTMLElement).tagName === 'TEXTAREA') setTyping(false);
                }}
              >
                <div className="col">
                  {plan && (planStale || question) && (
                    <div className="notice" role="status" style={{ padding: '8px 12px', fontSize: '0.875rem' }}>
                      {planStale ? (
                        'Seed asked a question before changing the plan. The plan shows the earlier version until you answer.'
                      ) : (
                        <>Seed asked: “{question}” Answer below, or make the plan as it is.</>
                      )}
                    </div>
                  )}
                  {plan && !(app.narrow && typing) && (
                    <div className="makebar">
                      <button
                        className="sum"
                        onClick={() => {
                          const first = selectedCards[0];
                          if (first) setFlash(first.id);
                        }}
                        title="Show the selected drafts"
                      >
                        <b>
                          {plan.cards.length === 1 ? '' : 'Selected · '}
                          {makeNoun}
                        </b>
                        {plan.cards.length > 1 ? ` · ${selectedCards.length} of ${plan.cards.length} drafts` : ''}
                        {selectedCards.length && planSeconds(selectedCards) !== null
                          ? ' · ' + estimateText(planSeconds(selectedCards))
                          : ''}
                        {planNeed?.billing
                          ? /whichever is free first/.test(planNeed.label)
                            ? ' · Seed PC or the running cloud GPU'
                            : ' · on the running cloud GPU'
                          : planNeed?.needs
                            ? ' · needs a GPU'
                            : ''}{' '}
                        ›
                      </button>
                      {madeOf(true) > 0 && madeOf(false) > 0 && !planStale && !question && !unresolved && (
                        <button
                          className="btn"
                          disabled={!planReady || Boolean(busy)}
                          onClick={() => void makePlan()}
                          title="Clips take minutes each"
                        >
                          Make all
                        </button>
                      )}
                      <button
                        className={planStale || question || unresolved ? 'btn' : 'btn primary'}
                        disabled={!planReady || !selectedCards.length || Boolean(busy)}
                        onClick={() =>
                          void makePlan(
                            madeOf(true) > 0 && madeOf(false) > 0 && !planStale && !question && !unresolved
                              ? 'image'
                              : undefined,
                          )
                        }
                      >
                        {busy === 'Making'
                          ? 'Starting…'
                          : replying
                            ? 'Seed is replying…'
                            : planStale
                              ? 'Make this earlier version'
                              : question
                                ? 'Make as it is'
                                : unresolved
                                  ? anyway
                                  : madeOf(true) > 0 && madeOf(false) > 0
                                    ? 'Make ' + plural(madeOf(false), 'image')
                                    : 'Make ' + makeNoun}
                      </button>
                    </div>
                  )}
                  {queued && (
                    <div className="notice" role="status" style={{ padding: '8px 12px', fontSize: '0.875rem' }}>
                      Your message below sends as soon as Seed finishes this reply.{' '}
                      <button className="link" onClick={() => setQueued(false)}>
                        Don't send it
                      </button>
                    </div>
                  )}
                  <Composer
                    context={context}
                    onContext={setContext}
                    planOpen={Boolean(plan)}
                    mode={mode}
                    onMode={m => {
                      setMode(m);
                      if (m === 'make' && context.type !== 'using') setContext({ type: plan ? 'plan' : 'talk' });
                      if (m === 'make' && context.type === 'using' && context.intent !== 'input')
                        setSettings({ ...settings, kind: context.intent === 'animate' ? 'animate' : 'edit' });
                    }}
                    text={text}
                    onText={setText}
                    attachments={attachments}
                    onAttachments={setAttachments}
                    settings={settings}
                    onSettings={setSettings}
                    styles={styles}
                    replying={replying}
                    disabled={
                      !project
                        ? 'Opening…'
                        : replying && mode === 'make'
                          ? 'Seed is still replying. Stop reply to make this now.'
                          : undefined
                    }
                    focusToken={focusToken}
                    queued={queued}
                    onQueue={() => setQueued(true)}
                    onSend={() => void send()}
                    onMake={() => void makeDirect()}
                    onStopReply={() => void run('', () => projectsApi.stopReply(id))}
                    onSetAside={() => void setAside()}
                  />
                </div>
              </div>
            </div>
            {split && project && (
              <ResultsView
                project={project}
                embedded
                onAsk={text =>
                  void run('', () => projectsApi.send(projectRef.current ?? project, { text, assets: [] }))
                }
                onChanged={p => {
                  projectRef.current = p;
                  setProject(p);
                }}
              />
            )}
          </div>
        )}
      </div>
      {compute && (
        <ComputeSheet
          key={compute.role + compute.action}
          role={compute.role}
          action={compute.action}
          seconds={compute.seconds}
          onClose={() => setCompute(null)}
          onStarted={() => {
            const then = compute.then;
            setCompute(null);
            void then();
          }}
        />
      )}
      {conflict && (
        <Dialog
          title={
            plan
              ? `Keep ${plan.cards.length === 1 ? '“' + titleOf(latest(plan.cards[0]!).request) + '”' : 'your ' + plan.cards.length + ' waiting drafts'} for later?`
              : 'A plan is waiting'
          }
          onClose={() => setConflict(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConflict(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  const c = conflict;
                  setConflict(null);
                  void c.run();
                }}
              >
                Keep them and continue
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {conflict.subject ? (
              <>
                {conflict.subject} is a different kind of work from the drafts that are waiting, so it can't share their
                plan.{' '}
              </>
            ) : (
              <>{conflict.label} starts a new plan. </>
            )}
            The waiting drafts stay listed under “Not made yet” with their settings, and Bring back returns any of them.
            Nothing is made or deleted, and your message is kept.
          </p>
        </Dialog>
      )}
      {renaming && project && (
        <RenameDialog
          project={project}
          onClose={() => setRenaming(false)}
          onSaved={p => {
            setProject(p);
            app.refreshProjects();
            setRenaming(false);
          }}
        />
      )}
      {confirmDelete && project && (
        <Confirm
          title={`Delete “${project.title}”?`}
          danger
          action="Delete project"
          busy={Boolean(busy)}
          onClose={() => setConfirmDelete(false)}
          body={
            <>
              <p style={{ margin: 0 }}>The conversation and its plans are removed. Its results stay in your Library.</p>
              {(replying || project.jobs.some(j => !['completed', 'failed', 'cancelled'].includes(j.state))) && (
                <p className="changed">
                  This project is still working. Stop the reply and wait for its results to finish before deleting.
                </p>
              )}
            </>
          }
          onConfirm={() =>
            void run('Deleting', async () => {
              await projectsApi.remove(id);
              app.refreshProjects();
              app.go({ name: 'home' });
            })
          }
        />
      )}
    </>
  );
}

function Header({
  project,
  view,
  split,
  canSplit,
  onBeside,
  onRename,
  onDelete,
}: {
  project: Project | null;
  view: 'conversation' | 'results';
  split: boolean;
  canSplit: boolean;
  onBeside: (on: boolean) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const app = useApp();
  // A film with a shot list in its brief works from a storyboard; other projects collect results.
  const board = shotsFromBrief(project?.brief).length ? 'Storyboard' : 'Results';
  return (
    <header className="head">
      <button className="icon-btn back" aria-label="All projects" onClick={() => app.go({ name: 'projects' })}>
        <Icon.Back />
      </button>
      <h1 className="serif">
        <button onClick={onRename} title="Rename project" disabled={!project}>
          {project?.title ?? ' '}
        </button>
      </h1>
      {canSplit && (
        <button
          className="btn small"
          aria-pressed={split}
          onClick={() => onBeside(!split)}
          title={
            split ? `Show the conversation alone, with ${board} as a tab` : 'Show the board beside the conversation'
          }
        >
          <Icon.Compare width={14} height={14} />
          {split ? 'Close side board' : `${board} beside chat`}
        </button>
      )}
      {project && !split && (
        <div className="seg views" role="tablist" aria-label="Project view" onKeyDown={onTabKeys}>
          <button
            role="tab"
            {...tabStop(view === 'conversation', 'project-view', 'project-tab-conversation')}
            onClick={() => app.go({ name: 'project', id: project.id, view: 'conversation' })}
          >
            Conversation
          </button>
          <button
            role="tab"
            {...tabStop(view === 'results', 'project-view', 'project-tab-results')}
            onClick={() => app.go({ name: 'project', id: project.id, view: 'results' })}
          >
            {board}
          </button>
        </div>
      )}
      <span className="spacer" />
      <StatusControl />
      {project && (
        <MenuButton
          label="Project options"
          items={[
            {
              label: 'This project in the Library',
              hint: 'Its results and uploads',
              onSelect: () => app.go({ name: 'library', project: project.id }),
            },
            ...(app.narrow
              ? [
                  { label: 'GPUs', onSelect: () => app.go({ name: 'gpus' }) },
                  { label: 'Settings', onSelect: () => app.go({ name: 'settings' }) },
                  'divider' as const,
                ]
              : []),
            { label: 'Rename', onSelect: onRename },
            { label: 'Delete project…', danger: true, onSelect: onDelete },
          ]}
        >
          <Icon.More />
        </MenuButton>
      )}
    </header>
  );
}

function RenameDialog({
  project,
  onClose,
  onSaved,
}: {
  project: Project;
  onClose: () => void;
  onSaved: (p: Project) => void;
}) {
  const [title, setTitle] = useState(project.title),
    [error, setError] = useState('');
  return (
    <Dialog
      title="Rename project"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!title.trim()}
            onClick={() =>
              void projectsApi
                .rename(project, title.trim())
                .then(onSaved)
                .catch(e => setError(e.message))
            }
          >
            Save
          </button>
        </>
      }
    >
      <input
        className="input"
        autoFocus
        value={title}
        maxLength={120}
        onChange={e => setTitle(e.target.value)}
        aria-label="Project name"
        onKeyDown={e => {
          if (e.key === 'Enter' && title.trim())
            void projectsApi
              .rename(project, title.trim())
              .then(onSaved)
              .catch(err => setError(err.message));
        }}
      />
      {error && (
        <p className="changed" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

function EmptyProject({ onStarter, making }: { onStarter: (t: string) => void; making: boolean }) {
  const { pool } = useApp();
  const local = pool?.local,
    cloud = pool?.summary.active ?? 0;
  const starters = [
    'A short film in four shots: help me plan the keyframes',
    'One character in three different scenes, same look every time',
    'Animate an image I attach into a 5-second clip',
    'Turn a photo I attach into a watercolor painting',
  ];
  return (
    <div className="empty">
      <div>
        <h2 className="serif">What are we making?</h2>
        <p>
          {making
            ? 'Describe exactly what to make. Make now starts it with the settings below.'
            : 'Describe it in your own words. Seed plans it with you and asks before anything runs.'}
        </p>
        <div className="chips">
          {starters.map(s => (
            <button key={s} className="chip" onClick={() => onStarter(s)}>
              {s}
            </button>
          ))}
        </div>
        <p className="faint" style={{ marginTop: 18, fontSize: '0.875rem' }}>
          {local?.enabled
            ? 'Seed PC is ready · no rental fee'
            : cloud
              ? `${cloud} cloud ${cloud === 1 ? 'GPU' : 'GPUs'} running`
              : 'No GPU yet. Seed offers one, with its price, when you make something.'}
        </p>
      </div>
    </div>
  );
}

/** One message in the stream. Seed's turns show a live stage, never tool syntax, and recover when nothing was made. */
function Message({
  message,
  project,
  planAfter,
  onRetry,
  onEdit,
  onContinue,
  onMakeItMyself,
}: {
  message: ChatMessage;
  project: Project;
  planAfter: boolean;
  onRetry: () => void;
  /** Puts the user's last message back in the composer to change and send again. */
  onEdit?: () => void;
  onContinue: () => void;
  onMakeItMyself: () => void;
}) {
  const turn = message.transcript,
    running = turn?.state === 'running';
  const [open, setOpen] = useState(false);
  const now = useNow(1000, running),
    { tasks } = useApp();
  if (message.role === 'event') return <div className="sys">{message.text}</div>;
  if (message.role === 'user') {
    const names = new Map((project.asset_manifest ?? []).map(a => [a.id, a]));
    const intent = message.text.match(
      /^(Edit this image|Make a new take of this clip|Animate this image|Use) \(?“[^”]*”\)?[^:]*: /,
    );
    const label = intent
      ? intent[1] === 'Edit this image'
        ? 'Refine'
        : intent[1] === 'Make a new take of this clip'
          ? 'New take'
          : intent[1] === 'Animate this image'
            ? 'Animate'
            : 'Use as input'
      : '';
    const action = buttonAction(message.text);
    return (
      <div className="msg-you" role="article" aria-label={action ? 'You asked: ' + action : 'You said'}>
        {label && (
          <>
            <span className="kind" style={{ marginRight: 6 }}>
              {label}
            </span>{' '}
          </>
        )}
        {action ? (
          <>
            <span className="kind">{action}</span>
            <details className="action-request">
              <summary className="link">The request Seed was sent</summary>
              <p>{message.text}</p>
            </details>
          </>
        ) : (
          cleanReply(intent ? message.text.slice(intent[0].length) : message.text)
        )}
        {message.assets.length > 0 && (
          <div className="attachments">
            {message.assets.map(a => {
              const m = names.get(a);
              return (
                <span className="input-chip" key={a}>
                  <Thumb id={a} kind={m?.kind ?? 'image'} alt={m?.name ?? 'Attachment'} />
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  // Input tokens belong in generation prompts; in a reply, name the input the user attached.
  const asked = [
    ...project.messages.slice(
      0,
      project.messages.findIndex(m => m.id === message.id),
    ),
  ]
    .reverse()
    .find(m => m.role === 'user');
  const text = cleanReply(message.text).replace(
    /\[\[input(\d+)\]\]|<(?:Picture|Video|Audio) (\d+)>/g,
    (_m, a: string, b: string) => {
      const asset = asked?.assets[Number(a ?? b) - 1];
      return asset ? '“' + assetName(project, asset, tasks) + '”' : 'the attached input';
    },
  );
  const madePlan = project.groups.some(g => g.cards.some(c => c.revisions.some(r => r.run_id === message.id)));
  // A reply that asks something ("Please attach…", ends with a question) is Seed asking, not Seed failing.
  const asking =
    /\?\s*$/.test(text.trim()) ||
    /\b(please (attach|send|share|tell)|could you|which (one|of)|do you want|would you like)\b/i.test(text);
  const toolFailed = turn?.steps.some(s => s.kind === 'tool' && s.state === 'failed') && !madePlan && !asking;
  const leaked = /<\|?tool_call|call:[a-z_.]+\{/i.test(message.text);
  const askedToMake = !madePlan && !asking && (leaked || toolFailed || (!text && turn?.state === 'completed'));
  const stage = running ? stageOf(turn!) : '';
  const reasoning =
    message.reasoning_text ||
    turn?.steps
      .filter(s => s.kind === 'reasoning')
      .map(s => s.text)
      .join('\n');
  // A reply that states a limit ("only supports…", "can't…") stays fully visible next to the plan it affects.
  const long =
    planAfter &&
    text.length > 1200 &&
    !/(only supports?|not supported|isn.t supported|can.t|cannot|not possible|won.t|doesn.t|does not|unable|limitation|words only|keeps? the source|crop|guarantee)/i.test(
      text,
    );
  return (
    <div
      className={'msg-seed' + (long && !open ? ' clamped' : '')}
      role="article"
      aria-label="Seed said"
      aria-busy={running}
    >
      <div className="who">
        Seed
        {running && (
          <span className="statusline">
            <span className="dot live" />
            {stage} · {duration((now - Date.parse(turn!.started_at)) / 1000)}
          </span>
        )}
      </div>
      {running && !text && now - Date.parse(turn!.started_at) > 20000 && (
        <p className="faint" style={{ margin: '0 0 4px', fontSize: '0.875rem' }}>
          {now - Date.parse(turn!.started_at) > 120_000
            ? 'Seed is still working through a long request. Large plans can take several minutes; you can keep working elsewhere in Seed, and the reply and drafts appear here.'
            : 'Long requests can take a minute or more. You can work elsewhere in Seed; the reply and any drafts appear here.'}
        </p>
      )}

      {!running && toolFailed && text && (
        <p className="faint" style={{ margin: '0 0 4px', fontSize: '0.875rem' }}>
          Seed's reply below wasn't carried out: no drafts were saved.
        </p>
      )}
      {/* A reply that says the brief was saved, when this turn did not save it, is corrected right here. */}
      {!running &&
        turn &&
        /\b(updated|saved|recorded|added|wrote|captured|organi[sz]ed|stored)\b[^.]{0,60}\bbrief\b/i.test(text) &&
        !turn.steps.some(s => s.kind === 'tool' && s.name === 'update_brief' && s.state === 'succeeded') && (
          <p className="faint" role="note" style={{ margin: '0 0 4px', fontSize: '0.875rem' }}>
            The brief was not changed in this reply. Ask Seed to save it, or open Brief to write it.
          </p>
        )}
      {text && <Markdown text={text} streaming={running} />}
      {long && (
        <button className="link" style={{ fontSize: '0.875rem' }} aria-expanded={open} onClick={() => setOpen(o => !o)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
      {!running && turn?.state === 'failed' && (
        <div className="notice error">
          {friendlyError(turn.error)}
          <div className="actions">
            {/turn limit/i.test(turn.error ?? '') ? (
              <button className="btn small primary" onClick={onContinue}>
                Continue
              </button>
            ) : (
              <button className="btn small" onClick={onRetry}>
                Try again
              </button>
            )}
            <button className="btn small" onClick={onMakeItMyself}>
              Make it myself
            </button>
          </div>
        </div>
      )}
      {!running && turn?.state === 'stopped' && (
        <div className="stopped-row">
          <span className="faint">Stopped.</span>
          {onEdit && (
            <button className="btn small" onClick={onEdit}>
              Edit message
            </button>
          )}
          <button className="btn small" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      {!running && turn?.state === 'completed' && askedToMake && (
        <div className="notice">
          <b>Seed couldn't prepare that.</b> Your message and attachments are kept.
          <div className="actions">
            <button className="btn small primary" onClick={onRetry}>
              Try again
            </button>
            <button className="btn small" onClick={onMakeItMyself}>
              Make it myself
            </button>
          </div>
        </div>
      )}
      {reasoning && !running && (
        <details className="thinking">
          <summary>Show thinking</summary>
          <pre>{reasoning}</pre>
        </details>
      )}
    </div>
  );
}
/** Errors from the model service, in words that say what happened to the person's work. */
function friendlyError(error?: string | null) {
  const e = (error ?? '').replace(/\.+$/, '');
  if (/turn limit/i.test(e))
    return 'Seed ran out of steps before finishing. Anything it saved is above. Continue lets it finish the rest.';
  if (/timeout|timed out|ETIMEDOUT|idle/i.test(e))
    return 'Seed couldn’t finish this reply in time. Nothing was made and nothing new was rented. Try again.';
  if (/rate.?limit|429|too many/i.test(e))
    return 'The model service is busy right now. Nothing was made. Try again in a minute.';
  if (/network|fetch failed|ECONN|socket|5\d\d|upstream|unavailable/i.test(e))
    return 'Seed lost its connection to the model service. Nothing was made. Try again.';
  if (/credit|payment|402|insufficient/i.test(e))
    return 'The model service needs more credit on your OpenRouter account. Nothing was made.';
  return e
    ? `Seed stopped: ${e}. Nothing was made.`
    : 'Seed couldn’t finish that. Drafts without a new version are unchanged, and nothing was made.';
}
function stageOf(turn: NonNullable<ChatMessage['transcript']>) {
  const last = [...turn.steps].reverse().find(s => s.kind === 'tool');
  if (last?.state === 'running')
    return (
      {
        choose_kind: 'Choosing what to make',
        read_input: 'Looking at your input',
        update_brief: 'Updating the brief',
        leave_out_request: 'Narrowing the plan',
        edit_request: 'Changing a draft',
      }[last.name ?? ''] ?? 'Writing a draft'
    );
  const drafts = turn.steps.filter(
    s => s.kind === 'tool' && s.name === 'create_request' && s.state === 'succeeded',
  ).length;
  if (drafts) return `Wrote ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}`;
  if (turn.steps.at(-1)?.kind === 'text') return 'Replying';
  return turn.steps.length ? 'Thinking' : 'Reading your request';
}

type TimelineItem =
  { type: 'message'; message: ChatMessage; groupsAfter: ChatGroup[] } | { type: 'group'; group: ChatGroup };
function buildTimeline(project: Project): TimelineItem[] {
  const out: TimelineItem[] = [],
    placed = new Set<string>();
  const after = (id: string | null) => project.groups.filter(g => (g.after_message_id ?? null) === id);
  for (const g of after(null)) {
    out.push({ type: 'group', group: g });
    placed.add(g.id);
  }
  // A plan hangs off the user's message that asked for it; show it after Seed's reply to that message.
  let deferred: ChatGroup[] = [];
  const flush = () => {
    for (const g of deferred) {
      out.push({ type: 'group', group: g });
      placed.add(g.id);
    }
    deferred = [];
  };
  // A reply that failed and was retried with the same message collapses to one line, so the request is not shown twice.
  const retried = new Set<string>();
  project.messages.forEach((m, i) => {
    const reply = project.messages[i + 1],
      again = project.messages[i + 2];
    if (
      m.role === 'user' &&
      reply?.role === 'assistant' &&
      reply.transcript?.state === 'failed' &&
      again?.role === 'user' &&
      again.text === m.text &&
      !after(reply.id).length &&
      !after(m.id).length
    ) {
      retried.add(m.id);
      retried.add(reply.id);
    }
  });
  project.messages.forEach((m, i) => {
    if (retried.has(m.id)) {
      if (m.role === 'assistant')
        out.push({
          type: 'message',
          message: {
            ...m,
            role: 'event',
            text: 'Seed couldn’t finish a reply, so you tried again. Nothing was made.',
          } as ChatMessage,
          groupsAfter: [],
        });
      return;
    }
    if (m.role === 'assistant' && !m.text && !m.transcript) return;
    const groups = after(m.id),
      next = project.messages[i + 1];
    if (m.role === 'user' && next?.role === 'assistant') {
      flush();
      out.push({ type: 'message', message: m, groupsAfter: [] });
      deferred = groups;
      return;
    }
    const shown = [...deferred, ...groups];
    out.push({ type: 'message', message: m, groupsAfter: shown });
    deferred = shown;
    flush();
  });
  flush();
  for (const g of project.groups) if (!placed.has(g.id)) out.push({ type: 'group', group: g });
  // The conversation is a record: a made plan appears when it was made, and the open plan is
  // always the current object at the end, so revising it never rewrites the history above.
  const at = (item: TimelineItem, index: number): number => {
    if (item.type === 'message') return Date.parse(item.message.created_at) || index;
    // The open plan sits after the reply that last changed it, so a later answer to a question appears below it,
    // where the person is reading, instead of above it off screen. The Make bar stays pinned either way.
    if (isOpenPlan(item.group)) {
      const runs = new Set(item.group.cards.flatMap(c => c.revisions.map(r => r.run_id)).filter(Boolean));
      const changedBy = project.messages.filter(m => runs.has(m.id)).at(-1);
      return changedBy ? (Date.parse(changedBy.created_at) || index) + 0.5 : Infinity;
    }
    const made = project.jobs
      .filter(j => item.group.cards.some(c => c.revisions.some(r => r.job_ids.includes(j.id))))
      .map(j => Date.parse(j.created_at))
      .filter(Number.isFinite);
    if (made.length) return Math.min(...made);
    const prev = out
      .slice(0, index)
      .reverse()
      .find(x => x.type === 'message') as { message: ChatMessage } | undefined;
    return prev ? (Date.parse(prev.message.created_at) || index) + 0.5 : -Infinity;
  };
  const keyed = out.map((item, index) => ({ item, index, t: at(item, index) }));
  keyed.sort((a, b) => a.t - b.t || a.index - b.index);
  return keyed.map(k => k.item);
}
/** "Fox" → "Fox · v2", then v3: variants get numbers instead of piling up suffixes. */
function nextVersion(project: Project, title: string) {
  const base = title.replace(/( · (v\d+|more))+$/g, '');
  const taken = project.groups
    .flatMap(g => g.cards)
    .map(c => titleOf(latest(c).request))
    .filter(t => t === base || t.startsWith(base + ' · v'));
  const n = Math.max(1, ...taken.map(t => Number(t.match(/ · v(\d+)$/)?.[1] ?? 1)));
  return `${base} · v${n + 1}`;
}
/** The user's last message that asked for something, skipping short follow-ups such as "go ahead". */
function substantialRequest(project: Project | null) {
  const users = project ? [...project.messages].reverse().filter(x => x.role === 'user') : [];
  const m = users.find(x => x.text.trim().split(/\s+/).length >= 8 || x.assets.length) ?? users[0];
  return m ? { text: m.text, assets: m.assets } : null;
}
function lastUserMessage(project: Project | null) {
  const m = project ? [...project.messages].reverse().find(x => x.role === 'user') : undefined;
  return m ? { text: m.text, assets: m.assets } : null;
}
function titleFromPrompt(text: string) {
  // The first clause, without a leading article, cut at a word that ends a phrase ("Storybook title card for The Salt
  // Clock", never "A vintage storybook title card for").
  const first = (text.trim().split(/[.,;:\n]| with | while | as /i)[0] ?? '').replace(/^(a|an|the)\s+/i, '');
  const words = first.split(/\s+/).filter(Boolean).slice(0, 8);
  while (
    words.length > 2 &&
    /^(a|an|the|of|for|in|on|at|to|with|and|or|by|from|into|her|his|its|their)$/i.test(words.at(-1)!)
  )
    words.pop();
  const title = words.join(' ').replace(/^./, c => c.toUpperCase());
  return title.length > 60 ? title.slice(0, 58) + '…' : title;
}
export { isOpenPlan };

/** A request written by one of Seed's own buttons, named as the action it was ("Check · Shot 2 · 1 of 3"). */
function buttonAction(text: string): string | null {
  const m = (re: RegExp) => text.match(re);
  let x;
  if ((x = m(/^Give me a second opinion on (.+?)\.(?:\s|$)/))) return 'Check · ' + x[1];
  if ((x = m(/^Draft one plan with a (clip|keyframe) for (shots? .+?)(?:, each| from the brief)/i)))
    return `Draft ${x[1]!.toLowerCase()}s for ${x[2]}`;
  if ((x = m(/^Draft one plan with a reference for each of (.+?) from the brief/)))
    return 'Draft references for ' + x[1];
  if ((x = m(/^Draft a (?:character|place|prop) reference for (.+?) from the brief/)))
    return `Draft ${x[1]}’s reference`;
  if ((x = m(/^Draft a reference sheet for (.+?) as an edit/))) return `Draft ${x[1]}’s reference sheet`;
  if (/^I changed the brief\. Update every open draft/.test(text)) return 'Update the drafts to match the brief';
  if (/^Continue where you stopped/.test(text)) return 'Continue';
  return null;
}
