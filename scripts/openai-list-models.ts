import 'dotenv/config';
import OpenAI from 'openai';

function buildOpenAIConfig() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY missing from environment.');
  }

  const config: {
    apiKey: string;
    baseURL?: string;
    defaultQuery?: Record<string, string>;
    defaultHeaders?: Record<string, string>;
  } = { apiKey };

  if (process.env.OPENAI_BASE_URL) {
    config.baseURL = process.env.OPENAI_BASE_URL;
    if (process.env.AZURE_API_VERSION) {
      config.defaultQuery = { 'api-version': process.env.AZURE_API_VERSION };
      config.defaultHeaders = { 'api-key': apiKey };
    }
  }

  return config;
}

async function main() {
  try {
    const openai = new OpenAI(buildOpenAIConfig());
    const response = await openai.models.list();
    if (!response.data.length) {
      console.log('No models returned for this account/key.');
      return;
    }

    console.log(`Found ${response.data.length} OpenAI models accessible with this key:\n`);
    for (const model of response.data) {
      const capabilityHints =
        (model as any)?.capabilities ??
        (model as any)?.metadata?.capabilities ??
        undefined;
      console.log(JSON.stringify({
        id: model.id,
        object: model.object,
        owned_by: (model as any).owned_by,
        modality: (model as any).modality,
        context_window: (model as any).context_window,
        supports_temperature: capabilityHints?.temperature ?? 'unknown',
        capabilities: capabilityHints
      }, null, 2));
      console.log('');
    }
  } catch (error: any) {
    console.error('Failed to list OpenAI models:', error?.message || error);
    process.exitCode = 1;
  }
}

main();
