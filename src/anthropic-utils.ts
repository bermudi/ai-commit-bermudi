import Anthropic from '@anthropic-ai/sdk';
import type {
  Message as AnthropicMessage,
  MessageParam,
  MessageCreateParamsNonStreaming
} from '@anthropic-ai/sdk/resources/messages';
import { ChatCompletionMessageParam } from 'openai/resources';
import { ConfigKeys, ConfigurationManager } from './config';
import { ReasoningMode } from './reasoning-utils';

let cachedClient: { client: Anthropic; apiKey: string } | null = null;

function createAnthropicClient(apiKey: string) {
  if (cachedClient?.apiKey === apiKey) {
    return cachedClient.client;
  }
  const client = new Anthropic({ apiKey });
  cachedClient = { client, apiKey };
  return client;
}

function extractMessageText(content: ChatCompletionMessageParam['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) {
          return '';
        }
        if (typeof (part as any).text === 'string') {
          return (part as any).text;
        }
        if ((part as any).type === 'text' && typeof (part as any).text === 'string') {
          return (part as any).text;
        }
        return typeof part === 'string' ? part : JSON.stringify(part);
      })
      .filter(Boolean)
      .join('\n');
  }
  if ((content as any)?.type === 'text' && typeof (content as any).text === 'string') {
    return (content as any).text;
  }
  return String(content ?? '');
}

function convertMessages(messages: ChatCompletionMessageParam[]): { system?: string; conversation: MessageParam[] } {
  const systemParts: string[] = [];
  const conversation: MessageParam[] = [];

  for (const message of messages) {
    const text = extractMessageText(message.content);
    if (!text) {
      continue;
    }
    if (message.role === 'system') {
      systemParts.push(text);
      continue;
    }
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    conversation.push({
      role,
      content: [{ type: 'text', text }]
    });
  }

  return {
    system: systemParts.length ? systemParts.join('\n\n') : undefined,
    conversation
  };
}

type ThinkingConfig = { thinking: { effort: 'low' | 'medium' | 'high' } };

function mapReasoningModeToThinking(reasoningMode: ReasoningMode): ThinkingConfig | undefined {
  switch (reasoningMode) {
    case 'deep':
      return { thinking: { effort: 'high' } };
    case 'balanced':
      return { thinking: { effort: 'medium' } };
    case 'fast':
      return { thinking: { effort: 'low' } };
    default:
      return undefined;
  }
}

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
      (value) => {
        signal.removeEventListener('abort', abortHandler);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abortHandler);
        reject(error);
      }
    );
  });
}

export async function AnthropicAPI(
  messages: ChatCompletionMessageParam[],
  options: { signal?: AbortSignal; apiKey: string; reasoningMode: ReasoningMode }
) {
  const { apiKey, signal, reasoningMode } = options;
  if (!apiKey) {
    throw new Error('Anthropic API key is required');
  }

  try {
    const client = createAnthropicClient(apiKey);
    const configManager = ConfigurationManager.getInstance();
    const model = configManager.getConfig<string>(ConfigKeys.ANTHROPIC_MODEL, 'claude-3-5-sonnet-20241022');
    const temperature = configManager.getConfig<number>(ConfigKeys.ANTHROPIC_TEMPERATURE, 0.7);
    const { system, conversation } = convertMessages(messages);

    if (!conversation.length) {
      throw new Error('No valid messages to send to Anthropic');
    }

    const thinkingConfig = mapReasoningModeToThinking(reasoningMode);

    type ExtendedPayload = MessageCreateParamsNonStreaming & { thinking?: ThinkingConfig['thinking'] };

    const payload: ExtendedPayload = {
      model,
      max_tokens: 1024,
      temperature,
      messages: conversation,
      stream: false,
      ...(system ? { system } : {})
    };

    if (thinkingConfig) {
      payload.thinking = thinkingConfig.thinking;
    }

    const response = await wrapWithAbort<AnthropicMessage>(
      client.messages.create(payload as MessageCreateParamsNonStreaming) as unknown as Promise<AnthropicMessage>,
      signal
    );

    const text = response.content
      .map((part) => (part.type === 'text' ? part.text : JSON.stringify(part)))
      .join('\n')
      .trim();

    if (!text) {
      throw new Error('Anthropic returned empty content');
    }

    return text;
  } catch (error: any) {
    console.error('Anthropic API call failed:', {
      error,
      message: error?.message,
      status: error?.status,
      statusText: error?.statusText,
      code: error?.code
    });

    let errorMessage = error?.message ?? 'Anthropic API request failed';
    if (error?.status === 401) {
      errorMessage = 'Invalid Anthropic API key or unauthorized access';
    } else if (error?.status === 429) {
      errorMessage = 'Anthropic rate limit exceeded. Please try again later.';
    }

    throw new Error(errorMessage);
  }
}
