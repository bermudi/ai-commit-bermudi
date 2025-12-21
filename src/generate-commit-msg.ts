import * as fs from 'fs-extra';
import * as path from 'path'; // Added path import
import { ChatCompletionMessageParam } from 'openai/resources';
import * as vscode from 'vscode';
import { ConfigKeys, ConfigurationManager } from './config';
import { getBranchName, getChanges, getRecentCommits } from './git-utils'; // Added getBranchName
import { ChatGPTAPI } from './openai-utils';
import { getMainCommitPrompt } from './prompts';
import { ProgressHandler } from './utils';
import { GeminiAPI } from './gemini-utils';

/**
 * Scans the openspec directory to provide context about active specs.
 */
async function getOpenSpecContext(repoPath: string): Promise<string> {
  try {
    const changesPath = path.join(repoPath, 'openspec', 'changes');
    if (!await fs.pathExists(changesPath)) {
      return '';
    }

    const entries = await fs.readdir(changesPath, { withFileTypes: true });
    // Filter for directories that are not 'archive'
    const activeSpecs = entries
      .filter(dirent => dirent.isDirectory() && dirent.name !== 'archive')
      .map(dirent => `openspec/changes/${dirent.name}`);

    if (activeSpecs.length === 0) return '';

    return `\nActive OpenSpec Proposals (Use these paths for Spec-Ref footers if relevant):\n- ${activeSpecs.join('\n- ')}`;
  } catch (error) {
    console.warn('Failed to scan openspec context:', error);
    return '';
  }
}

/**
 * Generates a chat completion prompt for the commit message based on the provided diff.
 *
 * @param {string} diff - The diff string representing changes to be committed.
 * @param {string} additionalContext - Additional context for the changes.
 * @param {string} branchName - The current git branch name.
 * @param {string} openSpecContext - List of active specs.
 * @returns {Promise<Array<{ role: string, content: string }>>} - A promise that resolves to an array of messages for the chat completion.
 */
const generateCommitMessageChatCompletionPrompt = async (
  diff: string,
  additionalContext: string | undefined,
  branchName: string | undefined,
  openSpecContext: string,
  recentCommits: string
) => {
  const INIT_MESSAGES_PROMPT = await getMainCommitPrompt();
  const chatContextAsCompletionRequest = [...INIT_MESSAGES_PROMPT];

  let contextMsg = `Input Data:\n`;
  if (branchName) contextMsg += `Git Branch: ${branchName}\n`;
  if (openSpecContext) contextMsg += `${openSpecContext}\n`;
  if (recentCommits) contextMsg += `Recent Commits:\n${recentCommits}\n`;
  if (additionalContext) contextMsg += `User Notes: ${additionalContext}\n`;

  if (branchName || openSpecContext || additionalContext) {
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
  return ProgressHandler.withProgress('', async (progress) => {
    try {
      const configManager = ConfigurationManager.getInstance();
      const repo = await getRepo(arg);

      const aiProvider = configManager.getConfig<string>(ConfigKeys.AI_PROVIDER, 'openai');

      progress.report({ message: 'Gathering Git changes...' });
      const { diff, source: diffSource } = await getChanges(repo);

      const scmInputBox = repo.inputBox;
      if (!scmInputBox) {
        throw new Error('Unable to find the SCM input box');
      }

      // Gather Context
      const additionalContext = scmInputBox.value.trim();
      const branchName = await getBranchName(repo);
      const repoRoot = repo.rootUri.fsPath;
      const openSpecContext = await getOpenSpecContext(repoRoot);
      const recentCommits = await getRecentCommits(repo);

      progress.report({
        message: additionalContext
          ? `Analyzing ${diffSource} changes with additional context...`
          : `Analyzing ${diffSource} changes...`
      });

      const messages = await generateCommitMessageChatCompletionPrompt(
        diff,
        additionalContext,
        branchName,
        openSpecContext,
        recentCommits
      );

      progress.report({
        message: additionalContext
          ? `Generating commit message from ${diffSource} changes with additional context...`
          : `Generating commit message from ${diffSource} changes...`
      });
      try {
        let commitMessage: string | undefined;

        if (aiProvider === 'gemini') {
          const geminiApiKey = configManager.getConfig<string>(ConfigKeys.GEMINI_API_KEY);
          if (!geminiApiKey) {
            throw new Error('Gemini API Key not configured');
          }
          commitMessage = await GeminiAPI(messages);
        } else {
          const openaiApiKey = configManager.getConfig<string>(ConfigKeys.OPENAI_API_KEY);
          if (!openaiApiKey) {
            throw new Error('OpenAI API Key not configured');
          }
          commitMessage = await ChatGPTAPI(messages as ChatCompletionMessageParam[]);
        }


        if (commitMessage) {
          scmInputBox.value = commitMessage;
        } else {
          throw new Error('Failed to generate commit message');
        }
      } catch (err) {
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

        if (aiProvider === 'openai' && err.response?.status) {
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
        } else if (aiProvider === 'gemini') {
          errorMessage = `Gemini API error: ${err.message}`;
        } else if (err.message) {
          // If we have a specific error message, use it
          errorMessage = err.message;
        }

        throw new Error(errorMessage);
      }
    } catch (error) {
      throw error;
    }
  });
}
