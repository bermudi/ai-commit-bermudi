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
    return parameters.find(
      (parameter: PoeParameterDescriptor) => normalizeParameterName(parameter?.name) === lowerParam
    );
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

function extractParameterEnum(model: PoeModelMetadata | undefined, paramName: string): string[] | undefined {
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

  if (flattened.length === 0) {
    return undefined;
  }

  return Array.from(new Set(flattened));
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

    const reasoningEffortHint = deriveReasoningEffortFromMode(reasoningMode);
    const thinkingLevelHint = deriveThinkingLevelFromMode(reasoningMode);

    const modelMetadata = await getPoeModelMetadata(model);
    const maxThinkingBudget = extractMaxThinkingBudget(modelMetadata);

    const extraBody: Record<string, string | number> = {};
    const dynamicParameterLogs: string[] = [];

    const logDynamicParameter = (paramName: string, value: string | number, context: string) => {
      const message = `Mapping ReasoningMode '${reasoningMode}' to ${paramName} '${value}' ${context}`;
      dynamicParameterLogs.push(message);
      console.log(message);
    };

    const thinkingBudgetDescriptor = getParameterDescriptor(modelMetadata, 'thinking_budget');
    if (thinkingBudgetDescriptor) {
      const thinkingBudgetValue = deriveThinkingBudget(reasoningMode, maxThinkingBudget);
      if (thinkingBudgetValue && thinkingBudgetValue > 0) {
        extraBody.thinking_budget = thinkingBudgetValue;
        logDynamicParameter(
          'thinking_budget',
          thinkingBudgetValue,
          `(schema max: ${maxThinkingBudget ?? 'unknown'})`
        );
      }
    }

    const enumParameters = ['thinking_level', 'reasoning_effort', 'output_effort'] as const;
    for (const paramName of enumParameters) {
      const allowedValues = extractParameterEnum(modelMetadata, paramName);
      if (!allowedValues?.length) {
        continue;
      }
      const mappedValue = mapModeToEnum(reasoningMode, allowedValues);
      extraBody[paramName] = mappedValue;
      logDynamicParameter(paramName, mappedValue, `(schema options: ${allowedValues.join(', ')})`);
    }

    console.log('Poe API Call Parameters:', {
      model,
      temperature,
      messageCount: messages.length,
      reasoningMode,
      reasoningEffortHint,
      thinkingLevelHint,
      maxThinkingBudget,
      extraBody,
      dynamicParameterLogs
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
