import 'dotenv/config';
import OpenAI from 'openai';
import { GoogleGenAI, type Content } from '@google/genai';
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from 'openai/resources';
import { deriveReasoningEffortFromMode, deriveThinkingBudget, deriveThinkingLevelFromMode, ReasoningMode } from '../src/reasoning-utils';

/**
 * Provider smoke test runner.
 *
 * This script fires the same lightweight prompt at OpenAI, Gemini, and Poe so you
 * can verify credentials, model access, and reasoning knobs (effort/thinking budget)
 * without staging a git commit inside VS Code. Configure API keys via environment
 * variables or tweak the constants below, then run:
 *
 *   pnpm exec tsx scripts/provider-smoke-test.ts [--provider openai] [--provider gemini] [--provider poe]
 *
 * Repeated `--provider` flags or comma-delimited values let you focus on specific providers.
 */

type ProviderName = 'openai' | 'gemini' | 'poe';

const DEFAULT_MESSAGES: ChatCompletionMessageParam[] = [
  {
    role: 'system',
    content: 'You are a logical assistant. For complex problems, think step-by-step to ensure accuracy. Your answer must be concise and direct.'
  },
  {
    role: 'user',
    content: `Solve this logic puzzle:
There are three boxes: Red, Blue, and Green. One contains a prize.
1. The Red box says: "The prize is not in the Blue box."
2. The Blue box says: "The prize is not here."
3. The Green box says: "The prize is in the Red box."

Exactly one of these statements is FALSE. Which box contains the prize? 
Explain your reasoning by testing each box as a potential location.`
  }
];

// Centralized model + temperature configuration so you can tweak everything quickly.
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-nano';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const POE_MODEL = process.env.POE_MODEL || 'gemini-3-flash';
const OPENAI_TEMPERATURE = Number(process.env.OPENAI_TEMPERATURE ?? '1');
const GEMINI_TEMPERATURE = Number(process.env.GEMINI_TEMPERATURE ?? '1');
const POE_TEMPERATURE = Number(process.env.POE_TEMPERATURE ?? '1');

const REASONING_MODES: ReasoningMode[] = ['auto', 'fast', 'balanced', 'deep'];
const AVAILABLE_PROVIDERS: ProviderName[] = ['openai', 'gemini', 'poe'];

interface PoeModelMetadata {
  id: string;
  raw: any;
}

type PoeParameterDescriptor = {
  name?: string;
  enum?: string[];
  oneOf?: { const?: string; value?: string }[];
  maximum?: number;
  max?: number;
  schema?: {
    enum?: string[];
    maximum?: number;
    max?: number;
  };
  options?: string[];
  values?: string[];
  allowed_values?: string[];
  enum_values?: string[];
};

let cachedPoeModels: PoeModelMetadata[] | null = null;

async function fetchPoeModels(apiKey: string): Promise<PoeModelMetadata[]> {
  if (!apiKey) {
    return [];
  }

  const response = await fetch('https://api.poe.com/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Failed to list Poe models (${response.status} ${response.statusText}): ${payload}`);
  }

  const body = await response.json();
  cachedPoeModels = (body?.data || []).map((model: any) => ({
    id: String(model.id),
    raw: model
  }));
  return cachedPoeModels ?? [];
}

function normalizeParameterName(paramName?: string) {
  return paramName?.toLowerCase();
}

function getParameterDescriptor(modelInfo: PoeModelMetadata | undefined, paramName: string): PoeParameterDescriptor | undefined {
  if (!modelInfo?.raw) {
    return undefined;
  }
  const raw = modelInfo.raw;
  const lowerParam = normalizeParameterName(paramName);
  const parameters = raw?.parameters;

  if (Array.isArray(parameters)) {
    return parameters.find((parameter: PoeParameterDescriptor) => normalizeParameterName(parameter?.name) === lowerParam);
  }

  if (parameters && typeof parameters === 'object') {
    if (parameters[paramName]) {
      return parameters[paramName];
    }
    const matchEntry = Object.entries(parameters).find(
      ([key, value]) =>
        normalizeParameterName(key) === lowerParam ||
        (value && typeof value === 'object' && normalizeParameterName((value as PoeParameterDescriptor).name) === lowerParam)
    );
    if (matchEntry) {
      return matchEntry[1] as PoeParameterDescriptor;
    }
  }

  return undefined;
}

