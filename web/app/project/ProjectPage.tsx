import { useEffect, useMemo, useRef, useState } from 'react';
import {
  projects as projectsApi,
  randomKey,
  kindOf,
  isVideoKind,
  type ChatCard,
  type ChatGroup,
  type ImageRequest,
  type Project,
} from '../api.js';
import { currentProject, putProject, useApp, useProject, useStoredState } from '../data.js';
import { Confirm, Dialog, cleanReply, LocalBoundary } from '../ui.js';
import { latest, titleOf, outputNoun, plural, estimateSeconds, estimateText, assetName } from '../format.js';
import { PlanCard } from './PlanCard.js';
import { ResultGroup } from './ResultGroup.js';
import { Composer } from './Composer.js';
import { ComputeSheet } from './ComputeSheet.js';
import { ResultsView } from './ResultsView.js';
import { approvedReferences } from '../../../shared/choices.js';
import { readiness } from './readiness.js';
import { buildRequest, type Attachment, type MakeSettings } from './requests.js';
import { useStyles } from './styles.js';
import { BriefBar } from './Brief.js';
import { Header, RenameDialog, EmptyProject } from './ProjectHeader.js';
import { Message } from './Message.js';
import { isOpenPlan, buildTimeline, lastUserMessage, titleFromPrompt, checkRequest } from './timeline.js';
import { revisable } from './plan.js';
import { planMoved, planSeconds, planStatus } from './planStatus.js';
import { useComposerState } from './useComposerState.js';
import { useConversationScroll } from './useConversationScroll.js';
import * as drafts from './drafts.js';

