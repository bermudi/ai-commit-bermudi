import * as fs from 'fs-extra';
import * as path from 'path'; // Added path import
import { ChatCompletionMessageParam } from 'openai/resources';
import * as vscode from 'vscode';
import { ConfigKeys, ConfigurationManager } from './config';
import { getBranchName, getChanges, getRecentCommits } from './git-utils'; // Added getBranchName
import { OpenAICompatibleAPI } from './openai-utils';
import { getMainCommitPrompt } from './prompts';
import { ProgressHandler, createAbortControllerFromToken, throwIfCancelled } from './utils';
import { GeminiAPI } from './gemini-utils';
import { PoeChatAPI } from './poe-utils';
import { AnthropicAPI } from './anthropic-utils';
import { checkAndPromptForConfiguration, ProviderName, normalizeProvider } from './provider-config';
import { ModelRegistry } from './model-registry';
import { KeyManager } from './secret-storage';
import { ReasoningMode } from './reasoning-utils';


/**
 * Generates a chat completion prompt for the commit message based on the provided diff.
 *
 * @param {string} diff - The diff string representing changes to be committed.
 * @param {string} additionalContext - Additional context for the changes.
 * @param {string} branchName - The current git branch name.
 * @returns {Promise<Array<{ role: string, content: string }>>} - A promise that resolves to an array of messages for the chat completion.
 */
const generateCommitMessageChatCompletionPrompt = async (
  diff: string,
  additionalContext: string | undefined,
  branchName: string | undefined,
  recentCommits: string
) => {
  const INIT_MESSAGES_PROMPT = await getMainCommitPrompt();
  const chatContextAsCompletionRequest = [...INIT_MESSAGES_PROMPT];

  let contextMsg = `Input Data:\n`;
  if (branchName) contextMsg += `Git Branch: ${branchName}\n`;
  if (recentCommits) contextMsg += `Recent Commits:\n${recentCommits}\n`;
  if (additionalContext) contextMsg += `User Notes: ${additionalContext}\n`;

  if (branchName || recentCommits || additionalContext) {
    chatContextAsCompletionRequest.push({
      role: 'user',
      content: contextMsg
    });
  }

  chatContextAsCompletionRequest.push({
    role: 'user',
    content: `Git Diff:\n${diff}`
  });
  return chatContextAsCompletionRequest;
};

/**
 * Retrieves the repository associated with the provided argument.
 *
 * @param {any} arg - The input argument containing the root URI of the repository.
 * @returns {Promise<vscode.SourceControlRepository>} - A promise that resolves to the repository object.
 */
export async function getRepo(arg) {
  try {
    console.log('Getting Git repository...');
    const gitExtension = vscode.extensions.getExtension('vscode.git');

    if (!gitExtension) {
      throw new Error('Git extension not found. Please ensure the Git extension is installed and enabled.');
    }

    if (!gitExtension.isActive) {
      console.log('Activating Git extension...');
      await gitExtension.activate();
    }

    const gitApi = gitExtension.exports.getAPI(1);
    if (!gitApi) {
      throw new Error('Failed to get Git API. Please restart VS Code and try again.');
    }

    console.log(`Found ${gitApi.repositories.length} Git repositories`);

    if (typeof arg === 'object' && arg.rootUri) {
      const resourceUri = arg.rootUri;
      const realResourcePath: string = fs.realpathSync(resourceUri!.fsPath);
      console.log(`Looking for repository matching path: ${realResourcePath}`);

      for (let i = 0; i < gitApi.repositories.length; i++) {
        const repo = gitApi.repositories[i];
        console.log(`Checking repository ${i}: ${repo.rootUri.fsPath}`);
        if (realResourcePath.startsWith(repo.rootUri.fsPath)) {
          console.log(`Found matching repository: ${repo.rootUri.fsPath}`);
          return repo;
        }
      }
    }

    if (gitApi.repositories.length === 0) {
      throw new Error('No Git repositories found. Please open a Git repository or initialize one in your workspace.');
    }

    console.log(`Using first repository: ${gitApi.repositories[0].rootUri.fsPath}`);
    return gitApi.repositories[0];
  } catch (error) {
    console.error('Error getting Git repository:', {
      error,
      message: error.message,
      stack: error.stack,
      arg
    });

    // Re-throw with more context
    if (error.message.includes('Git extension not found')) {
      throw error;
    } else if (error.message.includes('ENOENT')) {
      throw new Error('Git repository path not found. Please check your workspace folder.');
    } else {
      throw new Error(`Failed to access Git repository: ${error.message}`);
    }
  }
}

/**
 * Generates a commit message based on the changes staged in the repository.
 *
 * @param {any} arg - The input argument containing the root URI of the repository.
 * @returns {Promise<void>} - A promise that resolves when the commit message has been generated and set in the SCM input box.
 */
