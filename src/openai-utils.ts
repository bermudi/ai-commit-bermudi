import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';
import { ConfigKeys, ConfigurationManager } from './config';
import { deriveReasoningEffortFromMode, ReasoningEffort, ReasoningMode } from './reasoning-utils';

export const REASONING_MODEL_PATTERNS = [/^gpt-5(\.|$)/i, /^o[1-4](\.|$)/i];

export function isReasoningModel(model?: string) {
  if (!model) {
    return false;
  }
  const normalized = model.trim();
  return REASONING_MODEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizeReasoningEffortForModel(model: string | undefined, effort?: ReasoningEffort) {
  if (!model || !effort) {
    return undefined;
  }

  const normalized = model.toLowerCase();
  if (normalized.includes('gpt-5-pro')) {
    return 'high';
  }

  return effort;
}

function deriveOpenAIReasoningEffort(model: string | undefined, mode: ReasoningMode) {
  if (!isReasoningModel(model)) {
    return undefined;
  }
  const baseEffort = deriveReasoningEffortFromMode(mode);
  return normalizeReasoningEffortForModel(model, baseEffort);
}

/**
 * Creates and returns an OpenAI configuration object.
 * @returns {Object} - The OpenAI configuration object.
 * @throws {Error} - Throws an error if the API key is missing or empty.
 */
function getOpenAIConfig() {
  const configManager = ConfigurationManager.getInstance();
  const apiKey = configManager.getConfig<string>(ConfigKeys.OPENAI_API_KEY);
  const baseURL = configManager.getConfig<string>(ConfigKeys.OPENAI_BASE_URL);
  const apiVersion = configManager.getConfig<string>(ConfigKeys.AZURE_API_VERSION);

  console.log('OpenAI Config Check:', {
    hasApiKey: !!apiKey,
    apiKeyLength: apiKey?.length,
    baseURL: baseURL || 'default',
    apiVersion: apiVersion || 'not set'
  });

  if (!apiKey) {
    throw new Error('OpenAI API key is not configured. Please set it in VS Code settings under "AI Commit" > "OpenAI API Key".');
  }

  if (apiKey.trim().length === 0) {
    throw new Error('OpenAI API key is empty. Please provide a valid API key in VS Code settings.');
  }

  // Basic validation for OpenAI API key format
  if (!apiKey.startsWith('sk-') && !baseURL) {
    console.warn('API key does not start with "sk-" which is unusual for OpenAI keys');
  }

  const config: {
    apiKey: string;
    baseURL?: string;
    defaultQuery?: { 'api-version': string };
    defaultHeaders?: { 'api-key': string };
  } = {
    apiKey
  };

  if (baseURL) {
    config.baseURL = baseURL;
    if (apiVersion) {
      config.defaultQuery = { 'api-version': apiVersion };
      config.defaultHeaders = { 'api-key': apiKey };
    }
  }

  return config;
}

/**
 * Creates and returns an OpenAI API instance.
 * @returns {OpenAI} - The OpenAI API instance.
 */
export function createOpenAIApi() {
  const config = getOpenAIConfig();
  return new OpenAI(config);
}

/**
 * Sends a chat completion request to the OpenAI API.
 * @param {Array<Object>} messages - The messages to send to the API.
 * @returns {Promise<string>} - A promise that resolves to the API response.
 */
export async function ChatGPTAPI(messages: ChatCompletionMessageParam[]) {
  try {
    console.log('Making OpenAI API call...');
    const openai = createOpenAIApi();
    const configManager = ConfigurationManager.getInstance();
    const model = configManager.getConfig<string>(ConfigKeys.OPENAI_MODEL, 'gpt-4o');
    const temperature = configManager.getConfig<number>(ConfigKeys.OPENAI_TEMPERATURE, 0.7);
    const reasoningMode = configManager.getConfig<ReasoningMode>(ConfigKeys.REASONING_MODE, 'balanced');
    const reasoningEffort = deriveOpenAIReasoningEffort(model, reasoningMode);

    console.log('OpenAI API Call Parameters:', {
      model,
      temperature,
      messageCount: messages.length,
      reasoningMode,
      reasoningEffort
    });

    const completionPayload: any = {
      model,
      messages: messages as ChatCompletionMessageParam[],
      temperature
    };

    if (reasoningEffort) {
      completionPayload.reasoning_effort = reasoningEffort;
    }

    const completion = await openai.chat.completions.create(completionPayload);

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned empty content');
    }

    console.log('OpenAI API call successful');
    return content;
  } catch (error) {
    console.error('OpenAI API call failed:', {
      error,
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      code: error.code
    });

    // Re-throw with additional context
    throw error;
  }
}
