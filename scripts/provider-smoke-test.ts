import 'dotenv/config';
import OpenAI from 'openai';
import { GoogleGenAI, type Content } from '@google/genai';
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from 'openai/resources';
import { deriveReasoningEffortFromMode, deriveThinkingBudget } from '../src/reasoning-utils';
import type { ReasoningMode } from '../src/reasoning-utils';

/**
 * Provider smoke test runner.
 *
 * Fires the same lightweight prompt at OpenAI, Gemini, and Poe so you can
 * verify credentials, model access, and reasoning knobs without staging a
 * git commit inside VS Code.
 *
 * Usage:
 *   pnpm exec tsx scripts/provider-smoke-test.ts [--provider openai,poe] [--models gpt-5.4-nano,Claude-Haiku-4.5]
 *
 * Configure API keys via environment variables.
 * For Poe, set POE_API_KEY and optionally override POE_MODELS (comma-separated).
 */

type ProviderName = 'openai' | 'gemini' | 'poe';

const DEFAULT_MESSAGES: ChatCompletionMessageParam[] = [
  {
    role: 'system',
    content:
      'You are a logical assistant. For complex problems, think step-by-step to ensure accuracy. Your answer must be concise and direct.',
  },
  {
    role: 'user',
    content: `Solve this logic puzzle:
There are three boxes: Red, Blue, and Green. One contains a prize.
1. The Red box says: "The prize is not in the Blue box."
2. The Blue box says: "The prize is not here."
3. The Green box says: "The prize is in the Red box."

Exactly one of these statements is FALSE. Which box contains the prize? 
Explain your reasoning by testing each box as a potential location.`,
  },
];

// ── Configuration ────────────────────────────────────────────────────────

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-nano';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const POE_DEFAULT_MODELS = [
  'gpt-5.4-nano',
  'gemini-3-flash',
  'Minimax-M2.7',
  'Claude-Haiku-4.5',
];

const OPENAI_TEMPERATURE = Number(process.env.OPENAI_TEMPERATURE ?? '1');
const GEMINI_TEMPERATURE = Number(process.env.GEMINI_TEMPERATURE ?? '1');
const POE_TEMPERATURE = Number(process.env.POE_TEMPERATURE ?? '1');

const REASONING_MODES: ReasoningMode[] = ['auto', 'fast', 'balanced', 'deep'];
const AVAILABLE_PROVIDERS: ProviderName[] = ['openai', 'gemini', 'poe'];

interface TestResult {
  provider: string;
  model: string;
  status: 'ok' | 'skipped' | 'error';
  detail: string;
  latencyMs?: number;
  apiPath?: string;
}

// ── Poe model metadata & routing ─────────────────────────────────────────

interface PoeModelMetadata {
  id: string;
  raw: Record<string, unknown>;
}

let cachedPoeModels: PoeModelMetadata[] | null = null;

async function fetchPoeModels(apiKey: string): Promise<PoeModelMetadata[]> {
  const response = await fetch('https://api.poe.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(
      `Failed to list Poe models (${response.status} ${response.statusText}): ${payload}`
    );
  }

  const body = await response.json();
  cachedPoeModels = (body?.data || []).map((m: any) => ({
    id: String(m.id),
    raw: m,
  }));
  return cachedPoeModels ?? [];
}

async function getModelInfo(modelId: string, apiKey: string): Promise<PoeModelMetadata | undefined> {
  if (!cachedPoeModels) await fetchPoeModels(apiKey);
  let match = findModel(modelId);
  if (!match) {
    await fetchPoeModels(apiKey);
    match = findModel(modelId);
  }
  return match;
}

function findModel(modelId: string): PoeModelMetadata | undefined {
  const normalized = modelId.toLowerCase();
  return cachedPoeModels?.find((m) => m.id.toLowerCase() === normalized);
}

function supportsResponsesAPI(modelInfo?: PoeModelMetadata): boolean {
  const endpoints = modelInfo?.raw?.supported_endpoints;
  if (!Array.isArray(endpoints) || endpoints.length === 0) return false;
  return endpoints.includes('/v1/responses');
}

// ── Poe API calls ────────────────────────────────────────────────────────

