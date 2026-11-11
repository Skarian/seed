/** Scrolling of the conversation: follow new content unless the user scrolled up, jump to and highlight a flashed
 * group, and on phones tuck the bars away while the user reads down. */
import { useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react';
import type { Project } from '../api.js';
import { jobPhase } from '../../../shared/jobs.js';

export function useConversationScroll(project: Project | null, view: string, focus?: string, narrow = false) {
  const scroller = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const [flash, setFlash] = useState<string | undefined>(focus);
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
  const signature = project
    ? [
        project.messages.length,
        project.messages.at(-1)?.text.length,
        project.groups.map(g => g.state + g.cards.map(c => c.revisions.length).join()).join(),
        project.jobs.filter(j => jobPhase(j) === 'completed').length,
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

  /** Follow from now on and go to the end, where a new question and its reply appear. */
  function followToEnd() {
    follow.current = true;
    requestAnimationFrame(() => {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
  // Only the person's own scrolling counts: following new replies, or the bars tucking away (which
  // resizes this area), must never toggle reading mode, or the bars would flicker in a loop.
  const touched = () => (userScroll.current = Date.now());
  const scrollProps = {
    ref: scroller,
    onTouchMove: touched,
    onWheel: touched,
    onKeyDown: touched,
    onScroll: (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      // Phones: reading down tucks the brief bar away; any scroll up (or reaching the top) shows it again.
      if (narrow && Date.now() - userScroll.current < 600) {
        const delta = el.scrollTop - lastScroll.current;
        if (Math.abs(delta) > 12) setReading(delta > 0 && el.scrollTop > 120);
      } else if (el.scrollTop <= 120) setReading(false);
      lastScroll.current = el.scrollTop;
    },
  };
  return { flash, setFlash, reading, follow, followToEnd, scrollProps };
}