function extractParameterEnum(model?: PoeModelMetadata, paramName?: string): string[] | undefined {
  if (!model || !paramName) {
    return undefined;
  }
  const descriptor = getParameterDescriptor(model, paramName);
  if (!descriptor) {
    return undefined;
  }

  const candidateLists = [
    descriptor.enum,
    descriptor.enum_values,
    descriptor.allowed_values,
    descriptor.values,
    descriptor.options,
    descriptor.schema?.enum,
    descriptor.oneOf?.map((entry) => entry?.const ?? entry?.value)
  ].filter(Boolean) as string[][];

  const flattened = candidateLists.flat().filter((value) => typeof value === 'string');

  if (!flattened.length) {
    return undefined;
  }

  return Array.from(new Set(flattened));
}

function extractMaxThinkingBudget(modelInfo?: PoeModelMetadata): number | undefined {
  if (!modelInfo?.raw) {
    return undefined;
  }
  const raw = modelInfo.raw;
  const descriptor = getParameterDescriptor(modelInfo, 'thinking_budget');
  return (
    raw?.metadata?.max_thinking_budget ??
    raw?.metadata?.thinking_budget?.max ??
    raw?.parameters?.thinking_budget?.max ??
    raw?.limits?.thinking_budget?.max ??
    raw?.capabilities?.reasoning?.thinking_budget?.max ??
    descriptor?.maximum ??
    descriptor?.max ??
    descriptor?.schema?.maximum ??
    descriptor?.schema?.max
  );
}

function mapModeToEnum(mode: ReasoningMode, allowedValues: string[]): string {
  if (!allowedValues.length) {
    throw new Error('Cannot map reasoning mode without allowed values');
  }

  const normalized = allowedValues.map((value) => ({
    original: value,
    normalized: value.toLowerCase()
  }));

  const pickPreference = (preferences: string[], fallback: () => string) => {
    const match = normalized.find((entry) => preferences.includes(entry.normalized));
    return match ? match.original : fallback();
  };

  const fallbackMiddle = () => normalized[Math.floor(normalized.length / 2)].original;
  const fallbackLast = () => normalized[normalized.length - 1].original;
  const fallbackFirst = () => normalized[0].original;

  switch (mode) {
    case 'deep':
      return pickPreference(['high', 'maximum', 'max'], fallbackLast);
    case 'fast':
      return pickPreference(['low', 'minimal', 'minimum', 'min'], fallbackFirst);
    case 'balanced':
      return pickPreference(['medium', 'standard', 'balanced'], fallbackMiddle);
    case 'auto':
      return fallbackMiddle();
    default:
      return fallbackMiddle();
  }
}

async function getPoeModelMetadata(modelId: string, apiKey: string): Promise<PoeModelMetadata | undefined> {
  if (!cachedPoeModels) {
    await fetchPoeModels(apiKey);
  }

  const match = cachedPoeModels?.find((model) => model.id === modelId);
  if (match) {
    return match;
  }

  await fetchPoeModels(apiKey);
  return cachedPoeModels?.find((model) => model.id === modelId);
}

