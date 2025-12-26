import * as vscode from 'vscode';

/**
 * Adds progress handling functionality.
 */
export class ProgressHandler {
  static async withProgress<T>(
    title: string,
    task: (
      progress: vscode.Progress<{ message?: string; increment?: number }>,
      token: vscode.CancellationToken
    ) => Promise<T>
  ): Promise<T> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `[AI Commit] ${title}`,
        cancellable: true
      },
      (progress, token) => task(progress, token)
    );
  }
}

/**
 * Creates an AbortController that mirrors a VS Code CancellationToken.
 */
export function createAbortControllerFromToken(token: vscode.CancellationToken): AbortController {
  const controller = new AbortController();

  if (token.isCancellationRequested) {
    controller.abort();
  }

  token.onCancellationRequested(() => controller.abort());
  return controller;
}

/**
 * Throws a VS Code cancellation error when the provided token has been cancelled.
 */
export function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new vscode.CancellationError();
  }
}