/** One project: the conversation or its results, the composer and make bar, and the dialogs they open. */
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
  const composer = useComposerState(id, plan);
  const { text, setText, mode, setMode, settings, setSettings, attachments, setAttachments, context, setContext } =
    composer;
  const { flash, setFlash, reading, follow, followToEnd, scrollProps } = useConversationScroll(
    project,
    view,
    focus,
    app.narrow,
  );
  const [compute, setCompute] = useState<null | {
    role: 'image' | 'video';
    action: string;
    seconds?: number | null;
    then: () => Promise<void>;
  }>(null);
  const [conflict, setConflict] = useState<null | { label: string; run: () => Promise<void> }>(null);
  const [confirmDelete, setConfirmDelete] = useState(false),
    [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(''),
    [problem, setProblem] = useState(''),
    [typing, setTyping] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const focusComposer = () => setFocusToken(t => t + 1);
  /** Puts words in the message box, ready to change and send. */
  const draftText = (words: string) => {
    setText(words);
    focusComposer();
  };
  const lastSent = useRef<{ text: string; assets: string[] } | null>(null);

  // A result handed over from elsewhere (viewer, Library, compare).
  useEffect(() => {
    const use = app.pendingUse;
    if (!use || !project) return;
    if (use.item.project && use.item.project !== id) return;
    app.clearPendingUse();
    if (use.intent === 'more' || use.intent === 'reuse') {
      const card = project.groups.flatMap(g => g.cards).find(c => c.id === use.item.job?.source?.card_id);
      if (card) (use.intent === 'more' ? actions.onVariations : actions.onReuse)(card);
      return;
    }
    if (use.intent === 'check') {
      // The question and its reply appear at the end of the conversation: follow it there, never open at the top.
      followToEnd();
      void run('', () =>
        projectsApi.send(currentProject(id) ?? project, { text: checkRequest(use.item), assets: [use.item.asset] }),
      );
      return;
    }
    // Use as input is a plain attachment: it can revise a waiting plan or start one, as the words say.
    if (use.intent === 'input')
      setAttachments(list =>
        list.some(a => a.asset_id === use.item.asset)
          ? list
          : [...list, { key: use.item.asset, asset_id: use.item.asset, name: use.item.title, kind: use.item.kind }],
      );
    else {
      setContext({ type: 'using', item: use.item, intent: use.intent });
      // Keep the chosen source visibly anchored: highlight it where it lives in the stream.
      const source = use.item.job?.source?.card_id;
      if (source && use.item.job?.source?.chat_id === id) setFlash(source);
      else followToEnd();
    }
    setMode('ask');
    focusComposer();
  }, [app.pendingUse, project?.id]);

  async function run(label: string, fn: () => Promise<Project | void>) {
    setBusy(label);
    setProblem('');
    try {
      const value = await fn();
      if (value) putProject(value);
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
  /** Sends a message written by one of Seed's own buttons. */
  const ask = (text: string) => run('', () => projectsApi.send(currentProject(id) ?? project!, { text, assets: [] }));
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
  /** Starts a direct make once a GPU can run it: a blocked request says why, a new rental asks for consent first. */
  async function whenReady(r: ImageRequest, count: number, go: () => Promise<void>) {
    const need = readiness(r, app.pool, styles);
    if (need.blocked) return setProblem(need.label);
    if (need.needs)
      setCompute({
        role: need.needs,
        action: 'make ' + outputNoun(r, count),
        seconds: estimateSeconds(project?.jobs ?? [], r.workflow, count),
        then: go,
      });
    else await go();
  }

  // A message written while Seed replies waits and sends itself when the reply ends (takes still rendering do not hold it).
  const [queued, setQueued] = useState(false);
  useEffect(() => {
    if (queued && project && !replying) {
      setQueued(false);
      if (text.trim()) void send();
    }
  }, [queued, replying, Boolean(project)]);
  async function send() {
    if (!project) return;
    const { body, assets, extra, kind } = drafts.outgoingMessage(context, text, attachments);
    // A plan can hold several kinds of work: an animation or edit of a result joins the waiting plan as its own draft.
    const addToPlan = context.type === 'using' && Boolean(plan);
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
  }
  async function retry() {
    const last = lastSent.current ?? lastUserMessage(project);
    if (!project || !last) return;
    // The same message runs again; it is not posted a second time.
    await run('', () => projectsApi.send(project, { text: last.text, assets: last.assets, retry: true }));
  }
  /** Puts a draft into Make: its words, settings and inputs, ready to change and run. */
  function loadMake(draft: { text: string; settings: MakeSettings; attachments: Attachment[] } | null) {
    if (!draft) return;
    setMode('make');
    setText(draft.text);
    setSettings(draft.settings);
    setAttachments(draft.attachments);
    focusComposer();
  }

  /** Make directly from the composer: approved as written, runs at once (after GPU consent if needed). */
  async function makeDirect() {
    if (!project) return;
    const inputs = drafts.directInputs(settings.kind, attachments, context);
    const request = buildRequest(settings, text, inputs, titleFromPrompt(text)) as unknown as ImageRequest;
    const key = randomKey();
    await whenReady(request, settings.count, async () => {
      const ok = await run('Starting', () => projectsApi.makeDirect(id, request, key));
      if (ok) {
        setText('');
        setAttachments([]);
        if (context.type === 'using') setContext({ type: plan ? 'plan' : 'talk' });
      }
    });
  }

  const readyOf = (c: ChatCard) => readiness(latest(c).request, app.pool, styles);
  const status = plan && project && planStatus(project, plan, composer.selection, composer.acknowledged, readyOf);
  // A mixed plan makes its images first; clips, which take minutes each, get their own Make all.
  const mixed = Boolean(status && status.clips > 0 && status.images > 0);
  const imagesFirst = mixed && status && !status.planStale && !status.question && !status.unresolved;
  /** Make the open plan: one decision for every draft, after GPU consent if a new rental is needed. */
  async function makePlan(only?: 'image') {
    if (!plan || !status) return;
    // "Make 2 images" in a mixed plan leaves its clips saved (Bring back) instead of making them.
    const chosen = status.selectedCards.filter(c => !only || !isVideoKind(kindOf[latest(c).request.workflow]));
    if (!chosen.length) return;
    const decisions = plan.cards.map(c => ({
      card: c.id,
      revision: latest(c).number,
      decision: chosen.includes(c) ? ('approved' as const) : ('denied' as const),
    }));
    const go = async () => {
      // Seed may have revised the plan while the GPU question was open: make only the drafts the owner saw.
      if (planMoved(currentProject(id)?.groups.find(g => g.id === plan.id), decisions)) {
        setProblem('Seed changed the plan while you were deciding. Check the drafts, then choose Make again.');
        setFlash(plan.id);
        return;
      }
      const ok = await run('Making', () => projectsApi.decide(id, plan.id, decisions));
      if (ok) setFlash(plan.id);
    };
    // A plan can mix kinds: ask for each kind of GPU it needs in turn (image first), then make everything at once.
    const roles = [...new Set(chosen.map(c => readyOf(c).needs).filter((r): r is 'image' | 'video' => !!r))].sort();
    const askFor = async (i: number): Promise<void> => {
      const role = roles[i];
      if (!role) return go();
      const these = chosen.filter(c => readyOf(c).needs === role);
      const outputs = these.reduce((n, c) => n + latest(c).request.count, 0);
      setCompute({
        role,
        action:
          'make ' +
          outputNoun(latest(these[0]!).request, outputs) +
          (roles.length > 1 && i === 0 ? ' (the clips need a video GPU next)' : ''),
        seconds: planSeconds(project?.jobs ?? [], these),
        then: () => askFor(i + 1),
      });
    };
    await askFor(0);
  }

  /** More like this, Retry and Make again run at once as direct makes: no new plan, no extra Make, no conflict with an open plan. */
  function remake(card: ChatCard, how: 'more' | 'retry' | 'cancelled' | 'again') {
    if (!project) return;
    const request = drafts.remakeRequest(project, card, how);
    void whenReady(latest(card).request, request.count, async () => {
      await run('Starting', () => projectsApi.makeDirect(id, request, randomKey()));
    });
  }
  const restore = (card: ChatCard, join = false) =>
    projectsApi.restore(id, card.id, latest(card).number, revisable(latest(card).request), join);
  const actions = {
    onVariations: (card: ChatCard) => remake(card, 'more'),
    onRetryFailed: (card: ChatCard) => remake(card, 'retry'),
    onMakeAgain: (card: ChatCard) => remake(card, 'again'),
    onRedoCancelled: (card: ChatCard) => remake(card, 'cancelled'),
    // Load a result's exact prompt and settings into Make, to change one thing and run it.
    onReuse: (card: ChatCard) => project && loadMake(drafts.reuseDraft(card, project, app.tasks, settings)),
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
        await run('', () => restore(card));
      }),
    // Several set-aside drafts come back together as one plan.
    onBringBackAll: (cards: ChatCard[]) =>
      needsNewPlan('Bring back', async () => {
        await run('', async () => {
          let view: Project | undefined;
          for (const [i, card] of cards.entries()) view = await restore(card, i > 0);
          return view!;
        });
      }),
  };

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
  // A plan that failed to display cannot be approved blind: Make waits until it shows again.
  const [hiddenPlan, setHiddenPlan] = useState<string | null>(null);
  const planReady = plan && plan.state === 'reviewing' && !replying && hiddenPlan !== plan.id;
  const seconds = status?.selectedCards.length ? planSeconds(project!.jobs, status.selectedCards) : null;
  // On wide screens the board sits beside the conversation once there are results, unless the person turned that off.
  const [beside, setBeside] = useStoredState('seed.board.beside', false);
  const canSplit = app.split && Boolean(project?.jobs.length),
    split = canSplit && beside;

  // Without a project the header has nothing to rename, delete or split.
  const header = (
    <Header
      project={project}
      view={view}
      split={split}
      canSplit={canSplit}
      onBeside={setBeside}
      onRename={() => setRenaming(true)}
      onDelete={() => setConfirmDelete(true)}
    />
  );
  if (error && !project)
    return (
      <>
        {header}
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
      {header}
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
              void ask(text);
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
                    void ask(
                      'I changed the brief. Update every open draft so it matches the brief now, change nothing else, and tell me exactly what changed in each one. Do not run anything.',
                    )
                  }
                />
              )}
              <div className="scroll" {...scrollProps}>
                <div className="col">
                  {!project ? (
                    <div className="stream">
                      <span className="statusline">
                        <span className="dot live" />
                        Opening…
                      </span>
                    </div>
                  ) : !timeline.length ? (
                    <EmptyProject making={mode === 'make'} onStarter={draftText} />
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
                                if (last) draftText(last.text);
                              }}
                              onContinue={() =>
                                void ask(
                                  'Continue where you stopped and finish the rest of my last request. Tell me what you finished.',
                                )
                              }
                              onMakeItMyself={() => loadMake(drafts.makeItMyselfDraft(project, settings, item.message))}
                            />
                          ) : isOpenPlan(item.group) ? (
                            <PlanCard
                              key={item.group.id}
                              project={project}
                              group={item.group}
                              snapshot={app.pool}
                              styles={styles}
                              busy={Boolean(busy) || replying}
                              selection={composer.selection}
                              onSelection={composer.setSelection}
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
                                focusComposer();
                              }}
                              onSetAside={() => void setAside(item.group)}
                              acknowledged={composer.acknowledged}
                              onAcknowledge={key => composer.setAcknowledged(s => new Set([...s, key]))}
                              onEditMyself={(card, ids) => {
                                // The draft becomes an edit of the attached image right where it is: same place in the
                                // plan, same title and words, the first image as its source and any others as references.
                                const edit = drafts.editOfImages(card, ids, project);
                                if (!edit) return;
                                void run('Saving', () =>
                                  projectsApi.revise(id, card.id, latest(card).number, edit.request),
                                ).then(ok => {
                                  if (ok)
                                    app.toast(
                                      `“${titleOf(latest(card).request)}” is now an edit of “${assetName(project, edit.images[0]!, app.tasks)}”. Edits keep the source’s shape.`,
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
                  {plan && status && (status.planStale || status.question) && (
                    <div className="notice" role="status" style={{ padding: '8px 12px', fontSize: '0.875rem' }}>
                      {status.planStale ? (
                        'Seed asked a question before changing the plan. The plan shows the earlier version until you answer.'
                      ) : (
                        <>Seed asked: “{status.question}” Answer below, or make the plan as it is.</>
                      )}
                    </div>
                  )}
                  {plan && status && !(app.narrow && typing) && (
                    <div className="makebar">
                      <button
                        className="sum"
                        onClick={() => {
                          const first = status.selectedCards[0];
                          if (first) setFlash(first.id);
                        }}
                        title="Show the selected drafts"
                      >
                        <b>
                          {plan.cards.length === 1 ? '' : 'Selected · '}
                          {status.makeNoun}
                        </b>
                        {plan.cards.length > 1
                          ? ` · ${status.selectedCards.length} of ${plan.cards.length} drafts`
                          : ''}
                        {seconds !== null ? ' · ' + estimateText(seconds) : ''}
                        {status.need?.billing
                          ? /whichever is free first/.test(status.need.label)
                            ? ' · Seed PC or the running cloud GPU'
                            : ' · on the running cloud GPU'
                          : status.need?.needs
                            ? ' · needs a GPU'
                            : ''}{' '}
                        ›
                      </button>
                      {imagesFirst && (
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
                        className={status.planStale || status.question || status.unresolved ? 'btn' : 'btn primary'}
                        disabled={!planReady || !status.selectedCards.length || Boolean(busy)}
                        onClick={() => void makePlan(imagesFirst ? 'image' : undefined)}
                      >
                        {busy === 'Making'
                          ? 'Starting…'
                          : replying
                            ? 'Seed is replying…'
                            : status.planStale
                              ? 'Make this earlier version'
                              : status.question
                                ? 'Make as it is'
                                : status.unresolved
                                  ? status.anyway
                                  : mixed
                                    ? 'Make ' + plural(status.images, 'image')
                                    : 'Make ' + status.makeNoun}
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
                      if (m !== 'make') return;
                      if (context.type !== 'using') setContext({ type: plan ? 'plan' : 'talk' });
                      const next = drafts.settingsForMake(context, settings, attachments);
                      if (next) setSettings(next);
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
              <ResultsView project={project} embedded onAsk={text => void ask(text)} onChanged={putProject} />
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
                onClick={async () => {
                  setConflict(null);
                  // The waiting drafts are set aside first: the server starts no new plan while one is open.
                  if (!plan || (await setAside())) await conflict.run();
                }}
              >
                Keep them and continue
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            <>{conflict.label} starts a new plan. </>
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
