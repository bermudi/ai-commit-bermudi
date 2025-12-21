import simpleGit from 'simple-git';
import * as vscode from 'vscode';

/**
 * Retrieves the current branch name.
 */
export async function getBranchName(repo: any): Promise<string | undefined> {
  try {
    const rootPath = repo?.rootUri?.fsPath || vscode.workspace.workspaceFolders?.[0].uri.fsPath;
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
 * Retrieves the staged changes from the Git repository.
 */
export async function getDiffStaged(
  repo: any
): Promise<{ diff: string; error?: string }> {
  try {
    const rootPath =
      repo?.rootUri?.fsPath || vscode.workspace.workspaceFolders?.[0].uri.fsPath;

    if (!rootPath) {
      throw new Error('No workspace folder found');
    }

    console.log(`Getting staged diff for path: ${rootPath}`);
    const git = simpleGit(rootPath);

    // Check if this is a valid git repository
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      throw new Error('Not a Git repository');
    }

    const diff = await git.diff(['--staged']);

    return {
      diff: diff || 'No changes staged.',
      error: null
    };
  } catch (error) {
    console.error('Error reading Git staged diff:', {
      error,
      message: error.message,
      stack: error.stack,
      repo: repo?.rootUri?.fsPath,
      workspaceFolders: vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath)
    });

    // Provide more specific error messages
    let errorMessage = error.message;
    if (error.message.includes('not a git repository')) {
      errorMessage = 'This folder is not a Git repository. Please initialize Git first.';
    } else if (error.message.includes('permission denied')) {
      errorMessage = 'Permission denied accessing Git repository. Check file permissions.';
    } else if (error.message.includes('ENOTFOUND') || error.message.includes('network')) {
      errorMessage = 'Network error accessing Git repository.';
    }

    return { diff: '', error: errorMessage };
  }
}

/**
 * Retrieves the unstaged (working tree) changes from the Git repository.
 */
export async function getDiffWorkingTree(
  repo: any
): Promise<{ diff: string; error?: string }> {
  try {
    const rootPath =
      repo?.rootUri?.fsPath || vscode.workspace.workspaceFolders?.[0].uri.fsPath;

    if (!rootPath) {
      throw new Error('No workspace folder found');
    }

    console.log(`Getting working tree diff for path: ${rootPath}`);
    const git = simpleGit(rootPath);

    // Check if this is a valid git repository
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      throw new Error('Not a Git repository');
    }

    const diff = await git.diff();

    return {
      diff: diff || 'No unstaged changes.',
      error: null
    };
  } catch (error) {
    console.error('Error reading Git working tree diff:', {
      error,
      message: error.message,
      stack: error.stack,
      repo: repo?.rootUri?.fsPath,
      workspaceFolders: vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath)
    });

    // Provide more specific error messages
    let errorMessage = error.message;
    if (error.message.includes('not a git repository')) {
      errorMessage = 'This folder is not a Git repository. Please initialize Git first.';
    } else if (error.message.includes('permission denied')) {
      errorMessage = 'Permission denied accessing Git repository. Check file permissions.';
    } else if (error.message.includes('ENOTFOUND') || error.message.includes('network')) {
      errorMessage = 'Network error accessing Git repository.';
    }

    return { diff: '', error: errorMessage };
  }
}
