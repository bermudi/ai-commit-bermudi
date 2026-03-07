import { ConfigKeys, ConfigurationManager } from './config';

import fs from 'node:fs/promises';
import path from 'node:path';

// Runtime loader for canonical Markdown prompts
const PROMPT_DIR = path.resolve(__dirname, '..', 'prompt');
let cachedWithGitmoji: string | undefined;
let cachedWithoutGitmoji: string | undefined;

const loadMarkdownPrompt = async (useGitmoji: boolean): Promise<string> => {
  const fileName = useGitmoji ? 'with_gitmoji.md' : 'without_gitmoji.md';
  const filePath = path.resolve(PROMPT_DIR, fileName);

  try {
    if (useGitmoji) {
      if (!cachedWithGitmoji) {
        cachedWithGitmoji = await fs.readFile(filePath, 'utf-8');
      }
      return cachedWithGitmoji;
    }

    if (!cachedWithoutGitmoji) {
      cachedWithoutGitmoji = await fs.readFile(filePath, 'utf-8');
    }
    return cachedWithoutGitmoji;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load canonical prompt file ${filePath}: ${message}`);
  }
};

const composePromptFromMarkdown = (
  language: string,
  markdown: string
): string => {
  const standardHeader = `Your role is to respond with a "Conventional Commit v2.0.0" in ${language} to the diffs you receive.
No comment, no explanations, no questions, nothing. Only the commit message. \n\n`;

  return `${standardHeader}${markdown}`;
};

/**
 * Retrieves the main commit prompt.
 *
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of prompts.
 */
export const getMainCommitPrompt = async () => {
  const configManager = ConfigurationManager.getInstance();
  const language = configManager.getConfig<string>(ConfigKeys.AI_COMMIT_LANGUAGE);
  const useGitmoji = configManager.getConfig<boolean>(ConfigKeys.USE_GITMOJI, true);
  const rawCustomPrompt = configManager.getConfig<string>(ConfigKeys.SYSTEM_PROMPT);
  const rawAppendPrompt = configManager.getConfig<string>(ConfigKeys.SYSTEM_APPEND);

  const customPrompt =
    rawCustomPrompt && rawCustomPrompt.trim().length > 0 ? rawCustomPrompt : undefined;
  const appendPrompt =
    rawAppendPrompt && rawAppendPrompt.trim().length > 0 ? rawAppendPrompt : undefined;

  if (customPrompt) {
    // If there's a custom prompt, use it and append any additional text if provided
    const content = appendPrompt ? `${customPrompt}\n\n${appendPrompt}` : customPrompt;
    return [{ role: 'system', content }];
  }

  // Load the standard markdown prompt
  const md = await loadMarkdownPrompt(useGitmoji);
  const basePrompt = composePromptFromMarkdown(language, md);

  // Append any additional text if provided
  const content = appendPrompt ? `${basePrompt}\n\n${appendPrompt}` : basePrompt;
  return [{ role: 'system', content }];
};
