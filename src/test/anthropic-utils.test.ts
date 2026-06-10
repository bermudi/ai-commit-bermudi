import { strict as assert } from 'assert';
import type { ChatCompletionMessageParam } from 'openai/resources';
import { getMockSdk } from './helpers/mock-sdk';
import { installMockConfig } from './helpers/mock-config';
import { AnthropicAPI } from '../anthropic-utils';
import { ConfigKeys } from '../config';

const anthropic = getMockSdk('@anthropic-ai/sdk');

const baseMessages: ChatCompletionMessageParam[] = [
  { role: 'system', content: 'You write commit messages.' },
  { role: 'user', content: 'src/file.ts: added foo' }
];

describe('AnthropicAPI', () => {
  let cfg: ReturnType<typeof installMockConfig>;

  beforeEach(() => {
    anthropic.reset();
    cfg = installMockConfig();
    cfg.set(ConfigKeys.ANTHROPIC_API_KEY, 'sk-ant-test-key');
  });

  afterEach(() => {
    cfg.restore();
  });

  it('throws when apiKey is missing', async () => {
    await assert.rejects(
      () => AnthropicAPI(baseMessages, { apiKey: '', reasoningMode: 'balanced' }),
      /Anthropic API key is required/
    );
  });

  it('throws when no usable messages are provided', async () => {
    await assert.rejects(
      () =>
        AnthropicAPI(
          [{ role: 'user', content: '' }],
          { apiKey: 'sk-ant-test-key', reasoningMode: 'balanced' }
        ),
      /No valid messages to send to Anthropic/
    );
  });

  describe('payload construction per reasoning mode', () => {
    it('deep mode: enables thinking with a budget, strips temperature, expands max_tokens', async () => {
      const result = await AnthropicAPI(baseMessages, {
        apiKey: 'sk-ant-test-key',
        reasoningMode: 'deep'
      });
      assert.equal(result, 'commits: mock commit message');
      assert.equal(anthropic.calls.length, 1);
      const payload = anthropic.calls[0].args[0] as Record<string, unknown>;
      assert.equal(payload.model, 'claude-3-5-sonnet-20241022');
      assert.equal(payload.stream, false);
      assert.equal(payload.messages.length, 1);
      assert.equal((payload.messages[0] as { role: string }).role, 'user');
      assert.equal(payload.system, 'You write commit messages.');
      const thinking = payload.thinking as { type: string; budget_tokens: number };
      assert.equal(thinking.type, 'enabled');
      assert.equal(typeof thinking.budget_tokens, 'number');
      assert.ok(thinking.budget_tokens > 0, 'budget_tokens should be positive');
      // max_tokens must accommodate budget_tokens
      assert.equal(payload.max_tokens, thinking.budget_tokens + 1024);
      // temperature must be unset when thinking is active
      assert.equal('temperature' in payload, false, 'temperature should be omitted');
    });

    it('balanced mode: uses adaptive thinking, strips temperature, default max_tokens', async () => {
      await AnthropicAPI(baseMessages, {
        apiKey: 'sk-ant-test-key',
        reasoningMode: 'balanced'
      });
      const payload = anthropic.calls[0].args[0] as Record<string, unknown>;
      const thinking = payload.thinking as { type: string; budget_tokens?: number };
      assert.equal(thinking.type, 'adaptive');
      assert.equal('budget_tokens' in thinking, false, 'adaptive should not have budget_tokens');
      // max_tokens = 1024 (no expansion since not enabled)
      assert.equal(payload.max_tokens, 1024);
      // temperature stripped when adaptive thinking active
      assert.equal('temperature' in payload, false);
    });

    it('fast mode: explicitly disables thinking, keeps temperature', async () => {
      await AnthropicAPI(baseMessages, {
        apiKey: 'sk-ant-test-key',
        reasoningMode: 'fast'
      });
      const payload = anthropic.calls[0].args[0] as Record<string, unknown>;
      const thinking = payload.thinking as { type: string };
      assert.equal(thinking.type, 'disabled');
      assert.equal(payload.max_tokens, 1024);
      // thinking disabled → temperature passes through
      assert.equal(payload.temperature, 0.7);
    });

    it('auto mode: omits the thinking field entirely and passes temperature', async () => {
      await AnthropicAPI(baseMessages, {
        apiKey: 'sk-ant-test-key',
        reasoningMode: 'auto'
      });
      const payload = anthropic.calls[0].args[0] as Record<string, unknown>;
      assert.equal('thinking' in payload, false, 'auto should not send thinking config');
      assert.equal(payload.temperature, 0.7);
      assert.equal(payload.max_tokens, 1024);
    });
  });

  describe('message conversion', () => {
    it('extracts system messages into the top-level system field', async () => {
      await AnthropicAPI(
        [
          { role: 'system', content: 'A' },
          { role: 'system', content: 'B' },
          { role: 'user', content: 'hi' }
        ],
        { apiKey: 'sk-ant-test-key', reasoningMode: 'fast' }
      );
      const payload = anthropic.calls[0].args[0] as Record<string, unknown>;
      assert.equal(payload.system, 'A\n\nB');
      assert.equal((payload.messages as unknown[]).length, 1);
    });

    it('maps assistant role to assistant and user role to user', async () => {
      await AnthropicAPI(
        [
          { role: 'user', content: 'q1' },
          { role: 'assistant', content: 'a1' },
          { role: 'user', content: 'q2' }
        ],
        { apiKey: 'sk-ant-test-key', reasoningMode: 'fast' }
      );
      const payload = anthropic.calls[0].args[0] as Record<string, unknown>;
      const messages = payload.messages as Array<{ role: string }>;
      assert.deepEqual(
        messages.map((m) => m.role),
        ['user', 'assistant', 'user']
      );
    });

    it('extracts text from array-of-parts content', async () => {
      await AnthropicAPI(
        [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'first' },
              { type: 'text', text: 'second' }
            ]
          }
        ],
        { apiKey: 'sk-ant-test-key', reasoningMode: 'fast' }
      );
      const payload = anthropic.calls[0].args[0] as Record<string, unknown>;
      const messages = payload.messages as Array<{ content: Array<{ text: string }> }>;
      // The source joins all text parts with newlines, producing a single
      // text part in the converted message.
      assert.equal(messages[0].content.length, 1);
      assert.equal(messages[0].content[0].text, 'first\nsecond');
    });

    it('skips messages with empty content', async () => {
      await AnthropicAPI(
        [
          { role: 'user', content: '' },
          { role: 'user', content: 'actual' }
        ],
        { apiKey: 'sk-ant-test-key', reasoningMode: 'fast' }
      );
      const payload = anthropic.calls[0].args[0] as Record<string, unknown>;
      assert.equal((payload.messages as unknown[]).length, 1);
    });
  });

  describe('error handling', () => {
    it('maps 401 errors to a friendly message', async () => {
      anthropic.setResponder(async () => {
        const err = new Error('Unauthorized') as Error & { status: number };
        err.status = 401;
        throw err;
      });
      await assert.rejects(
        () => AnthropicAPI(baseMessages, { apiKey: 'sk-ant-test-key', reasoningMode: 'fast' }),
        /Invalid Anthropic API key or unauthorized access/
      );
    });

    it('maps 429 errors to a friendly message', async () => {
      anthropic.setResponder(async () => {
        const err = new Error('Too Many Requests') as Error & { status: number };
        err.status = 429;
        throw err;
      });
      await assert.rejects(
        () => AnthropicAPI(baseMessages, { apiKey: 'sk-ant-test-key', reasoningMode: 'fast' }),
        /rate limit exceeded/
      );
    });

    it('throws when the response has no text content', async () => {
      anthropic.setResponder(async () => ({ content: [] }));
      await assert.rejects(
        () => AnthropicAPI(baseMessages, { apiKey: 'sk-ant-test-key', reasoningMode: 'fast' }),
        /Anthropic returned empty content/
      );
    });
  });

  describe('abort signal', () => {
    it('rejects with AbortError when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        () =>
          AnthropicAPI(baseMessages, {
            apiKey: 'sk-ant-test-key',
            reasoningMode: 'fast',
            signal: controller.signal
          }),
        (err: Error & { name?: string }) => err.name === 'AbortError'
      );
    });

    it('rejects with AbortError when aborted mid-flight', async () => {
      const controller = new AbortController();
      anthropic.setResponder(async (_args, kwargs) => {
        const signal = kwargs.signal as AbortSignal | undefined;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      });
      setTimeout(() => controller.abort(), 5);
      await assert.rejects(
        () =>
          AnthropicAPI(baseMessages, {
            apiKey: 'sk-ant-test-key',
            reasoningMode: 'fast',
            signal: controller.signal
          }),
        (err: Error & { name?: string }) => err.name === 'AbortError'
      );
    });
  });
});
