import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';
import { ConfigKeys, ConfigurationManager } from './config';

const POE_BASE_URL = 'https://api.poe.com/v1';

type ReasoningEffort = 'auto' | 'low' | 'medium' | 'high' | 'max';

interface PoeConfig {
  apiKey: string;
  baseURL: string;
}

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

export async function listAvailablePoeModels(): Promise<string[]> {
  try {
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
    const models: string[] = (payload?.data || []).map((model: any) => String(model.id));

    console.log(`Found ${models.length} available Poe models`);
    return Array.from(new Set(models)).sort();
  } catch (error) {
    console.error('Failed to fetch Poe models:', error);
    throw error;
  }
}

export async function PoeChatAPI(messages: ChatCompletionMessageParam[]) {
  try {
    console.log('Making Poe API call...');
    const poe = createPoeApi();
    const configManager = ConfigurationManager.getInstance();
    const model = configManager.getConfig<string>(ConfigKeys.POE_MODEL, 'Claude-Sonnet-4.5');
    const temperature = configManager.getConfig<number>(ConfigKeys.POE_TEMPERATURE, 0.7);
    const reasoningEffort = configManager.getConfig<ReasoningEffort>(ConfigKeys.REASONING_EFFORT, 'auto');
    const thinkingLevel = configManager.getConfig<string>(ConfigKeys.THINKING_LEVEL, 'auto');
    const thinkingBudget = configManager.getConfig<number>(ConfigKeys.THINKING_BUDGET, 0);

    const extraBody: Record<string, string | number> = {};
    if (reasoningEffort && reasoningEffort !== 'auto') {
      extraBody.reasoning_effort = reasoningEffort;
    }
    if (thinkingLevel && thinkingLevel !== 'auto') {
      extraBody.thinking_level = thinkingLevel;
    }
    if (thinkingBudget && thinkingBudget > 0) {
      extraBody.thinking_budget = thinkingBudget;
    }

    console.log('Poe API Call Parameters:', {
      model,
      temperature,
      messageCount: messages.length,
      reasoningEffort,
      thinkingLevel,
      thinkingBudget
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
