import { strict as assert } from 'assert';
import type { ChatCompletionMessageParam } from 'openai/resources';
import { getMockSdk } from './helpers/mock-sdk';
import { installMockConfig } from './helpers/mock-config';
import { PoeChatAPI, listAvailablePoeModels, __setPoeBackoffForTests } from '../poe-utils';
import { ConfigKeys } from '../config';

const openai = getMockSdk('openai');

const baseMessages: ChatCompletionMessageParam[] = [
  { role: 'system', content: 'You write commit messages.' },
  { role: 'user', content: 'diff content' }
];

// Helper: stub `fetch` for the lifetime of a test to control Poe's
// /v1/models and /v1/responses endpoints.
function stubFetch(handlers: Record<string, (init: RequestInit) => Promise<Response> | Response>) {
  const original = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) {
        return Promise.resolve(handler(init ?? {}));
      }
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  }) as typeof fetch;
  return () => {
    (globalThis as { fetch: typeof fetch }).fetch = original;
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('PoeChatAPI', () => {
  let cfg: ReturnType<typeof installMockConfig>;
  let restoreFetch: () => void;

  beforeEach(() => {
    openai.reset();
    cfg = installMockConfig();
    cfg.set(ConfigKeys.POE_API_KEY, 'poe-test-key');
    cfg.set(ConfigKeys.POE_MODEL, 'Claude-Sonnet-4.5');
    cfg.set(ConfigKeys.POE_TEMPERATURE, 0.7);
    cfg.set(ConfigKeys.REASONING_MODE, 'balanced');
  });

  afterEach(() => {
    cfg.restore();
    if (restoreFetch) restoreFetch();
  });

  describe('Chat Completions path (model without /v1/responses)', () => {
    beforeEach(() => {
      // Model with no supported_endpoints → falls through to Chat Completions
      restoreFetch = stubFetch({
        '/v1/models': () =>
          jsonResponse({
            data: [
              {
                id: 'claude-haiku-4.5',
                supported_endpoints: ['/v1/chat/completions']
              }
            ]
          })
      });
      cfg.set(ConfigKeys.POE_MODEL, 'claude-haiku-4.5');
    });

    it('routes to Chat Completions and sends temperature for fast mode', async () => {
      cfg.set(ConfigKeys.REASONING_MODE, 'fast');
      const result = await PoeChatAPI(baseMessages);
      assert.equal(result, 'commits: mock poe chat');
      assert.equal(openai.calls.length, 1);
      const payload = openai.calls[0].kwargs as Record<string, unknown>;
      assert.equal(payload.model, 'claude-haiku-4.5');
      assert.equal(payload.temperature, 0.7);
      assert.equal('extra_body' in payload, false, 'no thinking params → no extra_body');
    });

    it('sends extra_body with boolean thinking flags when model declares them', async () => {
      restoreFetch = stubFetch({
        '/v1/models': () =>
          jsonResponse({
            data: [
              {
                id: 'claude-haiku-4.5',
                supported_endpoints: ['/v1/chat/completions'],
                parameters: [
                  { name: 'enable_thinking', schema: { type: 'boolean' } },
                  { name: 'thinking_budget', schema: { type: 'integer', maximum: 32000 } }
                ]
              }
            ]
          })
      });
      cfg.set(ConfigKeys.REASONING_MODE, 'balanced');
      await PoeChatAPI(baseMessages);
      const payload = openai.calls[0].kwargs as { extra_body?: Record<string, unknown> };
      assert.ok(payload.extra_body, 'extra_body should be present for non-auto mode with declared params');
      assert.equal(payload.extra_body!.enable_thinking, true);
      // balanced = 0.55 ratio of 32000 = 17600
      assert.equal(payload.extra_body!.thinking_budget, 17600);
    });

    it('picks the best enum match for thinking_level on fast mode', async () => {
      restoreFetch = stubFetch({
        '/v1/models': () =>
          jsonResponse({
            data: [
              {
                id: 'claude-haiku-4.5',
                supported_endpoints: ['/v1/chat/completions'],
                parameters: [
                  { name: 'thinking_level', schema: { type: 'string', enum: ['minimal', 'standard', 'high'] } }
                ]
              }
            ]
          })
      });
      cfg.set(ConfigKeys.REASONING_MODE, 'fast');
      await PoeChatAPI(baseMessages);
      const payload = openai.calls[0].kwargs as { extra_body?: Record<string, unknown> };
      assert.equal(payload.extra_body?.thinking_level, 'minimal');
    });
  });

  describe('Responses API path', () => {
    beforeEach(() => {
      restoreFetch = stubFetch({
        '/v1/models': () =>
          jsonResponse({
            data: [
              {
                id: 'gpt-5',
                supported_endpoints: ['/v1/chat/completions', '/v1/responses']
              }
            ]
          })
      });
      cfg.set(ConfigKeys.POE_MODEL, 'gpt-5');
    });

    it('routes to Responses API and sends reasoning.effort for balanced mode', async () => {
      const responsesCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
      restoreFetch = stubFetch({
        '/v1/models': () =>
          jsonResponse({
            data: [
              {
                id: 'gpt-5',
                supported_endpoints: ['/v1/chat/completions', '/v1/responses']
              }
            ]
          }),
        '/v1/responses': (init) => {
          const body = JSON.parse(init.body as string) as Record<string, unknown>;
          responsesCalls.push({ url: 'https://api.poe.com/v1/responses', body });
          return jsonResponse({ output_text: 'commits: mock poe response' });
        }
      });
      cfg.set(ConfigKeys.REASONING_MODE, 'balanced');
      const result = await PoeChatAPI(baseMessages);
      assert.equal(result, 'commits: mock poe response');
      assert.equal(responsesCalls.length, 1);
      assert.equal(responsesCalls[0].body.model, 'gpt-5');
      const reasoning = responsesCalls[0].body.reasoning as { effort: string };
      assert.equal(reasoning.effort, 'medium');
      // Reasoning active → no temperature
      assert.equal('temperature' in responsesCalls[0].body, false);
    });

    it('sends temperature for auto mode (no reasoning active)', async () => {
      let capturedBody: Record<string, unknown> = {};
      restoreFetch = stubFetch({
        '/v1/models': () =>
          jsonResponse({
            data: [
              {
                id: 'gpt-5',
                supported_endpoints: ['/v1/chat/completions', '/v1/responses']
              }
            ]
          }),
        '/v1/responses': (init) => {
          capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
          return jsonResponse({ output_text: 'commits: auto' });
        }
      });
      cfg.set(ConfigKeys.REASONING_MODE, 'auto');
      await PoeChatAPI(baseMessages);
      assert.equal('reasoning' in capturedBody, false, 'auto mode should not send reasoning field');
      assert.equal(capturedBody.temperature, 0.7);
    });

    it('extracts text from output[].content[].text when output_text is missing', async () => {
      restoreFetch = stubFetch({
        '/v1/models': () =>
          jsonResponse({
            data: [
              {
                id: 'gpt-5',
                supported_endpoints: ['/v1/chat/completions', '/v1/responses']
              }
            ]
          }),
        '/v1/responses': () =>
          jsonResponse({
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: 'commits: from output array' }]
              }
            ]
          })
      });
      cfg.set(ConfigKeys.REASONING_MODE, 'auto');
      const result = await PoeChatAPI(baseMessages);
      assert.equal(result, 'commits: from output array');
    });

    it('throws when the response has no extractable text', async () => {
      restoreFetch = stubFetch({
        '/v1/models': () =>
          jsonResponse({
            data: [
              {
                id: 'gpt-5',
                supported_endpoints: ['/v1/chat/completions', '/v1/responses']
              }
            ]
          }),
        '/v1/responses': () => jsonResponse({ output: [] })
      });
      cfg.set(ConfigKeys.REASONING_MODE, 'auto');
      await assert.rejects(() => PoeChatAPI(baseMessages), /Poe Responses API returned empty content/);
    });
  });

  describe('error handling & retry', () => {
    it('throws on 401 immediately without retry', async () => {
      restoreFetch = stubFetch({
        '/v1/models': () =>
          jsonResponse({
            data: [
              {
                id: 'gpt-5',
                supported_endpoints: ['/v1/chat/completions', '/v1/responses']
              }
            ]
          }),
        '/v1/responses': () => new Response('unauthorized', { status: 401 })
      });
      cfg.set(ConfigKeys.POE_MODEL, 'gpt-5');
      cfg.set(ConfigKeys.REASONING_MODE, 'auto');
      await assert.rejects(
        () => PoeChatAPI(baseMessages),
        /Invalid Poe API key or unauthorized access/
      );
    });

    it('retries on 429 then throws rate-limit message', async () => {
      __setPoeBackoffForTests({ initialMs: 1, jitterMs: 0 });
      let calls = 0;
      restoreFetch = stubFetch({
        '/v1/models': () =>
          jsonResponse({
            data: [
              {
                id: 'gpt-5',
                supported_endpoints: ['/v1/chat/completions', '/v1/responses']
              }
            ]
          }),
        '/v1/responses': () => {
          calls += 1;
          return new Response('rate limited', { status: 429 });
        }
      });
      cfg.set(ConfigKeys.POE_MODEL, 'gpt-5');
      cfg.set(ConfigKeys.REASONING_MODE, 'auto');
      await assert.rejects(
        () => PoeChatAPI(baseMessages),
        /Poe API rate limit exceeded/
      );
      // 1 initial + 3 retries = 4 total
      assert.equal(calls, 4);
    });

    it('does not retry on AbortError', async () => {
      const controller = new AbortController();
      controller.abort();
      restoreFetch = stubFetch({
        '/v1/models': () =>
          jsonResponse({
            data: [
              {
                id: 'gpt-5',
                supported_endpoints: ['/v1/chat/completions', '/v1/responses']
              }
            ]
          })
      });
      cfg.set(ConfigKeys.POE_MODEL, 'gpt-5');
      await assert.rejects(
        () => PoeChatAPI(baseMessages, { signal: controller.signal }),
        (err: Error & { name?: string }) => err.name === 'AbortError'
      );
    });
  });
});

describe('listAvailablePoeModels', () => {
  let cfg: ReturnType<typeof installMockConfig>;
  let restoreFetch: () => void;

  beforeEach(() => {
    cfg = installMockConfig();
    cfg.set(ConfigKeys.POE_API_KEY, 'poe-test-key');
  });

  afterEach(() => {
    cfg.restore();
    if (restoreFetch) restoreFetch();
  });

  it('returns a sorted, deduplicated list of model IDs', async () => {
    restoreFetch = stubFetch({
      '/v1/models': () =>
        jsonResponse({
          data: [
            { id: 'zeta' },
            { id: 'alpha' },
            { id: 'beta' },
            { id: 'alpha' } // duplicate
          ]
        })
    });
    const models = await listAvailablePoeModels();
    assert.deepEqual(models, ['alpha', 'beta', 'zeta']);
  });

  it('throws when API call fails', async () => {
    restoreFetch = stubFetch({
      '/v1/models': () => new Response('server error', { status: 500 })
    });
    await assert.rejects(
      () => listAvailablePoeModels(),
      /Poe models.list failed: 500/
    );
  });
});
