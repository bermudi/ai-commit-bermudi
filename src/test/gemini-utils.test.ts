import { strict as assert } from 'assert';
import { getMockSdk } from './helpers/mock-sdk';
import { installMockConfig } from './helpers/mock-config';
import { GeminiAPI, listAvailableGeminiModels } from '../gemini-utils';
import { ConfigKeys } from '../config';
import { ModelRegistry } from '../model-registry';

const genai = getMockSdk('@google/genai');

const baseMessages = [
  { role: 'system', content: 'You write commit messages.' },
  { role: 'user', content: 'diff content' }
] as Array<{ role: string; content: string }>;

describe('GeminiAPI', () => {
  let cfg: ReturnType<typeof installMockConfig>;

  beforeEach(() => {
    genai.reset();
    cfg = installMockConfig();
    cfg.set(ConfigKeys.GEMINI_API_KEY, 'gemini-test-key');
    cfg.set(ConfigKeys.GEMINI_MODEL, 'gemini-2.0-flash-001');
    cfg.set(ConfigKeys.GEMINI_TEMPERATURE, 0.7);
  });

  afterEach(() => {
    cfg.restore();
  });

  it('throws when api key is missing', async () => {
    cfg.set(ConfigKeys.GEMINI_API_KEY, '');
    await assert.rejects(() => GeminiAPI(baseMessages), /Gemini API key is not configured/);
  });

  it('throws when no valid messages are provided', async () => {
    await assert.rejects(
      () => GeminiAPI([{ role: 'user', content: '' }]),
      /No valid messages to send to Gemini/
    );
  });

  describe('payload construction per reasoning mode', () => {
    it('balanced mode with thinking support: sets thinkingConfig with budget, omits temperature', async () => {
      genai.setResponder(async (_args, kwargs) => {
        // Capability check: return thinking: true
        if ((kwargs as { model?: string }) && !(kwargs as { contents?: unknown }).contents) {
          return { thinking: true };
        }
        return { text: 'commits: ok' };
      });
      cfg.set(ConfigKeys.REASONING_MODE, 'balanced');
      await GeminiAPI(baseMessages);
      // The last call should be the generateContent call
      const generateCall = genai.calls[genai.calls.length - 1];
      const payload = generateCall.kwargs as {
        model: string;
        contents: Array<{ role: string; parts: Array<{ text: string }> }>;
        config?: { thinkingConfig?: { includeThoughts: boolean; thinkingBudget: number; thinkingLevel?: string }; temperature?: number };
      };
      assert.equal(payload.model, 'gemini-2.0-flash-001');
      assert.equal(payload.contents.length, 2);
      assert.equal(payload.contents[0].role, 'user');
      assert.equal(payload.config?.thinkingConfig?.includeThoughts, true);
      assert.equal(typeof payload.config?.thinkingConfig?.thinkingBudget, 'number');
      assert.equal(payload.config?.thinkingConfig?.thinkingLevel, 'MEDIUM');
      assert.equal('temperature' in (payload.config ?? {}), false, 'temperature should be omitted when thinkingConfig is set');
    });

    it('fast mode: thinkingBudget=2048, thinkingLevel=LOW, no temperature', async () => {
      cfg.set(ConfigKeys.REASONING_MODE, 'fast');
      await GeminiAPI(baseMessages);
      const payload = genai.calls[genai.calls.length - 1].kwargs as {
        config?: { thinkingConfig?: { thinkingBudget: number; thinkingLevel?: string } };
      };
      assert.equal(payload.config?.thinkingConfig?.thinkingBudget, 2048);
      assert.equal(payload.config?.thinkingConfig?.thinkingLevel, 'LOW');
    });

    it('deep mode: thinkingBudget=32768, thinkingLevel=HIGH', async () => {
      cfg.set(ConfigKeys.REASONING_MODE, 'deep');
      await GeminiAPI(baseMessages);
      const payload = genai.calls[genai.calls.length - 1].kwargs as {
        config?: { thinkingConfig?: { thinkingBudget: number; thinkingLevel?: string } };
      };
      assert.equal(payload.config?.thinkingConfig?.thinkingBudget, 32768);
      assert.equal(payload.config?.thinkingConfig?.thinkingLevel, 'HIGH');
    });

    it('auto mode: omits thinkingConfig and includes temperature', async () => {
      cfg.set(ConfigKeys.REASONING_MODE, 'auto');
      await GeminiAPI(baseMessages);
      const payload = genai.calls[genai.calls.length - 1].kwargs as {
        config?: { thinkingConfig?: unknown; temperature?: number };
      };
      assert.equal(payload.config?.thinkingConfig, undefined);
      assert.equal(payload.config?.temperature, 0.7);
    });

    it('skips thinkingConfig when the model metadata reports no thinking support', async () => {
      // Stub ModelRegistry.getCapabilities to return undefined so the
      // source falls through to the mock's models.get() call.
      const registry = ModelRegistry.getInstance();
      const originalGetCapabilities = registry.getCapabilities.bind(registry);
      (registry as unknown as { getCapabilities: (m: string) => unknown }).getCapabilities = () => undefined;
      try {
        genai.setResponder(async (_args, kwargs) => {
          if ((kwargs as { contents?: unknown }).contents) {
            return { text: 'commits: ok' };
          }
          // Capability check: return thinking: false
          return { thinking: false };
        });
        cfg.set(ConfigKeys.REASONING_MODE, 'deep');
        await GeminiAPI(baseMessages);
        const payload = genai.calls[genai.calls.length - 1].kwargs as {
          config?: { thinkingConfig?: unknown; temperature?: number };
        };
        assert.equal(payload.config?.thinkingConfig, undefined);
        assert.equal(payload.config?.temperature, 0.7);
      } finally {
        (registry as unknown as { getCapabilities: (m: string) => unknown }).getCapabilities =
          originalGetCapabilities;
      }
    });
  });

  describe('message conversion', () => {
    it('maps assistant role to model role', async () => {
      cfg.set(ConfigKeys.REASONING_MODE, 'auto');
      await GeminiAPI([
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a' },
        { role: 'user', content: 'q2' }
      ]);
      const payload = genai.calls[genai.calls.length - 1].kwargs as {
        contents: Array<{ role: string }>;
      };
      assert.deepEqual(
        payload.contents.map((c) => c.role),
        ['user', 'model', 'user']
      );
    });

    it('concatenates text from array content', async () => {
      cfg.set(ConfigKeys.REASONING_MODE, 'auto');
      await GeminiAPI([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'first' },
            { type: 'text', text: 'second' }
          ] as unknown as string
        }
      ]);
      const payload = genai.calls[genai.calls.length - 1].kwargs as {
        contents: Array<{ parts: Array<{ text: string }> }>;
      };
      assert.equal(payload.contents[0].parts[0].text, 'first\nsecond');
    });
  });

  describe('error handling', () => {
    it('throws when response has no text and no candidates', async () => {
      genai.setResponder(async () => ({}));
      await assert.rejects(() => GeminiAPI(baseMessages), /Gemini returned empty content/);
    });

    it('maps API_KEY_INVALID to a friendly message', async () => {
      genai.setResponder(async () => {
        throw new Error('API_KEY_INVALID');
      });
      await assert.rejects(() => GeminiAPI(baseMessages), /Invalid Gemini API key/);
    });

    it('falls back to candidate parts when text is missing', async () => {
      genai.setResponder(async () => ({
        candidates: [{ content: { parts: [{ text: 'commits: from candidate' }] } }]
      }));
      const result = await GeminiAPI(baseMessages);
      assert.equal(result, 'commits: from candidate');
    });
  });
});

