import 'dotenv/config';
import OpenAI from 'openai';
import { GoogleGenAI, type Content } from '@google/genai';
import type { ChatCompletionMessageParam } from 'openai/resources';
import {
  deriveReasoningEffortFromMode,
  deriveThinkingBudget,
  deriveThinkingLevelFromMode,
  ReasoningMode
} from '../src/reasoning-utils';
import { isReasoningModel } from '../src/openai-utils';

/**
 * Provider smoke test runner.
 *
 * This script fires the same lightweight prompt at OpenAI, Gemini, and Poe so you
 * can verify credentials, model access, and reasoning knobs (effort/thinking budget)
 * without staging a git commit inside VS Code. Configure API keys via environment
 * variables or tweak the constants below, then run `pnpm exec tsx scripts/provider-smoke-test.ts`.
 */

const DEFAULT_MESSAGES: ChatCompletionMessageParam[] = [
  {
    role: 'system',
    content: 'You are a concise assistant that only produces short bullet lists.'
  },
  {
    role: 'user',
    content: 'List three bullet points describing why conventional commits help teams.'
  }
];

// Centralized model + temperature configuration so you can tweak everything quickly.
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-nano';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const POE_MODEL = process.env.POE_MODEL || 'gpt-5-nano';
const OPENAI_TEMPERATURE = Number(process.env.OPENAI_TEMPERATURE ?? '0.7');
const GEMINI_TEMPERATURE = Number(process.env.GEMINI_TEMPERATURE ?? '0.7');
const POE_TEMPERATURE = Number(process.env.POE_TEMPERATURE ?? '0.7');

const REASONING_MODES: ReasoningMode[] = ['auto', 'fast', 'balanced', 'deep'];
type OpenAIReasoningEffort = 'low' | 'medium' | 'high';

function normalizeOpenAIReasoningEffort(
  effort?: ReturnType<typeof deriveReasoningEffortFromMode>
): OpenAIReasoningEffort | undefined {
  if (!effort) {
    return undefined;
  }
  if (effort === 'low' || effort === 'medium' || effort === 'high') {
    return effort;
  }
  return undefined;
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
  const derivedEffort = deriveReasoningEffortFromMode(reasoningMode);
  const reasoningEffort = isReasoningModel(model)
    ? normalizeOpenAIReasoningEffort(derivedEffort)
    : undefined;

  try {
    const openai = new OpenAI(config);
    const started = Date.now();
    const completion = await openai.chat.completions.create({
      model,
      messages: DEFAULT_MESSAGES,
      temperature,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {})
    });

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

  const reasoningEffort = deriveReasoningEffortFromMode(reasoningMode);
  const thinkingLevel = deriveThinkingLevelFromMode(reasoningMode);
  const thinkingBudget = deriveThinkingBudget(reasoningMode);

  const extraBody: Record<string, string | number> = {};
  if (reasoningEffort) {
    extraBody.reasoning_effort = reasoningEffort;
  }
  if (thinkingLevel) {
    extraBody.thinking_level = thinkingLevel;
  }
  if (thinkingBudget) {
    extraBody.thinking_budget = thinkingBudget;
  }

  try {
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
  console.log(`Running provider smoke tests with reasoning mode: ${reasoningMode}`);

  const results = await Promise.all([
    testOpenAI(reasoningMode),
    testGemini(reasoningMode),
    testPoe(reasoningMode)
  ]);

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
