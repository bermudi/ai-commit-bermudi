import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';
import { ConfigKeys, ConfigurationManager } from './config';
import { deriveReasoningEffortFromMode, ReasoningMode } from './reasoning-utils';

const POE_BASE_URL = 'https://api.poe.com/v1';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PoeConfig {
  apiKey: string;
  baseURL: string;
}

interface PoeModelMetadata {
  id: string;
  /** Full raw model object from Poe's /v1/models endpoint */
  raw: {
    supported_endpoints?: string[];
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Model cache
// ---------------------------------------------------------------------------

let cachedPoeModels: PoeModelMetadata[] | null = null;

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getPoeConfig(): PoeConfig {
  const configManager = ConfigurationManager.getInstance();
  const apiKey = configManager.getConfig<string>(ConfigKeys.POE_API_KEY);

  if (!apiKey) {
    throw new Error(
      'Poe API key is not configured. Please set it in VS Code settings under "AI Commit" > "Poe API Key".'
    );
  }

  if (apiKey.trim().length === 0) {
    throw new Error('Poe API key is empty. Please provide a valid API key in VS Code settings.');
  }

  return {
    apiKey,
    baseURL: POE_BASE_URL,
  };
}

export function createPoeApi() {
  const config = getPoeConfig();
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
}

// ---------------------------------------------------------------------------
// Model listing (kept for the model-picker UI)
// ---------------------------------------------------------------------------

async function fetchPoeModels(): Promise<PoeModelMetadata[]> {
  const config = getPoeConfig();
  console.log('Fetching available Poe models...');

  const response = await fetch(`${config.baseURL}/models`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorPayload = await response.text();
    console.error('Poe models API error:', {
      status: response.status,
      statusText: response.statusText,
      body: errorPayload,
    });
    throw new Error(`Poe models.list failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const models: PoeModelMetadata[] = (payload?.data || []).map((model: any) => ({
    id: String(model.id),
    raw: model,
  }));

  console.log(`Found ${models.length} available Poe models`);
  cachedPoeModels = models;
  return models;
}

/**
 * Look up a single model's metadata in the cache (refetching if necessary).
 */
async function getModelInfo(modelId: string): Promise<PoeModelMetadata | undefined> {
  if (!cachedPoeModels) {
    await fetchPoeModels();
  }

  let match = findModel(modelId);
  if (!match) {
    // Cache miss — refetch once before giving up
    await fetchPoeModels();
    match = findModel(modelId);
  }

  return match;
}

/** Case-insensitive model lookup — Poe IDs are lowercase but users may type PascalCase. */
function findModel(modelId: string): PoeModelMetadata | undefined {
  const normalized = modelId.toLowerCase();
  return cachedPoeModels?.find((m) => m.id.toLowerCase() === normalized);
}

export async function listAvailablePoeModels(): Promise<string[]> {
  const models = await fetchPoeModels();
  return Array.from(new Set(models.map((model) => model.id))).sort();
}

// ---------------------------------------------------------------------------
// API routing — which endpoint does this model support?
// ---------------------------------------------------------------------------

/**
 * Some models return an empty or missing `supported_endpoints` array.
 * In that case we conservatively assume only Chat Completions is available.
 */
function supportsResponsesAPI(modelInfo?: PoeModelMetadata): boolean {
  if (!modelInfo?.raw) return false;
  const endpoints = modelInfo.raw.supported_endpoints;
  if (!Array.isArray(endpoints) || endpoints.length === 0) return false;
  return endpoints.includes('/v1/responses');
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Strip Poe reasoning artifacts (e.g., Thinking headers and blockquotes) that
 * sometimes precede the actual commit message in Chat Completions responses.
 * Only leading artifacts are removed so the returned content remains faithful
 * to the assistant's final answer.
 */
function cleanPoeReasoningOutput(content: string): string {
  if (!content) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const cleaned: string[] = [];
  let skipping = true;
  const thinkingPattern = /^(\*{1,2}|_{1,2})?\s*thinking.*(\*{1,2}|_{1,2})?$/i;

  for (const line of lines) {
    if (skipping) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      if (trimmed.startsWith('>')) {
        continue;
      }
      if (thinkingPattern.test(trimmed)) {
        continue;
      }
      skipping = false;
    }
    cleaned.push(line);
  }

  return cleaned.join('\n').trimStart();
}

// ---------------------------------------------------------------------------
// Responses API helpers
// ---------------------------------------------------------------------------

/**
 * Extract text from a Responses API JSON body.
 *
 * Poe sometimes omits the `output_text` shorthand, leaving text only inside
 * `output[].content[].text`. We try both paths.
 */
function extractResponsesText(data: Record<string, unknown>): string | undefined {
  // Shorthand path (works on some Poe models, not all)
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }

  // Walk the `output` array for message → output_text blocks
  const output = data?.output;
  if (!Array.isArray(output)) return undefined;

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const typedItem = item as Record<string, unknown>;
    if (typedItem.type !== 'message' || !Array.isArray(typedItem.content)) continue;
    for (const block of typedItem.content) {
      if (!block || typeof block !== 'object') continue;
      const typedBlock = block as Record<string, unknown>;
      if (typedBlock.type === 'output_text' && typeof typedBlock.text === 'string') {
        parts.push(typedBlock.text);
      }
    }
  }

  return parts.length ? parts.join('\n') : undefined;
}

// ---------------------------------------------------------------------------
// Responses API path (OpenAI / Anthropic models)
// ---------------------------------------------------------------------------

/**
 * Convert ChatCompletionMessageParam[] to a Responses-API `input` string.
 *
 * The Responses API's `instructions` field is silently ignored on Poe (as of
 * 2026-04), so we inject system-message content as a regular user message
 * instead of relying on it.
 */
function buildResponsesInput(messages: ChatCompletionMessageParam[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const content =
      typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content
              .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
              .filter(Boolean)
              .join('\n')
          : '';

    if (!content) continue;

    // Poe ignores `instructions` — inject all content as unlabeled text.
    // System messages are indistinguishable from user messages in this format,
    // which is the correct workaround.
    parts.push(content);
  }

  return parts.join('\n\n');
}

async function callPoeResponsesAPI(
  messages: ChatCompletionMessageParam[],
  model: string,
  temperature: number,
  reasoningMode: ReasoningMode,
  signal?: AbortSignal
): Promise<string> {
  const config = getPoeConfig();
  const reasoningEffort = deriveReasoningEffortFromMode(reasoningMode);

  const body: Record<string, unknown> = {
    model,
    input: buildResponsesInput(messages),
  };

  // deriveReasoningEffortFromMode('auto') already returns undefined,
  // so the truthiness check on reasoningEffort covers both conditions.
  if (reasoningEffort) {
    body.reasoning = { effort: reasoningEffort };
  }

  // Don't send temperature when reasoning is active.
  // Claude requires t=1 when thinking, GPT rejects it outright,
  // Gemini is the only permissive one. Omitting it works for all three.
  if (!reasoningEffort && temperature > 0) {
    body.temperature = temperature;
  }

  console.log('Poe Responses API call:', {
    model,
    temperature,
    reasoningMode,
    reasoningEffort: reasoningEffort ?? 'not set',
  });

  // Create an AbortController that fires on either the caller's signal
  // or a 60 s wall-clock timeout, whichever happens first.
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    60_000
  );

  let onCallerAbort: (() => void) | undefined;
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      throw signal.reason || new DOMException('Aborted', 'AbortError');
    }
    onCallerAbort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    const response = await fetch(`${config.baseURL}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw Object.assign(new Error(`Poe Responses API error: ${response.status}`), {
        status: response.status,
        response,
        body: errorText,
      });
    }

    const data = await response.json();
    const content = extractResponsesText(data);

    if (!content) {
      throw new Error('Poe Responses API returned empty content');
    }

    console.log('Poe Responses API call successful');
    return content;
  } finally {
    clearTimeout(timeoutId);
    if (onCallerAbort && signal) {
      signal.removeEventListener('abort', onCallerAbort);
    }
  }


}

// ---------------------------------------------------------------------------
// Chat Completions fallback path (models without /v1/responses support)
// ---------------------------------------------------------------------------
// Poe's strict validation allows extra_body for model-declared parameters.
// We check the model's schema for thinking/reasoning params and map
// ReasoningMode to the appropriate values via extra_body.

/** Known thinking/reasoning parameter names from Poe model schemas. */
const THINKING_PARAM_NAMES = [
  'enable_thinking',
  'reasoning_enabled',
  'deep_thinking',
  'enable_reasoning',
  'thinking_mode',
  'thinking',
  'reasoning_effort',
  'output_effort',
  'thinking_level',
  'thinking_budget',
] as const;

interface ModelParamDescriptor {
  name: string;
  schema?: { type?: string; enum?: string[]; maximum?: number };
}

/**
 * Build an extra_body payload for the Chat Completions endpoint by
 * inspecting the model's declared parameters and mapping ReasoningMode
 * to thinking/reasoning knobs that the model actually supports.
 */
function buildChatCompletionsExtraBody(
  reasoningMode: ReasoningMode,
  modelInfo?: PoeModelMetadata
): Record<string, unknown> {
  if (reasoningMode === 'auto' || !modelInfo?.raw) return {};

  const params: ModelParamDescriptor[] = Array.isArray(modelInfo.raw.parameters)
    ? modelInfo.raw.parameters
    : [];

  const extra: Record<string, unknown> = {};

  for (const param of params) {
    const name = param.name?.toLowerCase();
    if (!name || !THINKING_PARAM_NAMES.includes(name as any)) continue;

    const schemaType = param.schema?.type;

    // ── Boolean flags: enable on any non-auto mode ──
    if (schemaType === 'boolean') {
      extra[param.name] = true;
      continue;
    }

    // ── Enum effort levels: pick best match ──
    const allowed = param.schema?.enum;
    if (Array.isArray(allowed) && allowed.length > 0) {
      const mapped = pickBestEnum(reasoningMode, allowed);
      if (mapped) extra[param.name] = mapped;
      continue;
    }

    // ── Numeric budget: scale proportionally ──
    if (schemaType === 'number' || schemaType === 'integer') {
      const max = param.schema?.maximum;
      const budget = scaleThinkingBudget(reasoningMode, max);
      if (budget) extra[param.name] = budget;
      continue;
    }
  }

  return extra;
}

/** Map ReasoningMode to the best-matching value in a model's enum. */
function pickBestEnum(mode: ReasoningMode, allowed: string[]): string | undefined {
  const normalized = allowed.map((v) => ({ orig: v, low: v.toLowerCase() }));

  const preferences: Record<string, string[]> = {
    fast: ['low', 'minimal', 'minimum', 'min', 'none'],
    balanced: ['medium', 'standard', 'balanced'],
    deep: ['high', 'xhigh', 'max', 'maximum', 'enabled'],
  };

  const prefs = preferences[mode];
  if (prefs) {
    const match = normalized.find((v) => prefs.includes(v.low));
    if (match) return match.orig;
  }

  // Fallback: middle of the enum
  return normalized[Math.floor(normalized.length / 2)]?.orig;
}

/** Scale a thinking budget based on reasoning mode. */
function scaleThinkingBudget(mode: ReasoningMode, max?: number): number | undefined {
  const ratios: Record<string, number> = { fast: 0.25, balanced: 0.55, deep: 0.85 };
  const ratio = ratios[mode];
  if (!ratio) return undefined;

  if (typeof max === 'number' && max > 0) {
    return Math.max(1, Math.round(max * ratio));
  }

  const fallbacks: Record<string, number> = { fast: 2048, balanced: 8192, deep: 32768 };
  return fallbacks[mode];
}

async function callPoeChatCompletionsAPI(
  messages: ChatCompletionMessageParam[],
  model: string,
  temperature: number,
  reasoningMode: ReasoningMode,
  signal?: AbortSignal
): Promise<string> {
  const poe = createPoeApi();

  const modelInfo = await getModelInfo(model);
  const extraBody = buildChatCompletionsExtraBody(reasoningMode, modelInfo);

  console.log('Poe Chat Completions API call:', {
    model,
    temperature,
    messageCount: messages.length,
    reasoningMode,
    extraBody: Object.keys(extraBody).length ? extraBody : 'none',
  });

  const completion = await poe.chat.completions.create(
    {
      model,
      messages,
      temperature,
      ...(Object.keys(extraBody).length > 0 ? { extra_body: extraBody } : {}),
    },
    { signal }
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Poe Chat Completions returned empty content');
  }

  console.log('Poe Chat Completions API call successful');
  const cleanedContent = cleanPoeReasoningOutput(content);
  console.log('Poe response reasoning cleanup', {
    originalLength: content.length,
    cleanedLength: cleanedContent.length,
  });
  return cleanedContent;
}

// ---------------------------------------------------------------------------
// Main entry point — routes to the best available API for the configured model
// ---------------------------------------------------------------------------

export async function PoeChatAPI(
  messages: ChatCompletionMessageParam[],
  options?: { signal?: AbortSignal }
) {
  const signal = options?.signal;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * 500);
        console.log(
          `Poe API retry attempt ${attempt}/${MAX_RETRIES}, waiting ${backoffMs + jitter}ms...`
        );
        await sleep(backoffMs + jitter, signal);
      }

      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      console.log(`Making Poe API call (attempt ${attempt + 1})...`);