function buildResponsesInput(messages: ChatCompletionMessageParam[]): string {
  return messages
    .map((msg) => {
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content))
        return msg.content
          .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
          .filter(Boolean)
          .join('\n');
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Responses API path — native reasoning via reasoning.effort */
async function callPoeResponses(
  apiKey: string,
  model: string,
  messages: ChatCompletionMessageParam[],
  temperature: number,
  reasoningMode: ReasoningMode
): Promise<{ content: string; latencyMs: number }> {
  const reasoningEffort = deriveReasoningEffortFromMode(reasoningMode);
  // auto → undefined, so skip
  const body: Record<string, unknown> = {
    model,
    input: buildResponsesInput(messages),
  };
  if (reasoningEffort) body.reasoning = { effort: reasoningEffort };
  // Omit temperature when reasoning active — Claude requires t=1, GPT rejects it
  if (!reasoningEffort && temperature > 0) body.temperature = temperature;

  const started = Date.now();
  const response = await fetch('https://api.poe.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw Object.assign(new Error(`Poe Responses API ${response.status}`), {
      status: response.status,
      body: text,
    });
  }

  const data = await response.json();
  const content = extractResponsesText(data);
  if (!content) {
    throw new Error('Poe Responses API returned empty content');
  }

  return { content, latencyMs: Date.now() - started };
}

/** Extract text from Responses API response (Poe omits output_text sometimes) */
function extractResponsesText(data: any): string | undefined {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const output = data?.output;
  if (!Array.isArray(output)) return undefined;
  const parts: string[] = [];
  for (const item of output) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const block of item.content) {
      if (block?.type === 'output_text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
  }
  return parts.length ? parts.join('\n') : undefined;
}