describe('listAvailableGeminiModels', () => {
  let cfg: ReturnType<typeof installMockConfig>;

  beforeEach(() => {
    genai.reset();
    cfg = installMockConfig();
    cfg.set(ConfigKeys.GEMINI_API_KEY, 'gemini-test-key');
  });

  afterEach(() => {
    cfg.restore();
  });

  it('returns models from the SDK list', async () => {
    genai.setResponder(async () => ({
      models: [
        { name: 'models/gemini-2.0-flash-001', supportedGenerationMethods: ['generateContent'], thinking: true },
        { name: 'models/gemini-1.5-pro', supportedGenerationMethods: ['generateContent'], thinking: false },
        { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] }
      ]
    }));
    const models = await listAvailableGeminiModels();
    assert.ok(models.includes('gemini-2.0-flash-001'));
    assert.ok(models.includes('gemini-1.5-pro'));
    assert.ok(!models.includes('embedding-001'), 'non-generateContent models should be excluded');
  });

  it('returns an empty list when no API key and no registry data', async () => {
    cfg.set(ConfigKeys.GEMINI_API_KEY, '');
    // Reset ModelRegistry and stub fetch so the live models.dev call
    // returns an empty payload.
    ModelRegistry.__resetForTests();
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = (async () =>
      new Response(JSON.stringify({}), { status: 200 })) as typeof fetch;
    try {
      const models = await listAvailableGeminiModels();
      assert.deepEqual(models, []);
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });
});
