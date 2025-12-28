import {
  GoogleGenAI,
  type Content,
  type GenerateContentConfig,
  type GenerateContentParameters,
  ThinkingLevel
} from '@google/genai';
import { ConfigKeys, ConfigurationManager } from './config';
import { ModelRegistry } from './model-registry';
import { deriveThinkingBudget, ReasoningMode } from './reasoning-utils';

let cachedClient: GoogleGenAI | null = null;
type GeminiModelCapability = {
  supportsThinking: boolean;
};

type GeminiThinkingConfig = NonNullable<GenerateContentConfig['thinkingConfig']>;
type GeminiThinkingLevel = Extract<NonNullable<GeminiThinkingConfig['thinkingLevel']>, ThinkingLevel.LOW | ThinkingLevel.HIGH>;

const geminiModelCapabilityCache = new Map<string, GeminiModelCapability>();

/**
 * Creates and returns a Gemini API configuration object.
 * @returns {Object} - The Gemini API configuration object.
 * @throws {Error} - Throws an error if the API key is missing or empty.
 */
function getGeminiConfig() {
  const configManager = ConfigurationManager.getInstance();
  const apiKey = configManager.getConfig<string>(ConfigKeys.GEMINI_API_KEY);

  console.log('Gemini Config Check:', {
    hasApiKey: !!apiKey,
    apiKeyLength: apiKey?.length
  });

  if (!apiKey) {
    throw new Error('Gemini API key is not configured. Please set it in VS Code settings under "AI Commit" > "Gemini API Key".');
  }

  if (apiKey.trim().length === 0) {
    throw new Error('Gemini API key is empty. Please provide a valid API key in VS Code settings.');
  }

  const config: {
    apiKey: string;
  } = {
    apiKey
  };

  return config;
}

/**
 * Creates and returns a Gemini API instance.
 * @returns {GoogleGenAI} - The Gemini API instance.
 */
export function createGeminiAPIClient() {
  if (cachedClient) {
    return cachedClient;
  }
  const config = getGeminiConfig();
  cachedClient = new GoogleGenAI({ apiKey: config.apiKey });
  return cachedClient;
}

function normalizeModelIdentifier(modelName: string) {
  return String(modelName ?? '').replace(/^models\//i, '').trim();
}

function getCapabilityCacheKey(modelName: string) {
  return normalizeModelIdentifier(modelName).toLowerCase();
}

function cacheModelCapability(modelName: string, supportsThinking: boolean) {
  const key = getCapabilityCacheKey(modelName);
  if (!key) {
    return;
  }
  geminiModelCapabilityCache.set(key, { supportsThinking });
}

async function modelSupportsThinking(modelName: string, client?: GoogleGenAI) {
  const normalizedName = normalizeModelIdentifier(modelName);
  if (!normalizedName) {
    return false;
  }
  const cacheKey = getCapabilityCacheKey(normalizedName);
  const cached = geminiModelCapabilityCache.get(cacheKey);
  if (cached) {
    return cached.supportsThinking;
  }

  const registry = ModelRegistry.getInstance();
  const registryCapabilities =
    registry.getCapabilities(normalizedName) ?? registry.getCapabilities(modelName);

  if (registryCapabilities?.reasoning === true) {
    cacheModelCapability(normalizedName, true);
    return true;
  }
  if (registryCapabilities?.reasoning === false) {
    cacheModelCapability(normalizedName, false);
    return false;
  }

  const gemini = client ?? createGeminiAPIClient();
  try {
    const model = await gemini.models.get({ model: normalizedName });
    const supportsThinking = Boolean(model?.thinking);
    cacheModelCapability(normalizedName, supportsThinking);
    return supportsThinking;
  } catch (error) {
    console.warn('Unable to determine Gemini model thinking capability from metadata; assuming unsupported.', {
      model: normalizedName,
      message: error?.message
    });
    cacheModelCapability(normalizedName, false);
    return false;
  }
}

function mapReasoningModeToThinkingLevel(reasoningMode: ReasoningMode): GeminiThinkingLevel | undefined {
  if (reasoningMode === 'fast') {
    return ThinkingLevel.LOW;
  }
  if (reasoningMode === 'deep') {
    return ThinkingLevel.HIGH;
  }
  return undefined;
}

function buildThinkingConfig(reasoningMode: ReasoningMode): GeminiThinkingConfig | undefined {
  const thinkingBudget = deriveThinkingBudget(reasoningMode);
  if (!thinkingBudget) {
    return undefined;
  }

  const thinkingConfig: GeminiThinkingConfig = {
    includeThoughts: true,
    thinkingBudget
  };

  const thinkingLevel = mapReasoningModeToThinkingLevel(reasoningMode);
  if (thinkingLevel) {
    thinkingConfig.thinkingLevel = thinkingLevel;
  }

  return thinkingConfig;
}

function normalizeContent(content: any): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part?.type === 'text' && typeof part.text === 'string') {
          return part.text;
        }
        return JSON.stringify(part);
      })
      .join('\n');
  }

  if (typeof content === 'object' && content !== null) {
    if (content.type === 'text' && typeof content.text === 'string') {
      return content.text;
    }
    return JSON.stringify(content);
  }

  return String(content ?? '');
}

function convertMessagesToContents(messages: any[]): Content[] {
  return messages
    .map((message) => {
      const text = normalizeContent(message.content);
      if (!text) {
        return undefined;
      }
      const role = message.role === 'assistant' ? 'model' : 'user';
      return {
        role,
        parts: [{ text }]
      } as Content;
    })
    .filter((content): content is Content => Boolean(content));
}

/**
 * Sends a chat completion request to the Gemini API.
 * @param {any[]} messages - The messages to send to the API.
 * @returns {Promise<string>} - A promise that resolves to the API response.
 */