/** Chat Completions fallback — model-declared thinking params via extra_body */
async function callPoeChatCompletions(
  apiKey: string,
  model: string,
  messages: ChatCompletionMessageParam[],
  temperature: number,
  reasoningMode: ReasoningMode
): Promise<{ content: string; latencyMs: number }> {
  const poe = new OpenAI({ apiKey, baseURL: 'https://api.poe.com/v1' });
  const started = Date.now();

  const modelInfo = await getModelInfo(model, apiKey);
  const extraBody = buildChatCompletionsExtraBody(reasoningMode, modelInfo);

  const completion = await poe.chat.completions.create({
    model,
    messages,
    temperature,
    ...(Object.keys(extraBody).length ? { extra_body: extraBody } : {}),
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('Poe Chat Completions returned empty content');

  return { content, latencyMs: Date.now() - started };
}

const THINKING_PARAM_NAMES = [
  'enable_thinking', 'reasoning_enabled', 'deep_thinking', 'enable_reasoning',
  'thinking_mode', 'thinking', 'reasoning_effort', 'output_effort',
  'thinking_level', 'thinking_budget',
];

function buildChatCompletionsExtraBody(
  reasoningMode: ReasoningMode,
  modelInfo?: PoeModelMetadata
): Record<string, unknown> {
  if (reasoningMode === 'auto' || !modelInfo?.raw) return {};
  const params: any[] = Array.isArray(modelInfo.raw.parameters) ? modelInfo.raw.parameters : [];
  const extra: Record<string, unknown> = {};
  for (const param of params) {
    const name = param.name?.toLowerCase();
    if (!name || !THINKING_PARAM_NAMES.includes(name)) continue;
    if (param.schema?.type === 'boolean') { extra[param.name] = true; continue; }
    if (Array.isArray(param.schema?.enum) && param.schema.enum.length) {
      const prefs: Record<string, string[]> = {
        fast: ['low', 'minimal', 'minimum', 'min', 'none'],
        balanced: ['medium', 'standard', 'balanced'],
        deep: ['high', 'xhigh', 'max', 'maximum', 'enabled'],
      };
      const allowed = param.schema.enum;
      const norm = allowed.map((v: string) => ({ orig: v, low: v.toLowerCase() }));
      const match = (prefs[reasoningMode] || []).map(p => norm.find(n => n.low === p)).find(Boolean);
      extra[param.name] = match ? match.orig : allowed[Math.floor(allowed.length / 2)];
      continue;
    }
    if (param.schema?.type === 'number' || param.schema?.type === 'integer') {
      const max = param.schema?.maximum;
      const ratios: Record<string, number> = { fast: 0.25, balanced: 0.55, deep: 0.85 };
      const ratio = ratios[reasoningMode];
      if (ratio && typeof max === 'number' && max > 0) extra[param.name] = Math.max(1, Math.round(max * ratio));
      else if (ratio) {
        const fb: Record<string, number> = { fast: 2048, balanced: 8192, deep: 32768 };
        extra[param.name] = fb[reasoningMode];
      }
      continue;
    }
  }
  return extra;
}

// ── Provider test runners ────────────────────────────────────────────────

async function testOpenAI(reasoningMode: ReasoningMode): Promise<TestResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { provider: 'openai', model: OPENAI_MODEL, status: 'skipped', detail: 'OPENAI_API_KEY missing' };

  const config: any = { apiKey };
  if (process.env.OPENAI_BASE_URL) {
    config.baseURL = process.env.OPENAI_BASE_URL;
    if (process.env.AZURE_API_VERSION) {
      config.defaultQuery = { 'api-version': process.env.AZURE_API_VERSION };
      config.defaultHeaders = { 'api-key': apiKey };
    }
  }

  const model = OPENAI_MODEL;
  const temperature = OPENAI_TEMPERATURE;
  const reasoningEffort = deriveReasoningEffortFromMode(reasoningMode);
  const isReasoningModel = /^(o1|o3|o4|gpt-5)/i.test(model);
  const normalizedEffort =
    reasoningEffort && reasoningEffort !== 'none'
      ? reasoningEffort === 'minimal'
        ? 'low'
        : reasoningEffort
      : undefined;

  try {
    const openai = new OpenAI(config);
    const started = Date.now();
    const payload: ChatCompletionCreateParamsNonStreaming = { model, messages: DEFAULT_MESSAGES };

    if (isReasoningModel && normalizedEffort) {
      payload.reasoning_effort = normalizedEffort as any;
    } else {
      payload.temperature = temperature;
    }

    const completion = await openai.chat.completions.create(payload);
    const latencyMs = Date.now() - started;

    return {
      provider: 'openai',
      model,
      status: 'ok',
      detail: completion.choices[0]?.message?.content || 'No content returned',
      latencyMs,
    };
  } catch (error: any) {
    return { provider: 'openai', model, status: 'error', detail: error?.message || 'Unknown error' };
  }
}

async function testGemini(reasoningMode: ReasoningMode): Promise<TestResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { provider: 'gemini', model: GEMINI_MODEL, status: 'skipped', detail: 'GEMINI_API_KEY missing' };

  const gemini = new GoogleGenAI({ apiKey });
  const model = GEMINI_MODEL;
  const temperature = GEMINI_TEMPERATURE;

  try {
    const contents: Content[] = DEFAULT_MESSAGES.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [
        {
          text:
            typeof msg.content === 'string'
              ? msg.content
              : Array.isArray(msg.content)
                ? msg.content.map((p: any) => (p?.text ? p.text : '')).join('\n')
                : '',
        },
      ],
    }));

    const started = Date.now();
    const result = await gemini.models.generateContent({ model, contents, config: { temperature } });
    const text =
      result?.text ||
      result?.candidates
        ?.map((c) => c.content?.parts?.map((p: any) => p.text).join('\n'))
        .join('\n');

    return {
      provider: 'gemini',
      model,
      status: 'ok',
      detail: text || 'No content returned',
      latencyMs: Date.now() - started,
    };
  } catch (error: any) {
    return { provider: 'gemini', model, status: 'error', detail: error?.message || 'Unknown error' };
  }
}

