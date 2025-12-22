import OpenAI from 'openai';
import { ChatCompletionMessageParam, ChatCompletionCreateParamsNonStreaming } from 'openai/resources';
import { ConfigKeys, ConfigurationManager } from './config';
import { deriveReasoningEffortFromMode, ReasoningEffort, ReasoningMode } from './reasoning-utils';

type OpenAIModelCapabilities = {
  temperatureUnsupported?: boolean;
};

const openAICapabilityCache = new Map<string, OpenAIModelCapabilities>();

type OpenAIReasoningEffort = Extract<ReasoningEffort, 'low' | 'medium' | 'high'>;

type ChatCompletionPayload = ChatCompletionCreateParamsNonStreaming & {
  reasoning_effort?: OpenAIReasoningEffort;
};

function toOpenAIReasoningEffort(effort?: ReasoningEffort): OpenAIReasoningEffort | undefined {
  if (!effort || effort === 'none') {
    return undefined;
  }

  if (effort === 'minimal') {
    return 'low';
  }

  if (effort === 'low' || effort === 'medium' || effort === 'high') {
    return effort;
  }

  return undefined;
}


function getModelCapabilities(model: string) {
  const key = model.trim().toLowerCase();
  if (!openAICapabilityCache.has(key)) {
    openAICapabilityCache.set(key, {});
  }
  return openAICapabilityCache.get(key)!;
}

function extractOpenAIErrorMessage(error: any) {
  return error?.response?.data?.error?.message ?? error?.message ?? '';
}

function isUnsupportedTemperatureError(error: any) {
  const status = error?.response?.status;
  const message = extractOpenAIErrorMessage(error)?.toLowerCase?.() ?? '';
  return (
    status === 400 &&
    message.includes('temperature') &&
    (message.includes('unsupported') || message.includes('does not support'))
  );
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

    const resolvedModel = model || 'gpt-4o';
    const isReasoningModel = /^(o1|o3|gpt-5)/i.test(resolvedModel);
    const reasoningEffort = deriveReasoningEffortFromMode(reasoningMode);
    const openAIReasoningEffort = toOpenAIReasoningEffort(reasoningEffort);

    console.log('OpenAI API Call Parameters:', {
      model: resolvedModel,
      temperature,
      messageCount: messages.length,
      reasoningMode,
      reasoningEffort,
      parameterProfile: isReasoningModel ? 'reasoning' : 'standard'
    });
    console.log(isReasoningModel ? 'Using Reasoning Mode parameters' : 'Using Standard parameters');

    const capabilities = getModelCapabilities(resolvedModel);
    const hasCachedTemperatureRestriction = !!capabilities.temperatureUnsupported;
    if (hasCachedTemperatureRestriction && typeof temperature === 'number') {
      console.log(`Skipping custom temperature for model ${model} due to cached capability info.`);
    }

    const buildCompletionPayload = (includeTemperature: boolean): ChatCompletionPayload => {
      const payload: ChatCompletionPayload = {
        model: resolvedModel,
        messages: messages as ChatCompletionMessageParam[]
      };

      if (isReasoningModel) {
        if (openAIReasoningEffort) {
          payload.reasoning_effort = openAIReasoningEffort;
        }
      } else if (includeTemperature && typeof temperature === 'number') {
        payload.temperature = temperature;
      }

      return payload;
    };

    const createCompletion = (includeTemperature: boolean) =>
      openai.chat.completions.create(buildCompletionPayload(includeTemperature));

    const shouldIncludeTemperature =
      !isReasoningModel && !hasCachedTemperatureRestriction && typeof temperature === 'number';

    let completion;
    try {
      completion = await createCompletion(shouldIncludeTemperature);
    } catch (innerError) {
      if (shouldIncludeTemperature && isUnsupportedTemperatureError(innerError)) {
        capabilities.temperatureUnsupported = true;
        console.warn('Selected OpenAI model does not support custom temperature; retrying without temperature.', {
          model,
          requestedTemperature: temperature,
          message: extractOpenAIErrorMessage(innerError)
        });
        completion = await createCompletion(false);
      } else {
        throw innerError;
      }
    }

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