      const configManager = ConfigurationManager.getInstance();
      const model = configManager.getConfig<string>(ConfigKeys.POE_MODEL, 'Claude-Sonnet-4.5');
      const temperature = configManager.getConfig<number>(ConfigKeys.POE_TEMPERATURE, 0.7);
      const reasoningMode = configManager.getConfig<ReasoningMode>(
        ConfigKeys.REASONING_MODE,
        'balanced'
      );

      // Decide which API to use based on the model's declared capabilities
      const modelInfo = await getModelInfo(model);
      const useResponses = supportsResponsesAPI(modelInfo);

      console.log(`Poe API routing: model=${model}, useResponses=${useResponses}`);

      if (useResponses) {
        return await callPoeResponsesAPI(messages, model, temperature, reasoningMode, signal);
      }

      return await callPoeChatCompletionsAPI(messages, model, temperature, reasoningMode, signal);
    } catch (error: any) {
      lastError = error;

      // Don't retry on abort / cancellation.
      // The OpenAI SDK throws APIUserAbortError for its own aborts;
      // raw fetch and the DOM produce DOMException('Aborted', 'AbortError').
      if (
        error?.name === 'AbortError' ||
        error?.code === 'ABORT_ERR' ||
        error?.name === 'APIUserAbortError' ||
        error?.name === 'TimeoutError'
      ) {
        throw error;
      }

      const status = error?.status ?? error?.response?.status;

      console.error('Poe API call failed:', {
        attempt: attempt + 1,
        error,
        message: error.message,
        status,
        code: error.code,
      });

      // Only retry on 429 (rate limit) or transient server errors (5xx)
      const isRetryable = status === 429 || (status >= 500 && status < 600);
      if (!isRetryable || attempt === MAX_RETRIES) {
        let errorMessage: string = error.message;
        if (status === 401) {
          errorMessage = 'Invalid Poe API key or unauthorized access';
        } else if (status === 402) {
          errorMessage = 'Poe API insufficient credits. Please check your subscription points.';
        } else if (status === 429) {
          errorMessage = 'Poe API rate limit exceeded. Please try again later.';
        }
        throw new Error(errorMessage);
      }

      // Loop continues → retry
    }
  }

  throw lastError ?? new Error('Poe API call failed after retries');
}
