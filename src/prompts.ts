import { ConfigKeys, ConfigurationManager } from './config';

import fs from 'node:fs/promises';
import path from 'node:path';

// Runtime loader for the canonical Scoped Commits prompt
// Spec: https://scopedcommits.com/
const PROMPT_DIR = path.resolve(__dirname, '..', 'prompt');
const PROMPT_FILE = 'scoped-commits.md';
const PROMPT_PATH = path.resolve(PROMPT_DIR, PROMPT_FILE);
let cachedPrompt: string | undefined;

const loadPrompt = async (): Promise<string> => {
  if (cachedPrompt) {
    return cachedPrompt;
  }
  try {
    cachedPrompt = await fs.readFile(PROMPT_PATH, 'utf-8');
    return cachedPrompt;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load canonical prompt file ${PROMPT_PATH}: ${message}`);
  }
};

const composePrompt = (language: string, body: string): string => {
  const standardHeader = `Your role is to respond with a "Scoped Commit" in ${language} to the diffs you receive.
No comment, no explanations, no questions, nothing. Only the commit message. Do not wrap the commit message in code blocks or backticks. \n\n`;

  return `${standardHeader}${body}`;
};

/**
 * Retrieves the main commit prompt.
 *
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of prompts.
 */
export const getMainCommitPrompt = async () => {
  const configManager = ConfigurationManager.getInstance();
  const language = configManager.getConfig<string>(ConfigKeys.AI_COMMIT_LANGUAGE);
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

  // Load the standard Scoped Commits prompt
  const body = await loadPrompt();
  const basePrompt = composePrompt(language, body);

  // Append any additional text if provided
  const content = appendPrompt ? `${basePrompt}\n\n${appendPrompt}` : basePrompt;
  return [{ role: 'system', content }];
};
