import { GoogleGenAI, Content } from '@google/genai';
import { ConfigKeys, ConfigurationManager } from './config';

let cachedClient: GoogleGenAI | null = null;

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
export async function GeminiAPI(messages: any[]) {
  try {
    console.log('Making Gemini API call...');
    const gemini = createGeminiAPIClient();
    const configManager = ConfigurationManager.getInstance();
    const modelName = configManager.getConfig<string>(ConfigKeys.GEMINI_MODEL, 'gemini-2.0-flash-001');
    const temperature = configManager.getConfig<number>(ConfigKeys.GEMINI_TEMPERATURE, 0.7);

    console.log('Gemini API Call Parameters:', {
      model: modelName,
      temperature,
      messageCount: messages.length
    });

    const contents = convertMessagesToContents(messages);
    if (!contents.length) {
      throw new Error('No valid messages to send to Gemini');
    }

    console.log('Sending content to Gemini (first 100 chars):', contents.map(c => c.parts?.map(p => p.text).join(' ')).join('\n').substring(0, 100));

    const result = await gemini.models.generateContent({
      model: modelName,
      contents,
      config: {
        temperature
      }
    });

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
  try {
    const gemini = createGeminiAPIClient();

    console.log('Fetching available Gemini models via SDK...');

    const response: any = await gemini.models.list();
    const models = response?.models ?? response ?? [];

    const modelNames: string[] = models
      .filter((model: any) =>
        (model?.supportedGenerationMethods || []).includes('generateContent')
      )
      .map((model: any) => {
        const name = model?.name ?? model?.model ?? model?.id ?? '';
        return String(name).replace(/^models\//, '');
      })
      .filter(Boolean);

    console.log(`Found ${modelNames.length} available Gemini models`);
    return Array.from(new Set(modelNames)).sort();

  } catch (error) {
    console.error('Failed to fetch Gemini models:', error);
    throw error;
  }
}