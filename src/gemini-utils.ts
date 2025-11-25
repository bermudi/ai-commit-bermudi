import { GoogleGenerativeAI } from "@google/generative-ai";
import { ConfigKeys, ConfigurationManager } from './config';

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
 * @returns {GoogleGenerativeAI} - The Gemini API instance.
 */
export function createGeminiAPIClient() {
  const config = getGeminiConfig();
  return new GoogleGenerativeAI(config.apiKey);
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

    const model = gemini.getGenerativeModel({ model: modelName });
    const chat = model.startChat({
      generationConfig: {
        temperature: temperature,
      },
    });

    const content = messages.map(msg => msg.content).join('\n');
    console.log('Sending content to Gemini (first 100 chars):', content.substring(0, 100));

    const result = await chat.sendMessage(content);
    const response = result.response;
    const text = response.text();

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
    const apiKey = getGeminiConfig().apiKey;

    console.log('Fetching available Gemini models...');

    // Use direct API call to list models
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      {
        headers: {
          'x-goog-api-key': apiKey
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini models API error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      });
      throw new Error(`Gemini models.list failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const modelNames: string[] = (data.models || [])
      .filter((model: any) =>
        (model.supportedGenerationMethods || []).includes('generateContent')
      )
      .map((model: any) => String(model.name).replace(/^models\//, ''));

    console.log(`Found ${modelNames.length} available Gemini models`);
    return Array.from(new Set(modelNames)).sort();

  } catch (error) {
    console.error('Failed to fetch Gemini models:', error);
    throw error;
  }
}