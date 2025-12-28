import * as vscode from 'vscode';
import { CommandManager } from './commands';
import { CONFIG_NAMESPACE, ConfigurationManager } from './config';
import { checkAndPromptForConfiguration } from './provider-config';
import { ModelRegistry } from './model-registry';
import { KeyManager } from './secret-storage';

/**
 * Activates the extension and registers commands.
 *
 * @param {vscode.ExtensionContext} context - The context for the extension.
 */
export async function activate(context: vscode.ExtensionContext) {
  try {
    const configManager = ConfigurationManager.getInstance(context);
    const modelRegistry = ModelRegistry.getInstance();
    modelRegistry.initialize(context);
    KeyManager.getInstance(context);
    void modelRegistry
      .refresh()
      .catch(error => console.warn('Initial models.dev refresh failed; using cached data if available.', error));

    const commandManager = new CommandManager(context);
    commandManager.registerCommands();

    const refreshDisposable = vscode.commands.registerCommand('ai-commit-bermudi.refreshModels', async () => {
      try {
        await modelRegistry.refresh({ force: true });
        vscode.window.showInformationMessage('models.dev registry refreshed.');
      } catch (error: any) {
        const message = error?.message ?? 'Unknown error refreshing model registry.';
        vscode.window.showErrorMessage(`Failed to refresh models.dev registry: ${message}`);
      }
    });

    context.subscriptions.push({
      dispose: () => {
        configManager.dispose();
        commandManager.dispose();
        refreshDisposable.dispose();
      }
    });

    await checkAndPromptForConfiguration(configManager);
  } catch (error) {
    console.error('Failed to activate extension:', error);
    throw error;
  }
}

/**
 * Deactivates the extension.
 * This function is called when the extension is deactivated.
 */
export function deactivate() {}
