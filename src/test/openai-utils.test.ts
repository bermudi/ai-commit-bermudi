import { strict as assert } from 'assert';
import type { ChatCompletionMessageParam } from 'openai/resources';
import { getMockSdk } from './helpers/mock-sdk';
import { installMockConfig } from './helpers/mock-config';
import { OpenAICompatibleAPI } from '../openai-utils';
import { ConfigKeys } from '../config';

const openai = getMockSdk('openai');

const baseMessages: ChatCompletionMessageParam[] = [
  { role: 'system', content: 'You write commit messages.' },
  { role: 'user', content: 'diff content' }
];

describe('OpenAICompatibleAPI', () => {
  let cfg: ReturnType<typeof installMockConfig>;

  beforeEach(() => {
    openai.reset();
    cfg = installMockConfig();
    cfg.set(ConfigKeys.OPENAI_API_KEY, 'sk-test-key');
    cfg.set(ConfigKeys.OPENAI_MODEL, 'gpt-4o');
    cfg.set(ConfigKeys.OPENAI_TEMPERATURE, 0.7);
  });

  afterEach(() => {
    cfg.restore();
  });

  it('throws when api key is missing', async () => {
    cfg.set(ConfigKeys.OPENAI_API_KEY, '');
    await assert.rejects(() => OpenAICompatibleAPI(baseMessages), /OpenAI API key is not configured/);
  });

  it('throws when api key is whitespace-only', async () => {
    cfg.set(ConfigKeys.OPENAI_API_KEY, '   ');
    await assert.rejects(() => OpenAICompatibleAPI(baseMessages), /OpenAI API key is empty/);
  });

  describe('standard (non-reasoning) models', () => {
    beforeEach(() => {
      cfg.set(ConfigKeys.OPENAI_MODEL, 'gpt-4o');
    });

    it('sends temperature and no reasoning_effort for fast mode', async () => {
      cfg.set(ConfigKeys.REASONING_MODE, 'fast');
      await OpenAICompatibleAPI(baseMessages);
      const payload = openai.calls[0].kwargs as Record<string, unknown>;
      assert.equal(payload.model, 'gpt-4o');
      assert.equal(payload.temperature, 0.7);
      assert.equal('reasoning_effort' in payload, false);
    });

    it('sends temperature and no reasoning_effort for auto mode', async () => {
      cfg.set(ConfigKeys.REASONING_MODE, 'auto');
      await OpenAICompatibleAPI(baseMessages);
      const payload = openai.calls[0].kwargs as Record<string, unknown>;
      assert.equal(payload.temperature, 0.7);
      assert.equal('reasoning_effort' in payload, false);
    });

    it('throws when the response has no content', async () => {
      openai.setResponder(async () => ({ choices: [{ message: { content: null } }] }));
      await assert.rejects(() => OpenAICompatibleAPI(baseMessages), /OpenAI returned empty content/);
    });
  });

  describe('reasoning models (o-series, gpt-5)', () => {
    it('gpt-5 with balanced mode sends reasoning_effort and omits temperature', async () => {
      cfg.set(ConfigKeys.OPENAI_MODEL, 'gpt-5');
      cfg.set(ConfigKeys.REASONING_MODE, 'balanced');
      await OpenAICompatibleAPI(baseMessages);
      const payload = openai.calls[0].kwargs as Record<string, unknown>;
      assert.equal(payload.model, 'gpt-5');
      assert.equal(payload.reasoning_effort, 'medium');
      assert.equal('temperature' in payload, false);
    });

    it('o3 with deep mode sends high reasoning_effort', async () => {
      cfg.set(ConfigKeys.OPENAI_MODEL, 'o3');
      cfg.set(ConfigKeys.REASONING_MODE, 'deep');
      await OpenAICompatibleAPI(baseMessages);
      const payload = openai.calls[0].kwargs as Record<string, unknown>;
      assert.equal(payload.reasoning_effort, 'high');
      assert.equal('temperature' in payload, false);
    });

    it('o1-mini with fast mode sends low reasoning_effort', async () => {
      cfg.set(ConfigKeys.OPENAI_MODEL, 'o1-mini');
      cfg.set(ConfigKeys.REASONING_MODE, 'fast');
      await OpenAICompatibleAPI(baseMessages);
      const payload = openai.calls[0].kwargs as Record<string, unknown>;
      assert.equal(payload.reasoning_effort, 'low');
    });

    it('o1 with auto mode omits reasoning_effort and omits temperature', async () => {
      cfg.set(ConfigKeys.OPENAI_MODEL, 'o1');
      cfg.set(ConfigKeys.REASONING_MODE, 'auto');
      await OpenAICompatibleAPI(baseMessages);
      const payload = openai.calls[0].kwargs as Record<string, unknown>;
      assert.equal('reasoning_effort' in payload, false);
      assert.equal('temperature' in payload, false);
    });
  });

  describe('temperature unsupported fallback', () => {
    it('retries without temperature when the API returns 400 unsupported', async () => {
      cfg.set(ConfigKeys.OPENAI_MODEL, 'gpt-4o');
      cfg.set(ConfigKeys.OPENAI_TEMPERATURE, 0.7);

      let attempts = 0;
      openai.setResponder(async () => {
        attempts += 1;
        if (attempts === 1) {
          const err = new Error('temperature not supported') as Error & {
            response: { status: number; data: { error: { message: string } } };
          };
          err.response = { status: 400, data: { error: { message: 'temperature is not supported on this model' } } };
          throw err;
        }
        return { choices: [{ message: { content: 'commits: ok' } }] };
      });

      const result = await OpenAICompatibleAPI(baseMessages);
      assert.equal(result, 'commits: ok');
      assert.equal(attempts, 2);
      const secondPayload = openai.calls[1].kwargs as Record<string, unknown>;
      assert.equal('temperature' in secondPayload, false);
    });
  });

  describe('overrides', () => {
    it('options.apiKey overrides config and is used in the client', async () => {
      await OpenAICompatibleAPI(baseMessages, { apiKey: 'sk-override' });
      const payload = openai.calls[0].kwargs as Record<string, unknown>;
      assert.equal(payload.model, 'gpt-4o');
    });

    it('options.temperature overrides config', async () => {
      await OpenAICompatibleAPI(baseMessages, { temperature: 0.2 });
      const payload = openai.calls[0].kwargs as Record<string, unknown>;
      assert.equal(payload.temperature, 0.2);
    });

    it('options.model overrides config', async () => {
      await OpenAICompatibleAPI(baseMessages, { model: 'gpt-4-turbo' });
      const payload = openai.calls[0].kwargs as Record<string, unknown>;
      assert.equal(payload.model, 'gpt-4-turbo');
    });

    it('forwards abort signal to the SDK call', async () => {
      const controller = new AbortController();
      openai.setResponder(async (_args, kwargs) => {
        return new Promise((_resolve, reject) => {
          const signal = kwargs.signal as AbortSignal | undefined;
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      });
      setTimeout(() => controller.abort(), 5);
      await assert.rejects(
        () => OpenAICompatibleAPI(baseMessages, { signal: controller.signal }),
        (err: Error & { name?: string }) => err.name === 'AbortError'
      );
    });
  });
});
