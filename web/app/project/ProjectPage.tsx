import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  projects as projectsApi,
  randomKey,
  kindOf,
  isVideoKind,
  type ChatCard,
  type ChatGroup,
  type ChatMessage,
  type Project,
  type Kind,
} from '../api.js';
import { currentProject, putProject, useApp, useProject, useStoredState } from '../data.js';
import { Confirm, Dialog, cleanReply, LocalBoundary } from '../ui.js';
import {
  latest,
  titleOf,
  outputNoun,
  plural,
  cardJobs,
  isFailed,
  estimateSeconds,
  estimateText,
  assetName,
} from '../format.js';
import { PlanCard, type Selection } from './PlanCard.js';
import { ResultGroup } from './ResultGroup.js';
import { Composer, type ComposerContext } from './Composer.js';
import { ComputeSheet } from './ComputeSheet.js';
import { ResultsView } from './ResultsView.js';
import { approvedReferences } from '../../../shared/choices.js';
import { readiness } from './readiness.js';
import { buildRequest, defaultMake, defaultRoles, type Attachment, type MakeSettings } from './requests.js';
import { useStyles } from './styles.js';
import { checkDraft, readablePrompt } from './checks.js';
import { BriefBar } from './Brief.js';
import { Header, RenameDialog, EmptyProject } from './ProjectHeader.js';
import { Message } from './Message.js';
import {
  isOpenPlan,
  buildTimeline,
  nextVersion,
  substantialRequest,
  lastUserMessage,
  titleFromPrompt,
} from './timeline.js';

export function ProjectPage({ id, view, focus }: { id: string; view: 'conversation' | 'results'; focus?: string }) {
  const app = useApp();
  const { project, error } = useProject(id);
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
  const styles = useStyles(app.mode);
  const plan = project?.groups.find(isOpenPlan);
  const replying = project ? ['thinking', 'preparing'].includes(project.activity) : false;

  // Composer state survives navigation per project.
  const [text, setText] = useStoredState('seed.draft.' + id, '');
  const [reading, setReading] = useState(false),
    lastScroll = useRef(0),
    userScroll = useRef(0);
  // Phones, reading down the conversation: the header's second row (views and status) tucks away with the brief bar.
  useEffect(() => {
    document.body.classList.toggle('reading', reading);
    return () => {
      document.body.classList.remove('reading');
    };
  }, [reading]);
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
      // The question and its reply appear at the end of the conversation: follow it there, never open at the top.
      follow.current = true;
      requestAnimationFrame(() => {
        const el = scroller.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
      void run('', () =>
        projectsApi.send(currentProject(id) ?? project, {
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
        putProject(value);
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
        let current = currentProject(id) ?? project;
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
    // The same message runs again; it is not posted a second time.
    await run('', () => projectsApi.send(project, { text: last.text, assets: last.assets, retry: true }));
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
        .choose(id, { reference: name, asset })
        .then(p => {
          putProject(p);
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
    // Several set-aside drafts come back together as one plan.
    onBringBackAll: (cards: ChatCard[]) =>
      needsNewPlan('Bring back', async () => {
        await run('', async () => {
          let view: Awaited<ReturnType<typeof projectsApi.restore>> | undefined;
          for (const [i, card] of cards.entries()) {
            const {
              workflow: _w,
              mode: _m,
              resolved_seeds: _s,
              ...request
            } = latest(card).request as never as Record<string, unknown>;
            view = await projectsApi.restore(id, card.id, latest(card).number, request, i > 0);
          }
          return view!;
        });
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
  // A plan that failed to display cannot be approved blind: Make waits until it shows again.
  const [hiddenPlan, setHiddenPlan] = useState<string | null>(null);
  const planReady = plan && plan.state === 'reviewing' && !replying && hiddenPlan !== plan.id;
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
        ? `Make ${makeNoun} without the attached image`
        : 'Make without the attached image'
      : openChecks.every(c => c.code === 'shape')
        ? (() => {
            const shapes = [...new Set(selectedCards.map(c => latest(c).request.output.aspect))];
            return shapes.length === 1 ? 'Make ' + makeNoun + ' at ' + shapes[0] : 'Make ' + makeNoun + ' as drafted';
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
              void run('', () => projectsApi.send(currentProject(id) ?? project, { text, assets: [] }));
            }}
            onChanged={putProject}
          />
        ) : (
          <div className={split ? 'split' : 'single'}>
            <div className={'convo' + (reading ? ' reading' : '')}>
              {project && (project.messages.length > 0 || project.brief) && (
                <BriefBar
                  project={project}
                  busy={replying || Boolean(busy)}
                  onSaved={putProject}
                  openDrafts={plan?.cards.length ?? 0}
                  onUpdateDrafts={() =>
                    void run('', () =>
                      projectsApi.send(currentProject(id) ?? project, {
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
                // Only the person's own scrolling counts: following new replies, or the bars tucking away (which
                // resizes this area), must never toggle reading mode, or the bars would flicker in a loop.
                onTouchMove={() => (userScroll.current = Date.now())}
                onWheel={() => (userScroll.current = Date.now())}
                onKeyDown={() => (userScroll.current = Date.now())}
                onScroll={e => {
                  const el = e.currentTarget;
                  follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                  // Phones: reading down tucks the brief bar away; any scroll up (or reaching the top) shows it again.
                  if (app.narrow && Date.now() - userScroll.current < 600) {
                    const delta = el.scrollTop - lastScroll.current;
                    if (Math.abs(delta) > 12) setReading(delta > 0 && el.scrollTop > 120);
                  } else if (el.scrollTop <= 120) setReading(false);
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
                          note={
                            item.type === 'message'
                              ? undefined
                              : 'Your drafts are saved; Make waits until the plan shows again.'
                          }
                          onFailed={
                            item.type === 'message'
                              ? undefined
                              : failed => {
                                  const g = item.group.id;
                                  setHiddenPlan(h => (failed ? g : h === g ? null : h));
                                }
                          }
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
                                  projectsApi.send(currentProject(id) ?? project, {
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
                    castApproved={approvedReferences(project?.choices).length > 0}
                    mode={mode}
                    onMode={m => {
                      setMode(m);
                      if (m === 'make' && context.type !== 'using') setContext({ type: plan ? 'plan' : 'talk' });
                      if (m === 'make' && context.type === 'using' && context.intent !== 'input')
                        setSettings({ ...settings, kind: context.intent === 'animate' ? 'animate' : 'edit' });
                      // An attached image with words-only Image chosen: Make now edits the image instead of refusing it.
                      else if (
                        m === 'make' &&
                        (settings.kind === 'image' || settings.kind === 'video') &&
                        attachments.some(x => x.kind === 'image')
                      )
                        setSettings({ ...settings, kind: settings.kind === 'video' ? 'animate' : 'edit' });
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
                  void run('', () => projectsApi.send(currentProject(id) ?? project, { text, assets: [] }))
                }
                onChanged={putProject}
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
            The waiting drafts stay listed under “Not run · kept as drafts” with their settings, and Move back to the
            plan returns any of them. Nothing is made or deleted, and your message is kept.
          </p>
        </Dialog>
      )}
      {renaming && project && (
        <RenameDialog
          project={project}
          onClose={() => setRenaming(false)}
          onSaved={p => {
            putProject(p);
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
