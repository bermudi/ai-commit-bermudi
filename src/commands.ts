import * as vscode from 'vscode';
import { generateCommitMsg } from './generate-commit-msg';
import { CONFIG_NAMESPACE, ConfigurationManager } from './config';

/**
 * Manages the registration and disposal of commands.
 */
export class CommandManager {
  private disposables: vscode.Disposable[] = [];

  constructor(private context: vscode.ExtensionContext) { }

  registerCommands() {
    this.registerCommand('extension.ai-commit-bermudi', generateCommitMsg);
    this.registerCommand('extension.configure-ai-commit-bermudi', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', CONFIG_NAMESPACE)
    );

    // Show available OpenAI models
    this.registerCommand('ai-commit-bermudi.showAvailableOpenAIModels', async () => {
      const configManager = ConfigurationManager.getInstance();
      const models = await configManager.getAvailableOpenAIModels();
      const selected = await vscode.window.showQuickPick(models, {
        placeHolder: 'Please select a model'
      });

      if (selected) {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        await config.update('OPENAI_MODEL', selected, vscode.ConfigurationTarget.Global);
      }
    });

    // Show available Gemini models
    this.registerCommand('ai-commit-bermudi.showAvailableGeminiModels', async () => {
      const configManager = ConfigurationManager.getInstance();
      const models = await configManager.getAvailableGeminiModels();
      const selected = await vscode.window.showQuickPick(models, {
        placeHolder: 'Please select a Gemini model'
      });

      if (selected) {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        await config.update('GEMINI_MODEL', selected, vscode.ConfigurationTarget.Global);
      }
    });

    // Show available Poe models
    this.registerCommand('ai-commit-bermudi.showAvailablePoeModels', async () => {
      const configManager = ConfigurationManager.getInstance();
      const models = await configManager.getAvailablePoeModels();

      if (!models.length) {
        vscode.window.showInformationMessage('No Poe models available. Please verify your Poe API key.');
        return;
      }

      const selected = await vscode.window.showQuickPick(models, {
        placeHolder: 'Please select a Poe model'
      });

      if (selected) {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        await config.update('POE_MODEL', selected, vscode.ConfigurationTarget.Global);
      }
    });
  }

  private registerCommand(command: string, handler: (...args: any[]) => any) {
    const disposable = vscode.commands.registerCommand(command, async (...args) => {
      try {
        await handler(...args);
      } catch (error) {
        // Log detailed error information for debugging
        console.error(`Command ${command} failed:`, {
          error,
          stack: error?.stack,
          message: error?.message,
          args
        });

        const result = await vscode.window.showErrorMessage(
          `AI Commit failed: ${error.message}`,
          'Retry',
          'Configure',
          'Show Details'
        );

        if (result === 'Retry') {
          await handler(...args);
        } else if (result === 'Configure') {
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            CONFIG_NAMESPACE
          );
        } else if (result === 'Show Details') {
          // Show detailed error information in a new document
          const errorDetails = `
Command: ${command}
Error: ${error.message}
Stack: ${error?.stack || 'No stack trace available'}
Arguments: ${JSON.stringify(args, null, 2)}
Timestamp: ${new Date().toISOString()}
          `.trim();

          const doc = await vscode.workspace.openTextDocument({
            content: errorDetails,
            language: 'plaintext'
          });
          await vscode.window.showTextDocument(doc);
        }
      }
    });

    this.disposables.push(disposable);
    this.context.subscriptions.push(disposable);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