async function buildPoeExtraBody(reasoningMode: ReasoningMode, model: string, apiKey: string) {
  try {
    const metadata = await getPoeModelMetadata(model, apiKey);
    if (!metadata) {
      console.warn(`Unable to load Poe metadata for model "${model}". Skipping dynamic parameter mapping.`);
      return {};
    }

    const extraBody: Record<string, string | number> = {};
    const maxThinkingBudget = extractMaxThinkingBudget(metadata);
    const thinkingBudgetDescriptor = getParameterDescriptor(metadata, 'thinking_budget');

    if (thinkingBudgetDescriptor) {
      const value = deriveThinkingBudget(reasoningMode, maxThinkingBudget);
      if (value && value > 0) {
        extraBody.thinking_budget = value;
        console.log(
          `Mapping reasoningMode ${reasoningMode} -> thinking_budget ${value} (schema max: ${maxThinkingBudget ?? 'unknown'})`
        );
      }
    }

    const enumParameters = ['thinking_level', 'reasoning_effort', 'output_effort'] as const;
    for (const paramName of enumParameters) {
      const descriptor = getParameterDescriptor(metadata, paramName);
      if (!descriptor) {
        continue;
      }

      const allowedValues = extractParameterEnum(metadata, paramName);
      let value: string | undefined;
      if (allowedValues?.length) {
        value = mapModeToEnum(reasoningMode, allowedValues);
      } else {
        value =
          paramName === 'thinking_level'
            ? deriveThinkingLevelFromMode(reasoningMode)
            : deriveReasoningEffortFromMode(reasoningMode);
      }

      if (value && value !== 'none') {
        extraBody[paramName] = value;
        console.log(
          `Mapping reasoningMode ${reasoningMode} -> ${paramName} ${value}${
            allowedValues?.length ? ` (schema options: ${allowedValues.join(', ')})` : ''
          }`
        );
      }
    }

    return extraBody;
  } catch (error) {
    console.warn('Failed to build Poe extra_body payload; falling back to defaults.', error);
    return {};
  }
}

function coerceReasoningMode(value?: string): ReasoningMode {
  if (value && REASONING_MODES.includes(value as ReasoningMode)) {
    return value as ReasoningMode;
  }
  return 'balanced';
}

function convertMessagesToContents(messages: ChatCompletionMessageParam[]): Content[] {
  return messages.map((message) => {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const partsText = Array.isArray(message.content)
      ? message.content
          .map((part) => {
            if (typeof part === 'string') {
              return part;
            }
            if ('text' in part && typeof part.text === 'string') {
              return part.text;
            }
            return JSON.stringify(part);
          })
          .join('\n')
      : message.content;

    if (!partsText) {
      throw new Error('Unable to convert message content for Gemini test payload.');
    }

    return {
      role,
      parts: [{ text: partsText }]
    } as Content;
  });
}

interface TestResult {
  provider: string;
  status: 'ok' | 'skipped' | 'error';
  detail: string;
  latencyMs?: number;
}

/**
 * Parses CLI arguments and returns the list of providers to exercise.
 * Accepts repeated flags (`--provider openai --provider gemini`) or comma-delimited lists
 * (`--providers openai,poe`). Defaults to all providers when no filter is given.
 */
function parseProviderSelection(argv: string[]): ProviderName[] {
  const selected = new Set<ProviderName>();

  const addProvidersFromValue = (raw?: string) => {
    if (!raw) {
      console.warn('Provider flag specified without a value; ignoring.');
      return;
    }
    raw
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter((v): v is ProviderName => {
        if ((AVAILABLE_PROVIDERS as string[]).includes(v)) {
          return true;
        }
        if (v) {
          console.warn(`Unknown provider "${v}" – supported values: ${AVAILABLE_PROVIDERS.join(', ')}`);
        }
        return false;
      })
      .forEach((provider) => selected.add(provider));
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('-')) {
      continue;
    }

    if (arg === '--provider' || arg === '-p' || arg === '--providers') {
      addProvidersFromValue(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg.startsWith('--provider=') || arg.startsWith('--providers=')) {
      addProvidersFromValue(arg.split('=')[1]);
      continue;
    }
  }

  if (!selected.size) {
    AVAILABLE_PROVIDERS.forEach((provider) => selected.add(provider));
  }

  return Array.from(selected);
}