async function testPoe(
  reasoningMode: ReasoningMode,
  apiKey: string,
  models: string[]
): Promise<TestResult[]> {
  const temperature = POE_TEMPERATURE;

  return Promise.all(
    models.map(async (model): Promise<TestResult> => {
      try {
        const modelInfo = await getModelInfo(model, apiKey);
        const useResponses = supportsResponsesAPI(modelInfo);
        const apiPath = useResponses ? 'responses' : 'chat/completions';

        const { content, latencyMs } = useResponses
          ? await callPoeResponses(apiKey, model, DEFAULT_MESSAGES, temperature, reasoningMode)
          : await callPoeChatCompletions(apiKey, model, DEFAULT_MESSAGES, temperature, reasoningMode);

        console.log(
          `  Poe ${model} → ${apiPath}${useResponses ? ` reasoning=${reasoningMode}` : ` reasoning=${reasoningMode}`}`
        );

        return {
          provider: 'poe',
          model,
          status: 'ok',
          detail: content.length > 200 ? content.slice(0, 200) + '…' : content,
          latencyMs,
          apiPath,
        };
      } catch (error: any) {
        return {
          provider: 'poe',
          model,
          status: 'error',
          detail: error?.message || 'Unknown error',
        };
      }
    })
  );
}

// ── CLI parsing & main ───────────────────────────────────────────────────

function parseProviderSelection(argv: string[]): ProviderName[] {
  const selected = new Set<ProviderName>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let value: string | undefined;

    if (arg === '--provider' || arg === '-p' || arg === '--providers')
      value = argv[++i];
    else if (arg.startsWith('--provider=') || arg.startsWith('--providers='))
      value = arg.split('=')[1];

    value
      ?.split(',')
      .map((v) => v.trim().toLowerCase())
      .forEach((v) => {
        if ((AVAILABLE_PROVIDERS as string[]).includes(v)) selected.add(v as ProviderName);
        else if (v) console.warn(`Unknown provider "${v}" — supported: ${AVAILABLE_PROVIDERS.join(', ')}`);
      });
  }

  return selected.size ? Array.from(selected) : [...AVAILABLE_PROVIDERS];
}

function parseModels(argv: string[], defaultValue: string[]): string[] {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let value: string | undefined;

    if (arg === '--models' || arg === '-m') value = argv[++i];
    else if (arg.startsWith('--models=')) value = arg.split('=')[1];

    if (value) return value.split(',').map((v) => v.trim()).filter(Boolean);
  }

  if (process.env.POE_MODELS) {
    return process.env.POE_MODELS.split(',').map((v) => v.trim()).filter(Boolean);
  }

  return defaultValue;
}

function coerceReasoningMode(value?: string): ReasoningMode {
  if (value && REASONING_MODES.includes(value as ReasoningMode)) return value as ReasoningMode;
  return 'balanced';
}

async function main() {
  const reasoningMode = coerceReasoningMode(process.env.REASONING_MODE);
  const selectedProviders = parseProviderSelection(process.argv.slice(2));
  const poeModels = parseModels(process.argv.slice(2), POE_DEFAULT_MODELS);

  console.log(
    `Provider smoke test | reasoning: ${reasoningMode} | providers: ${selectedProviders.join(', ')}`
  );
  if (selectedProviders.includes('poe')) {
    console.log(`Poe models: ${poeModels.join(', ')}`);
  }
  console.log('');

  const results: TestResult[] = [];

  if (selectedProviders.includes('openai')) {
    results.push(await testOpenAI(reasoningMode));
  }

  if (selectedProviders.includes('gemini')) {
    results.push(await testGemini(reasoningMode));
  }

  if (selectedProviders.includes('poe')) {
    const apiKey = process.env.POE_API_KEY;
    if (!apiKey) {
      results.push({ provider: 'poe', model: '—', status: 'skipped', detail: 'POE_API_KEY missing' });
    } else {
      const poeResults = await testPoe(reasoningMode, apiKey, poeModels);
      results.push(...poeResults);
    }
  }

  console.log('── Results ──');
  for (const r of results) {
    const prefix = r.status === 'ok' ? '✅' : r.status === 'skipped' ? '⚪' : '❌';
    const api = r.apiPath ? ` [${r.apiPath}]` : '';
    const lat = r.latencyMs ? ` (${r.latencyMs}ms)` : '';
    console.log(`${prefix} ${r.provider}/${r.model}${api}${lat}`);
    if (r.status === 'ok') console.log(`   ${r.detail.replace(/\n/g, '\n   ')}`);
    if (r.status === 'error') console.log(`   Error: ${r.detail}`);
  }

  const failures = results.filter((r) => r.status === 'error');
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exitCode = 1;
});
