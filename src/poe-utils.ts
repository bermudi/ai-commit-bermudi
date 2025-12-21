import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';
import { ConfigKeys, ConfigurationManager } from './config';
import {
  deriveReasoningEffortFromMode,
  deriveThinkingBudget,
  deriveThinkingLevelFromMode,
  ReasoningMode
} from './reasoning-utils';

const POE_BASE_URL = 'https://api.poe.com/v1';

interface PoeConfig {
  apiKey: string;
  baseURL: string;
}

interface PoeModelMetadata {
  id: string;
  raw: any;
}

let cachedPoeModels: PoeModelMetadata[] | null = null;

function getPoeConfig(): PoeConfig {
  const configManager = ConfigurationManager.getInstance();
  const apiKey = configManager.getConfig<string>(ConfigKeys.POE_API_KEY);

  if (!apiKey) {
    throw new Error('Poe API key is not configured. Please set it in VS Code settings under "AI Commit" > "Poe API Key".');
  }

  if (apiKey.trim().length === 0) {
    throw new Error('Poe API key is empty. Please provide a valid API key in VS Code settings.');
  }

  return {
    apiKey,
    baseURL: POE_BASE_URL
  };
}

export function createPoeApi() {
  const config = getPoeConfig();
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  });
}

async function fetchPoeModels(): Promise<PoeModelMetadata[]> {
  const config = getPoeConfig();
  console.log('Fetching available Poe models...');

  const response = await fetch(`${config.baseURL}/models`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const errorPayload = await response.text();
    console.error('Poe models API error:', {
      status: response.status,
      statusText: response.statusText,
      body: errorPayload
    });
    throw new Error(`Poe models.list failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const models: PoeModelMetadata[] = (payload?.data || []).map((model: any) => ({
    id: String(model.id),
    raw: model
  }));

  console.log(`Found ${models.length} available Poe models`);
  cachedPoeModels = models;
  return models;
}

function extractMaxThinkingBudget(modelInfo?: PoeModelMetadata): number | undefined {
  if (!modelInfo?.raw) {
    return undefined;
  }
  const raw = modelInfo.raw;
  return (
    raw?.metadata?.max_thinking_budget ??
    raw?.metadata?.thinking_budget?.max ??
    raw?.parameters?.thinking_budget?.max ??
    raw?.limits?.thinking_budget?.max ??
    raw?.capabilities?.reasoning?.thinking_budget?.max
  );
}

async function getPoeModelMetadata(modelId: string): Promise<PoeModelMetadata | undefined> {
  if (!cachedPoeModels) {
    await fetchPoeModels();
  }

  const match = cachedPoeModels?.find((model) => model.id === modelId);
  if (match) {
    return match;
  }

  // Cache miss – refetch to ensure we have the latest catalog before giving up.
  await fetchPoeModels();
  return cachedPoeModels?.find((model) => model.id === modelId);
}

export async function listAvailablePoeModels(): Promise<string[]> {
  const models = await fetchPoeModels();
  return Array.from(new Set(models.map((model) => model.id))).sort();
}

export async function PoeChatAPI(messages: ChatCompletionMessageParam[]) {
  try {
    console.log('Making Poe API call...');
    const poe = createPoeApi();
    const configManager = ConfigurationManager.getInstance();
    const model = configManager.getConfig<string>(ConfigKeys.POE_MODEL, 'Claude-Sonnet-4.5');
    const temperature = configManager.getConfig<number>(ConfigKeys.POE_TEMPERATURE, 0.7);
    const reasoningMode = configManager.getConfig<ReasoningMode>(ConfigKeys.REASONING_MODE, 'balanced');

    const reasoningEffort = deriveReasoningEffortFromMode(reasoningMode);
    const thinkingLevel = deriveThinkingLevelFromMode(reasoningMode);

    const modelMetadata = await getPoeModelMetadata(model);
    const maxThinkingBudget = extractMaxThinkingBudget(modelMetadata);
    const thinkingBudget = deriveThinkingBudget(reasoningMode, maxThinkingBudget);

    const extraBody: Record<string, string | number> = {};
    if (reasoningEffort) {
      extraBody.reasoning_effort = reasoningEffort;
    }
    if (thinkingLevel) {
      extraBody.thinking_level = thinkingLevel;
    }
    if (thinkingBudget && thinkingBudget > 0) {
      extraBody.thinking_budget = thinkingBudget;
    }

    console.log('Poe API Call Parameters:', {
      model,
      temperature,
      messageCount: messages.length,
      reasoningMode,
      reasoningEffort,
      thinkingLevel,
      thinkingBudget,
      maxThinkingBudget
    });

    const completion = await poe.chat.completions.create({
      model,
      messages,
      temperature,
      ...(Object.keys(extraBody).length > 0 ? { extra_body: extraBody } : {})
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Poe returned empty content');
    }

    console.log('Poe API call successful');
    return content;
  } catch (error) {
    console.error('Poe API call failed:', {
      error,
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      code: error.code
    });

    let errorMessage = error.message;
    const status = error.response?.status;
    if (status === 401) {
      errorMessage = 'Invalid Poe API key or unauthorized access';
    } else if (status === 402) {
      errorMessage = 'Poe API insufficient credits. Please check your subscription points.';
    } else if (status === 429) {
      errorMessage = 'Poe API rate limit exceeded. Please try again later.';
    }

    throw new Error(errorMessage);
  }
}
