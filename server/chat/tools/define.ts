import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ChatRevision, ChatView } from '../../../shared/chat.js';
import type { Choice } from '../../../shared/choices.js';
import type { ImageRequest } from '../../workflows.js';
import type { Jobs } from '../../jobs.js';
import type { StoredChat } from '../model.js';
import type { ToolAsset } from '../request-tools.js';

/**
 * A tool call that did not work. `internal` marks Seed's own slip (a stale id, a run that ended): the owner is not
 * shown it when the turn otherwise got its work done. `extra` rides along for the agent (choices, a next step).
 */
export class ToolFailure extends Error {
  constructor(
    message: string,
    readonly extra: Record<string, unknown> = {},
    readonly internal = false,
  ) {
    super(message);
  }
}
/** What a failed call returns to the agent, and what the turn's outcome reads back. */
export type ToolFailureResult = { ok: false; error: string; internal?: true } & Record<string, unknown>;

/** What the tools may do to a project; the chat service provides it. */
export interface ToolHost {
  get(id: string): StoredChat;
  save(chat: StoredChat): void;
  choose(id: string, choice: Choice): ChatView;
  revision(chat: StoredChat, request: ImageRequest, number: number, sourceJobId?: string): ChatRevision;
  assertAssets(chat: StoredChat, ids: string[]): void;
  contextAssets(chat: StoredChat): Array<{ id: string; name: string }>;
  jobs: Jobs;
}
/** One agent turn's view of the project: which run it is, the inputs it can name, and what it has done so far. */
export interface ToolSession {
  host: ToolHost;
  id: string;
  epoch: number;
  runId: string;
  assets: ToolAsset[];
  /** The draft the owner asked about, until the turn changes it. */
  target?: string;
  /** Each draft's revision when the turn started (or last changed it): a newer one was changed by someone else. */
  snapshots: Map<string, number>;
  /** Who-is-who mix-ups already refused in this turn: never refused twice, so a turn cannot loop on them. */
  castWarned: Set<string>;
}
/** The project as this turn may change it: refused once the owner stopped the turn. */
export function current(session: ToolSession) {
  const chat = session.host.get(session.id);
  if (chat.epoch !== session.epoch) throw new ToolFailure('This run is no longer active.', {}, true);
  return chat;
}

/** An input handle the agent wrote ("input3", "[[input3]]") as the asset it names. */
export const namedInput = (session: ToolSession, handle: unknown) =>
  session.assets.find(
    a =>
      a.handle ===
      String(handle ?? '')
        .replace(/[[\]]/g, '')
        .trim(),
  );

/**
 * One of Seed's tools. `run` returns what the agent is told on success (`ok: true` is added); it throws ToolFailure
 * (or any error) when the call did not work.
 */
export function defineTool(spec: {
  name: string;
  label: string;
  description: string;
  properties?: Record<string, unknown>;
  required?: string[];
  /** A full schema instead of `properties` (the draft tools build theirs per kind of work). */
  parameters?: unknown;
  run: (input: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Shapes every failure instead (the draft tools list field problems). */
  failure?: (error: unknown) => Record<string, unknown>;
}): AgentTool {
  return {
    name: spec.name,
    label: spec.label,
    description: spec.description,
    parameters: (spec.parameters ?? {
      type: 'object',
      additionalProperties: false,
      properties: spec.properties ?? {},
      required: spec.required ?? Object.keys(spec.properties ?? {}),
    }) as AgentTool['parameters'],
    execute: async (_call, raw) => {
      try {
        const result = { ok: true, ...(await spec.run((raw ?? {}) as Record<string, unknown>)) };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
      } catch (error) {
        const failed: Record<string, unknown> = spec.failure
          ? spec.failure(error)
          : error instanceof ToolFailure
            ? { ok: false, error: error.message, ...error.extra, ...(error.internal ? { internal: true } : {}) }
            : { ok: false, error: error instanceof Error ? error.message : String(error) };
        throw Error(JSON.stringify(failed));
      }
    },
  };
}
