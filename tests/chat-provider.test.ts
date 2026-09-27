import { describe, it, expect } from 'vitest';
import { Type } from '@earendil-works/pi-ai';
import { createChatAgent, explainToolValidation, CHAT_MODEL, type ChatAccounting } from '../server/chat/provider.js';

function response(chunks: unknown[]) {
  return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } });
}
const done = { id: 'gen-test', provider: 'Fallback provider', choices: [{ index: 0, delta: { content: 'Ready' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, cost: 0.00042 } };

describe('Seed Pi/OpenRouter integration', () => {
  it('sends zero tools before activation and explicitly disables reasoning', async () => {
    const requests: any[] = [];
    const accounting: ChatAccounting[] = [];
    const agent = createChatAgent({ apiKey: 'fake', systemPrompt: 'Chat', reasoning: false,
      onAccounting: value => accounting.push(value),
      fetch: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return response([done]); },
    });
    await agent.prompt('Hello');
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe(CHAT_MODEL);
    expect(requests[0].max_tokens).toBe(8192);
    expect(requests[0]).not.toHaveProperty('max_completion_tokens');
    expect(requests[0]).not.toHaveProperty('store');
    expect(requests[0].tools ?? []).toHaveLength(0);
    expect(requests[0].reasoning).toEqual({ enabled: false });
    expect(requests[0].provider).toEqual({ order: ['parasail'], allow_fallbacks: true, require_parameters: true });
    expect(accounting.at(-1)).toEqual({ id: 'gen-test', provider: 'Fallback provider', inputTokens: 20, outputTokens: 5, cost: 0.00042 });
  });

  it('replays images and tool results while exposing exactly one workflow tool', async () => {
    const requests: any[] = [];
    let executions = 0;
    const agent = createChatAgent({ apiKey: 'fake', systemPrompt: 'Workflow guide',
      tool: { name: 'prepare_video', label: 'Video', description: 'Prepare a review card',
        parameters: Type.Object({ prompt: Type.String() }),
        execute: async () => { executions++; return { content: [{ type: 'text', text: 'revision-1' }], details: {} }; },
      },
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return requests.length === 1 ? response([{ id: 'gen-tool', choices: [{ index: 0, delta: {
          tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'prepare_video', arguments: '{"prompt":"Animate the image"}' } }],
        }, finish_reason: 'tool_calls' }] }]) : response([done]);
      },
    });
    await agent.prompt('Animate this', [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }]);
    expect(executions).toBe(1);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.tools).toHaveLength(1);
      expect(request.tools[0].function.name).toBe('prepare_video');
      expect(request.reasoning).toEqual({ enabled: true });
      expect(JSON.stringify(request.messages)).toContain('data:image/png;base64,aGVsbG8=');
    }
    expect(requests[1].messages.some((message: any) => message.role === 'tool' && message.content.includes('revision-1'))).toBe(true);
  });

  it('leaves missing accounting unknown and reports stream errors', async () => {
    const accounting: ChatAccounting[] = [];
    const agent = createChatAgent({ apiKey: 'fake', systemPrompt: 'Chat', onAccounting: v => accounting.push(v),
      fetch: async () => response([{ id: 'failed', error: { message: 'Provider unavailable', code: 503 } }]),
    });
    await agent.prompt('Hello');
    expect(agent.state.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'error' });
    expect(accounting.at(-1)?.cost).toBeNull();
  });

  it('aborts the outstanding HTTP request without retrying', async () => {
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    let calls = 0;
    const agent = createChatAgent({ apiKey: 'fake', systemPrompt: 'Chat',
      fetch: async (_url, init) => { calls++; started(); return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }); },
    });
    const pending = agent.prompt('Hello');
    await ready;
    agent.abort();
    await pending;
    expect(calls).toBe(1);
    expect(agent.state.messages.at(-1)).toMatchObject({ stopReason: 'aborted' });
  });
});

it('explains rejected enum choices without changing original tool evidence',()=>{
 const tool:any={name:'create_request',parameters:Type.Object({audio_output:Type.String({enum:['generated','silent']})})};
 const result:any={role:'toolResult',toolName:'create_request',isError:true,content:[{type:'text',text:'Validation failed for tool "create_request":\n  - audio_output: must be equal to one of the allowed values'}]};
 const explained=explainToolValidation([result],[tool]) as any[];
 expect(explained[0].content[1].text).toContain('"enum":["generated","silent"]');
 expect(explained[0].content[1].text).toContain('"saved":false');
 expect(result.content).toHaveLength(1);
 expect(explainToolValidation([{...result,isError:false}],[tool])[0]).toEqual({...result,isError:false});
});