async function testOpenAI(reasoningMode: ReasoningMode): Promise<TestResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { provider: 'openai', status: 'skipped', detail: 'OPENAI_API_KEY missing' };
  }

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
  const normalizedReasoningEffort =
    reasoningEffort && reasoningEffort !== 'none' ? (reasoningEffort === 'minimal' ? 'low' : reasoningEffort) : undefined;

  try {
    const openai = new OpenAI(config);
    const started = Date.now();
    const payload: ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: DEFAULT_MESSAGES
    };

    if (isReasoningModel) {
      if (normalizedReasoningEffort) {
        payload.reasoning_effort = normalizedReasoningEffort;
        console.log(`Sending reasoning_effort: ${normalizedReasoningEffort}`);
      } else {
        console.log('Reasoning model detected but no reasoning_effort derived; sending none.');
      }
    } else {
      payload.temperature = temperature;
      console.log(`Sending temperature: ${temperature}`);
    }

    const completion = await openai.chat.completions.create(payload);

    const latencyMs = Date.now() - started;
    return {
      provider: 'openai',
      status: 'ok',
      detail: completion.choices[0]?.message?.content || 'No content returned',
      latencyMs
    };
  } catch (error: any) {
    return {
      provider: 'openai',
      status: 'error',
      detail: error?.message || 'Unknown error'
    };
  }
}

async function testGemini(reasoningMode: ReasoningMode): Promise<TestResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { provider: 'gemini', status: 'skipped', detail: 'GEMINI_API_KEY missing' };
  }

  const gemini = new GoogleGenAI({ apiKey });
  const model = GEMINI_MODEL;
  const temperature = GEMINI_TEMPERATURE;

  try {
    const contents = convertMessagesToContents(DEFAULT_MESSAGES);
    const started = Date.now();
    const result = await gemini.models.generateContent({
      model,
      contents,
      config: { temperature }
    });

    const text =
      result?.text ||
      result?.candidates
        ?.map((candidate) => candidate.content?.parts?.map((part: any) => part.text).join('\n'))
        .join('\n');

    const latencyMs = Date.now() - started;
    return {
      provider: 'gemini',
      status: 'ok',
      detail: text || 'No content returned',
      latencyMs
    };
  } catch (error: any) {
    return {
      provider: 'gemini',
      status: 'error',
      detail: error?.message || 'Unknown error'
    };
  }
}

async function testPoe(reasoningMode: ReasoningMode): Promise<TestResult> {
  const apiKey = process.env.POE_API_KEY;
  if (!apiKey) {
    return { provider: 'poe', status: 'skipped', detail: 'POE_API_KEY missing' };
  }

  const model = POE_MODEL;
  const temperature = POE_TEMPERATURE;
  const poe = new OpenAI({
    apiKey,
    baseURL: 'https://api.poe.com/v1'
  });

  try {
    const extraBody = await buildPoeExtraBody(reasoningMode, model, apiKey);
    const started = Date.now();
    const completion = await poe.chat.completions.create({
      model,
      messages: DEFAULT_MESSAGES,
      temperature,
      ...(Object.keys(extraBody).length ? { extra_body: extraBody } : {})
    });

    const latencyMs = Date.now() - started;
    return {
      provider: 'poe',
      status: 'ok',
      detail: completion.choices[0]?.message?.content || 'No content returned',
      latencyMs
    };
  } catch (error: any) {
    return {
      provider: 'poe',
      status: 'error',
      detail: error?.message || 'Unknown error'
    };
  }
}

async function main() {
  const reasoningMode = coerceReasoningMode(process.env.REASONING_MODE);
  const selectedProviders = parseProviderSelection(process.argv.slice(2));
  console.log(
    `Running provider smoke tests with reasoning mode: ${reasoningMode} (providers: ${selectedProviders.join(', ')})`
  );

  const providerRunners: Record<ProviderName, (mode: ReasoningMode) => Promise<TestResult>> = {
    openai: testOpenAI,
    gemini: testGemini,
    poe: testPoe
  };

  const results = await Promise.all(selectedProviders.map((provider) => providerRunners[provider](reasoningMode)));

  for (const result of results) {
    const prefix = result.status === 'ok' ? '✅' : result.status === 'skipped' ? '⚪' : '❌';
    const latency = result.latencyMs ? ` (${result.latencyMs} ms)` : '';
    console.log(`${prefix} [${result.provider}] ${result.detail}${latency}`);
  }
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exitCode = 1;
});
