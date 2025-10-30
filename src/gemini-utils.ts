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

  if (!apiKey) {
    throw new Error('The GEMINI_API_KEY environment variable is missing or empty.');
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
    const gemini = createGeminiAPIClient();
    const configManager = ConfigurationManager.getInstance();
    const modelName = configManager.getConfig<string>(ConfigKeys.GEMINI_MODEL);
    const temperature = configManager.getConfig<number>(ConfigKeys.GEMINI_TEMPERATURE, 0.7);

    const model = gemini.getGenerativeModel({ model: modelName });
    const chat = model.startChat({
      generationConfig: {
        temperature: temperature,
      },
    });

    const result = await chat.sendMessage(messages.map(msg => msg.content));
    const response = result.response;
    const text = response.text();

    return text;

  } catch (error) {
    console.error('Gemini API call failed:', error);
    throw error;
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
      throw new Error(`Gemini models.list failed: ${response.status}`);
    }

    const data = await response.json();
    const modelNames: string[] = (data.models || [])
      .filter((model: any) =>
        (model.supportedGenerationMethods || []).includes('generateContent')
      )
      .map((model: any) => String(model.name).replace(/^models\//, ''));

    return Array.from(new Set(modelNames)).sort();

  } catch (error) {
    console.error('Failed to fetch Gemini models:', error);
    throw error;
  }
}