import * as fs from 'fs-extra';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import * as vscode from 'vscode';
import { ConfigKeys, ConfigurationManager } from './config';

type DiffSource = 'staged' | 'unstaged';

export interface ChangesResult {
  diff: string;
  source: DiffSource;
}

const DEFAULT_IGNORED_PATTERNS = [
  '*-lock.json',
  '*.lock',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.svg',
  '*.json'
];

/**
 * Retrieves the current branch name.
 */
export async function getBranchName(repo: any): Promise<string | undefined> {
  try {
    const rootPath = resolveRootPath(repo);
    if (!rootPath) return undefined;

    const git = simpleGit(rootPath);
    const branchSummary = await git.branch();
    return branchSummary.current;
  } catch (error) {
    console.warn('Failed to get branch name:', error);
    return undefined;
  }
}

/**
 * Retrieves the repository changes, including untracked files when unstaged changes are used.
 */
export async function getChanges(repo: any): Promise<ChangesResult> {
  try {
    const { git, rootPath } = await prepareGit(repo);
    const ignorePatterns = getIgnorePatterns();
    const stagedDiff = (await git.diff(buildDiffArgs(['--staged'], ignorePatterns)))?.trim() ?? '';

    if (stagedDiff) {
      return { diff: stagedDiff, source: 'staged' };
    }

    const workingDiff = (await git.diff(buildDiffArgs([], ignorePatterns)))?.trim() ?? '';
    const untrackedDiff = await collectUntrackedDiff(git, rootPath, ignorePatterns);
    const combinedDiff = [workingDiff, untrackedDiff].filter(Boolean).join('\n').trim();

    if (!combinedDiff) {
      const rawStagedDiff = (await git.diff(['--staged']))?.trim() ?? '';
      if (rawStagedDiff) {
        return { diff: rawStagedDiff, source: 'staged' };
      }

      const rawWorkingDiff = (await git.diff())?.trim() ?? '';
      const rawUntrackedDiff = await collectUntrackedDiff(git, rootPath);
      const rawCombinedDiff = [rawWorkingDiff, rawUntrackedDiff].filter(Boolean).join('\n').trim();

      if (!rawCombinedDiff) {
        throw new Error('No changes available to analyze');
      }

      return { diff: rawCombinedDiff, source: 'unstaged' };
    }

    return { diff: combinedDiff, source: 'unstaged' };
  } catch (error) {
    console.error('Error reading Git changes:', {
      error,
      message: error.message,
      stack: error.stack,
      repo: repo?.rootUri?.fsPath,
      workspaceFolders: vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath)
    });

    throw new Error(mapGitErrorMessage(error));
  }
}

/**
 * Returns a formatted snippet containing the most recent commits.
 */
export async function getRecentCommits(repo: any, limit = 5): Promise<string> {
  try {
    const { git } = await prepareGit(repo);
    const log = await git.log({ n: limit });

    if (!log?.all?.length) {
      return '';
    }

    return log.all
      .slice(0, limit)
      .map(entry => `- ${entry.hash.slice(0, 7)} ${entry.message}`)
      .join('\n');
  } catch (error) {
    console.warn('Failed to get recent commits:', error);
    return '';
  }
}

function resolveRootPath(repo: any): string {
  const rootPath =
    repo?.rootUri?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!rootPath) {
    throw new Error('No workspace folder found');
  }

  return rootPath;
}

async function prepareGit(repo: any): Promise<{ git: SimpleGit; rootPath: string }> {
  const rootPath = resolveRootPath(repo);
  console.log(`Preparing git client for path: ${rootPath}`);
  const git = simpleGit(rootPath);
  const isRepo = await git.checkIsRepo();

  if (!isRepo) {
    throw new Error('Not a Git repository');
  }

  return { git, rootPath };
}

async function collectUntrackedDiff(
  git: SimpleGit,
  rootPath: string,
  ignorePatterns: string[] = []
): Promise<string> {
  try {
    const rawList = await git.raw(['ls-files', '--others', '--exclude-standard']);
    const untrackedFiles = rawList
      .split('\n')
      .map(file => file.trim())
      .filter(Boolean);

    const filteredFiles = ignorePatterns.length
      ? untrackedFiles.filter(file => !matchesIgnoreList(file, ignorePatterns))
      : untrackedFiles;

    if (!filteredFiles.length) {
      return '';
    }

    const diffs: string[] = [];
    for (const relativePath of filteredFiles) {
      const absolutePath = path.join(rootPath, relativePath);
      let buffer: Buffer;

      try {
        buffer = await fs.readFile(absolutePath);
      } catch (error) {
        console.warn(`Failed to read untracked file ${relativePath}:`, error);
        diffs.push(
          [
            `diff --git a/${relativePath} b/${relativePath}`,
            '--- /dev/null',
            `+++ b/${relativePath}`,
            '@@',
            '+ [Unable to read file contents]'
          ].join('\n')
        );
        continue;
      }

      const isBinary = buffer.includes(0);
      const body = isBinary
        ? '+ [binary file content not shown]'
        : formatFileBody(buffer.toString('utf8'));

      diffs.push(
        [
          `diff --git a/${relativePath} b/${relativePath}`,
          'new file mode 100644',
          '--- /dev/null',
          `+++ b/${relativePath}`,
          '@@',
          body,
          ''
        ].join('\n')
      );
    }

    return diffs.join('\n').trim();
  } catch (error) {
    console.warn('Failed to list untracked files:', error);
    return '';
  }
}

function formatFileBody(contents: string): string {
  const normalized = contents.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (lines.length === 0) {
    return '+';
  }

  return lines.map(line => `+ ${line}`).join('\n');
}

function mapGitErrorMessage(error: any): string {
  const message = error?.message || 'Unknown Git error occurred';

  if (/not a git repository/i.test(message)) {
    return 'This folder is not a Git repository. Please initialize Git first.';
  }

  if (/permission denied/i.test(message)) {
    return 'Permission denied accessing Git repository. Check file permissions.';
  }

  if (message.includes('ENOTFOUND') || message.includes('network')) {
    return 'Network error accessing Git repository.';
  }

  return message;
}

function getIgnorePatterns(): string[] {
  try {
    const configManager = ConfigurationManager.getInstance();
    const configured = configManager.getConfig<string[]>(ConfigKeys.IGNORED_FILES, DEFAULT_IGNORED_PATTERNS);

    if (Array.isArray(configured) && configured.length > 0) {
      return configured;
    }
  } catch (error) {
    console.warn('Failed to read IGNORED_FILES configuration, using defaults.', error);
  }

  return DEFAULT_IGNORED_PATTERNS;
}

function buildDiffArgs(baseArgs: string[], ignorePatterns: string[]): string[] {
  if (!ignorePatterns.length) {
    return baseArgs;
  }

  const exclusionSpecs = ignorePatterns.map(pattern => `:(exclude)${pattern}`);
  return [...baseArgs, '--', '.', ...exclusionSpecs];
}

export function matchesIgnoreList(filename: string, patterns: string[]): boolean {
  if (!patterns?.length) {
    return false;
  }

  const normalized = filename.replace(/\\/g, '/');
  const basename = path.basename(normalized);

  return patterns.some(pattern => {
    const regex = globToRegex(pattern);
    return regex.test(normalized) || regex.test(basename);
  });
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexBody = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regexBody}$`);
}

