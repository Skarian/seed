import { Agent, type AgentTool, type AgentMessage } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';

export const CHAT_MODEL = 'google/gemma-4-31b-it';
export interface ChatAccounting {
  id: string | null;
  provider: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
}

// Static prices are deliberately not used for charged-cost reporting.
const model: Model<'openai-completions'> = {
  id: CHAT_MODEL, name: 'Gemma 4 31B', api: 'openai-completions',
  provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1',
  reasoning: true, input: ['text', 'image'], contextWindow: 262144,
  maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

/** Observe accounting while forwarding the original SSE bytes without buffering the response. */
function accountingFetch(transport: typeof fetch, report: (value: ChatAccounting) => void): typeof fetch {
  return async (input, init) => {
    const response = await transport(input, init);
    if (!response.body || !response.ok) return response;
    const decoder = new TextDecoder();
    let pending = '';
    const value: ChatAccounting = { id: null, provider: null, inputTokens: null, outputTokens: null, cost: null };
    let lastReport='';
    const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
    const observe = (line: string) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
      try {
        const chunk = JSON.parse(data);
        if (typeof chunk.id === 'string') value.id = chunk.id;
        if (typeof chunk.provider === 'string') value.provider = chunk.provider;
        if (chunk.usage) {
          value.inputTokens = number(chunk.usage.prompt_tokens) ?? value.inputTokens;
          value.outputTokens = number(chunk.usage.completion_tokens) ?? value.outputTokens;
          value.cost = number(chunk.usage.cost) ?? value.cost;
        }
        const encoded=JSON.stringify(value);
        if(encoded!==lastReport){lastReport=encoded;report({ ...value });}
      } catch { /* The provider adapter handles malformed protocol content. */ }
    };
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(bytes, controller) {
        pending += decoder.decode(bytes, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) observe(line);
        if (pending.length > 1024 * 1024) throw new Error('Provider event exceeds size limit.');
        controller.enqueue(bytes);
      },
      flush() { observe(pending + decoder.decode()); },
    }));
    return new Response(body, { status: response.status, headers: response.headers });
  };
}

export function createChatAgent(options: {
  apiKey: string;
  systemPrompt: string;
  messages?: AgentMessage[];
  tool?: AgentTool;
  reasoning?: boolean;
  maxTokens?: number;
  fetch?: typeof fetch;
  onAccounting?: (value: ChatAccounting) => void;
}) {
  if (!options.apiKey.trim()) throw new Error('Configure an OpenRouter key using Seed setup.');
  let turns = 0;
  return new Agent({
    initialState: {
      model, systemPrompt: options.systemPrompt, messages: options.messages ?? [],
      tools: options.tool ? [options.tool] : [], thinkingLevel: options.reasoning === false ? 'off' : 'medium',
    },
    toolExecution: 'sequential',
    streamFn: (_model, context, streamOptions) => {
      if (++turns > 8) throw new Error('Agent turn limit reached. Send another message to continue.');
      return streamSimple(model, context, {
        ...streamOptions, apiKey: options.apiKey, maxTokens: options.maxTokens??8192,
        maxRetries: 0, timeoutMs: 600_000,
        fetch: accountingFetch(options.fetch ?? fetch, options.onAccounting ?? (() => {})),
        onPayload(payload) {
          const body = payload as Record<string, unknown>;
          // OpenRouter's strict parameter routing uses max_tokens and does not
          // advertise OpenAI's response-storage parameter for these endpoints.
          body.max_tokens = body.max_completion_tokens ?? 8192;
          delete body.max_completion_tokens;
          delete body.store;
          body.provider = { order: ['parasail'], allow_fallbacks: true, require_parameters: true };
          body.reasoning = { enabled: options.reasoning !== false };
          delete body.reasoning_effort;
          body.stream_options = { include_usage: true };
          return body;
        },
      });
    },
  });
}
