import { castFromBrief, castOf, mergeCast, briefWithCast, sameCast } from '../../../shared/cast.js';
import { now } from '../model.js';
import { current, defineTool, ToolFailure, type ToolSession } from './define.js';

/** The brief is the project's lasting memory; Seed rewrites it whole when the person settles something lasting. */
export function briefTool(session: ToolSession, manifest: Array<{ id: string; name: string }>) {
  return defineTool({
    name: 'update_brief',
    label: 'Update brief',
    description:
      'Replace the project brief with an updated version. Use it when the user settles something lasting: the story, characters (exact look and wardrobe), locations, the visual look, always/never rules, the deliverables and the shot list. Send the whole brief as short Markdown, with a "## " heading for each section that applies: Story, Characters, Locations, Look, Rules, Shots. Number the shots. Keep what the user decided; do not invent details. It does not change drafts or generate anything.',
    properties: { brief: { type: 'string', maxLength: 8000 } },
    run: input => {
      const chat = current(session);
      // The brief is read by people: input handles ("input1", "[[input2]]") become the images' names.
      const handleName = new Map(session.assets.map(a => [a.handle, manifest.find(m => m.id === a.asset_id)?.name]));
      const text = String(input.brief ?? '')
        .replace(/\[\[\s*(input\d+)\s*\]\]|\b(input\d+)\b/gi, (whole, a?: string, b?: string) => {
          const name = handleName.get((a ?? b ?? '').toLowerCase());
          return name ? `“${name}”` : whole;
        })
        .trim();
      if (!text || text.length > 8000) throw new ToolFailure('Send the whole brief, 1-8000 characters.');
      // The cast is a record: the brief adds to it and updates looks, but leaving a name out does not remove it.
      const before = castOf(chat),
        listed = castFromBrief(text);
      chat.cast = mergeCast(before, text);
      const added = chat.cast.filter(e => !before.some(x => x.name.toLowerCase() === e.name.toLowerCase()));
      const kept = chat.cast.filter(
        e => !listed.some(x => x.name.toLowerCase() === e.name.toLowerCase() || sameCast(x.name, e.name)),
      );
      chat.brief = briefWithCast(text, chat.cast);
      chat.brief_updated_by = 'seed';
      chat.brief_updated_at = now();
      session.host.save(chat);
      return {
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
    },
  });
}
