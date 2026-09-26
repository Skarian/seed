import type { ChatCard, ChatGroup, ChatRevision, ChatView } from '../shared/chat.js';

export type SubmissionStatus = {
  kind: 'replaced' | 'denied' | 'stopped' | 'revising' | 'preparing' | 'failed' | 'waiting' | 'review' | 'none';
  label: string;
  error?: string;
  next?: ChatCard;
  retryLabel?: string;
};

/** Presentation for requests before admission; linked jobs own execution status. */
export function submissionStatus(
  group: ChatGroup,
  card: ChatCard,
  revision: ChatRevision,
  activity: ChatView['activity'],
): SubmissionStatus {
  if (revision.job_ids.length) return { kind: 'none', label: '' };
  if (revision.number !== card.revisions.at(-1)?.number) return { kind: 'replaced', label: 'Replaced' };
  if (revision.decision === 'denied') return { kind: 'denied', label: 'Denied' };
  if (group.state === 'stopped') return { kind: 'stopped', label: 'Stopped' };
  if (group.state === 'revising') return { kind: 'revising', label: 'Revising…' };
  if (group.state !== 'reviewing') return { kind: 'none', label: '' };
  if (revision.decision === 'undecided') return { kind: 'review', label: '' };
  if (activity === 'preparing') return { kind: 'preparing', label: 'Preparing…' };

  const undecided = group.cards.filter(candidate => candidate.id !== card.id && candidate.revisions.at(-1)?.decision === 'undecided');
  if (undecided.length) {
    return {
      kind: 'waiting',
      label: `Waiting for ${undecided.length} other ${undecided.length === 1 ? 'decision' : 'decisions'}`,
      next: undecided[0],
    };
  }
  const approved = group.cards.filter(candidate => candidate.revisions.at(-1)?.decision === 'approved');
  return {
    kind: 'failed',
    label: 'Couldn’t start',
    error: group.submission_error || 'These approved requests did not start. Retry to continue.',
    retryLabel: approved.length > 1 ? 'Retry approved requests' : 'Retry start',
  };
}