export async function generateCommitMsg(arg) {
  return ProgressHandler.withProgress('', async (progress, token) => {
    try {
      throwIfCancelled(token);
      const configManager = ConfigurationManager.getInstance();
      const repo = await getRepo(arg);
      throwIfCancelled(token);

      const resolvedProvider = await checkAndPromptForConfiguration(configManager);
      throwIfCancelled(token);
      if (!resolvedProvider) {
        return;
      }
      const aiProvider: ProviderName = resolvedProvider;
      const normalizedProvider = normalizeProvider(aiProvider);
      const keyManager = KeyManager.getInstance();
      const modelRegistry = ModelRegistry.getInstance();
      const reasoningMode = configManager.getConfig<ReasoningMode>(ConfigKeys.REASONING_MODE, 'balanced');
      const includeRecentCommitsContext = configManager.getConfig<boolean>(ConfigKeys.ENABLE_RECENT_COMMITS_CONTEXT, true);

      progress.report({ message: 'Gathering Git changes...' });
      const { diff, source: diffSource } = await getChanges(repo);
      throwIfCancelled(token);

      const scmInputBox = repo.inputBox;
      if (!scmInputBox) {
        throw new Error('Unable to find the SCM input box');
      }

      // Gather Context
      const additionalContext = scmInputBox.value.trim();
      const branchName = await getBranchName(repo);
      const recentCommits = includeRecentCommitsContext ? await getRecentCommits(repo) : '';
      throwIfCancelled(token);

      progress.report({
        message: additionalContext
          ? `Analyzing ${diffSource} changes with additional context...`
          : `Analyzing ${diffSource} changes...`
      });

      const messages = await generateCommitMessageChatCompletionPrompt(
        diff,
        additionalContext,
        branchName,
        recentCommits
      );
      throwIfCancelled(token);

      progress.report({
        message: additionalContext
          ? `Generating commit message from ${diffSource} changes with additional context...`
          : `Generating commit message from ${diffSource} changes...`
      });
      try {
        let commitMessage: string | undefined;
        const abortController = createAbortControllerFromToken(token);
        const abortSignal = abortController.signal;
        const requestOptions = { signal: abortSignal };
        throwIfCancelled(token);

        if (normalizedProvider === 'gemini' || normalizedProvider === 'google') {
          const geminiApiKey = configManager.getConfig<string>(ConfigKeys.GEMINI_API_KEY);
          if (!geminiApiKey) {
            throw new Error('Gemini API Key not configured');
          }
          commitMessage = await GeminiAPI(messages, requestOptions);
        } else if (normalizedProvider === 'poe') {
          const poeApiKey = configManager.getConfig<string>(ConfigKeys.POE_API_KEY);
          if (!poeApiKey) {
            throw new Error('Poe API Key not configured');
          }
          commitMessage = await PoeChatAPI(messages as ChatCompletionMessageParam[], requestOptions);
        } else if (normalizedProvider === 'anthropic') {
          const anthropicKey = await keyManager.getKey('anthropic');
          if (!anthropicKey) {
            throw new Error('Anthropic API Key not configured');
          }
          commitMessage = await AnthropicAPI(messages as ChatCompletionMessageParam[], {
            signal: abortSignal,
            apiKey: anthropicKey,
            reasoningMode
          });
        } else {
          const resolvedApiKey = await keyManager.getKey(normalizedProvider);
          if (!resolvedApiKey) {
            throw new Error(`API key for '${normalizedProvider}' is not configured`);
          }
          const providerMetadata = modelRegistry.getProviderMetadata(normalizedProvider);
          let baseURL = providerMetadata?.apiBaseUrl ?? configManager.getConfig<string>(ConfigKeys.OPENAI_BASE_URL);
          commitMessage = await OpenAICompatibleAPI(messages as ChatCompletionMessageParam[], {
            ...requestOptions,
            apiKey: resolvedApiKey,
            baseURL,
            reasoningMode
          });
        }


        if (commitMessage) {
          // Strip markdown code fences if the model wrapped the message in them
          scmInputBox.value = commitMessage.replace(/^```[^\n]*\n?([\s\S]*?)```\s*$/s, '$1').trim();
        } else {
          throw new Error('Failed to generate commit message');
        }
      } catch (err) {
        if (err instanceof vscode.CancellationError || token.isCancellationRequested) {
          throw new vscode.CancellationError();
        }
        // The OpenAI SDK throws APIUserAbortError for its own aborts;
        // raw fetch / DOM produce DOMException('Aborted', 'AbortError').
        if (
          err?.name === 'AbortError' ||
          err?.code === 'ABORT_ERR' ||
          err?.name === 'APIUserAbortError'
        ) {
          throw new vscode.CancellationError();
        }
        // Log the full error for debugging
        console.error('AI Commit Error Details:', {
          error: err,
          stack: err?.stack,
          response: err?.response,
          status: err?.response?.status,
          statusText: err?.response?.statusText,
          message: err?.message,
          aiProvider
        });

        let errorMessage = 'An unexpected error occurred';

        if (normalizedProvider === 'openai' && err.response?.status) {
          switch (err.response.status) {
            case 401:
              errorMessage = 'Invalid OpenAI API key or unauthorized access';
              break;
            case 429:
              errorMessage = 'Rate limit exceeded. Please try again later';
              break;
            case 500:
              errorMessage = 'OpenAI server error. Please try again later';
              break;
            case 503:
              errorMessage = 'OpenAI service is temporarily unavailable';
              break;
            default:
              errorMessage = `OpenAI API error (${err.response.status}): ${err.response.statusText || err.message}`;
          }
        } else if (normalizedProvider === 'gemini' || normalizedProvider === 'google') {
          errorMessage = `Gemini API error: ${err.message}`;
        } else if (normalizedProvider === 'poe') {
          errorMessage = `Poe API error: ${err.message}`;
        } else if (normalizedProvider === 'anthropic') {
          errorMessage = `Anthropic API error: ${err.message}`;
        } else if (err.message) {
          errorMessage = `${normalizedProvider.toUpperCase()} API error: ${err.message}`;
        }

        throw new Error(errorMessage);
      }
    } catch (error) {
      throw error;
    }
  });
}