function wrapWithAbort<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }

  return new Promise<T>((resolve, reject) => {
    const abortHandler = () => {
      signal.removeEventListener('abort', abortHandler);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal.addEventListener('abort', abortHandler);
    promise.then(
      value => {
        signal.removeEventListener('abort', abortHandler);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', abortHandler);
        reject(error);
      }
    );
  });
}

export async function GeminiAPI(messages: any[], options?: { signal?: AbortSignal }) {
  try {
    console.log('Making Gemini API call...');
    const gemini = createGeminiAPIClient();
    const configManager = ConfigurationManager.getInstance();
    const modelName = configManager.getConfig<string>(ConfigKeys.GEMINI_MODEL, 'gemini-2.0-flash-001');
    const temperature = configManager.getConfig<number>(ConfigKeys.GEMINI_TEMPERATURE, 0.7);
    const reasoningMode = configManager.getConfig<ReasoningMode>(ConfigKeys.REASONING_MODE, 'balanced');

    console.log('Gemini API Call Parameters:', {
      model: modelName,
      temperature,
      messageCount: messages.length,
      reasoningMode
    });

    const contents = convertMessagesToContents(messages);
    if (!contents.length) {
      throw new Error('No valid messages to send to Gemini');
    }

    console.log('Sending content to Gemini (first 100 chars):', contents.map(c => c.parts?.map(p => p.text).join(' ')).join('\n').substring(0, 100));

    const supportsThinking = await modelSupportsThinking(modelName, gemini);
    const thinkingConfig = supportsThinking ? buildThinkingConfig(reasoningMode) : undefined;
    const generationConfig: GenerateContentConfig = {};
    let hasGenerationConfig = false;

    if (thinkingConfig) {
      generationConfig.thinkingConfig = thinkingConfig;
      hasGenerationConfig = true;
      if (typeof temperature === 'number') {
        console.log('Skipping Gemini temperature because thinkingConfig is enabled for reasoning mode.');
      }
    } else if (typeof temperature === 'number') {
      generationConfig.temperature = temperature;
      hasGenerationConfig = true;
    }

    console.log('Gemini dynamic config resolution:', {
      supportsThinking,
      appliedThinkingConfig: thinkingConfig ?? null,
      includeTemperature: typeof generationConfig.temperature === 'number'
    });

    const generationRequest: GenerateContentParameters = {
      model: modelName,
      contents
    };

    if (hasGenerationConfig) {
      generationRequest.config = generationConfig;
    }

    const result = await wrapWithAbort(gemini.models.generateContent(generationRequest), options?.signal);

    const text =
      result?.text ||
      result?.candidates?.map(candidate =>
        candidate.content?.parts?.map(part => part.text).join('\n')
      ).join('\n');

    if (!text) {
      throw new Error('Gemini returned empty content');
    }

    console.log('Gemini API call successful');
    return text;

  } catch (error) {
    console.error('Gemini API call failed:', {
      error,
      message: error.message,
      status: error.status,
      statusText: error.statusText,
      code: error.code
    });

    // Provide more specific error messages for common Gemini issues
    let errorMessage = error.message;
    if (error.message.includes('API_KEY_INVALID')) {
      errorMessage = 'Invalid Gemini API key. Please check your API key in VS Code settings.';
    } else if (error.message.includes('PERMISSION_DENIED')) {
      errorMessage = 'Permission denied. Please check if your Gemini API key has the correct permissions.';
    } else if (error.message.includes('MODEL_NOT_FOUND')) {
      errorMessage = 'Gemini model not found. Please select a valid model in VS Code settings.';
    }

    throw new Error(errorMessage);
  }
}

/**
 * Lists available Gemini models that support generateContent.
 * @returns {Promise<string[]>} Array of available model names
 * @throws {Error} When API key is missing or API call fails
 */
export async function listAvailableGeminiModels(): Promise<string[]> {
  const configManager = ConfigurationManager.getInstance();
  const geminiApiKey = configManager.getConfig<string>(ConfigKeys.GEMINI_API_KEY);
  const combinedModels = new Set<string>();

  const registryModels = await loadRegistryModelList();
  registryModels.forEach((model) => combinedModels.add(model));

  if (geminiApiKey) {
    try {
      const gemini = createGeminiAPIClient();
      console.log('Fetching available Gemini models via SDK...');

      const response: any = await gemini.models.list();
      const models = response?.models ?? response ?? [];

      models
        .filter((model: any) => (model?.supportedGenerationMethods || []).includes('generateContent'))
        .forEach((model: any) => {
          const name = model?.name ?? model?.model ?? model?.id ?? '';
          const normalized = normalizeModelIdentifier(name);
          if (normalized) {
            combinedModels.add(normalized);
            cacheModelCapability(normalized, Boolean(model?.thinking));
          }
        });
    } catch (error) {
      console.error('Failed to fetch Gemini models via SDK:', error);
    }
  } else if (!registryModels.length) {
    console.warn('Gemini API key not configured and registry data unavailable; no models to display.');
  }

  const result = Array.from(combinedModels).filter(Boolean).sort();
  console.log(`Resolved ${result.length} available Gemini models (registry + SDK).`);
  return result;
}

async function loadRegistryModelList(): Promise<string[]> {
  const registry = ModelRegistry.getInstance();
  let models = registry.getModels('gemini');
  if (!models.length) {
    try {
      await registry.refresh();
      models = registry.getModels('gemini');
    } catch (error) {
      console.warn('Failed to refresh models.dev registry for Gemini models:', error);
    }
  }
  return models.map(normalizeModelIdentifier).filter(Boolean);
}