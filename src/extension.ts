import * as vscode from 'vscode';
import { CommandManager } from './commands';
import { CONFIG_NAMESPACE, ConfigKeys, ConfigurationManager } from './config';

/**
 * Activates the extension and registers commands.
 *
 * @param {vscode.ExtensionContext} context - The context for the extension.
 */
export async function activate(context: vscode.ExtensionContext) {
  try {
    const configManager = ConfigurationManager.getInstance(context);

    const commandManager = new CommandManager(context);
    commandManager.registerCommands();

    context.subscriptions.push({
      dispose: () => {
        configManager.dispose();
        commandManager.dispose();
      }
    });

    const apiKeys = [
      configManager.getConfig<string>(ConfigKeys.OPENAI_API_KEY),
      configManager.getConfig<string>(ConfigKeys.GEMINI_API_KEY),
      configManager.getConfig<string>(ConfigKeys.POE_API_KEY)
    ];

    const hasAnyApiKey = apiKeys.some((key) => typeof key === 'string' && key.trim().length > 0);

    if (!hasAnyApiKey) {
      const result = await vscode.window.showWarningMessage(
        'No AI provider API key configured. Would you like to configure one now?',
        'Yes',
        'No'
      );

      if (result === 'Yes') {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          CONFIG_NAMESPACE
        );
      }
    }
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
