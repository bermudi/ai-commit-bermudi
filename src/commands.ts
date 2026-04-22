import * as vscode from 'vscode';
import { inspect } from 'util';
import { generateCommitMsg } from './generate-commit-msg';
import { CONFIG_NAMESPACE, ConfigKeys, ConfigurationManager } from './config';
import { ModelRegistry } from './model-registry';
import { BUILTIN_PROVIDER_IDS } from './provider-config';
import { KeyManager } from './secret-storage';

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

    // Select AI Provider
    this.registerCommand('ai-commit-bermudi.selectProvider', async () => {
      const configManager = ConfigurationManager.getInstance();
      const modelRegistry = ModelRegistry.getInstance();
      const registryProviders = modelRegistry.getProviders();
      const providerSet = new Set<string>([...BUILTIN_PROVIDER_IDS, ...registryProviders]);

      if (providerSet.size === 0) {
        vscode.window.showWarningMessage('No providers available. Try refreshing the model registry.');
        return;
      }

      const providerItems: vscode.QuickPickItem[] = Array.from(providerSet)
        .sort()
        .map((provider) => ({
          label: provider,
          description: BUILTIN_PROVIDER_IDS.includes(provider)
            ? 'Built-in provider'
            : 'Discovered via models.dev'
        }));

      const currentProvider = configManager.getConfig<string>(ConfigKeys.AI_PROVIDER, 'openai');
      const selection = await vscode.window.showQuickPick(providerItems, {
        placeHolder: 'Select the AI provider to use'
      });

      if (selection?.label) {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        await config.update(ConfigKeys.AI_PROVIDER, selection.label, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`AI Commit provider set to '${selection.label}'.`);
      }
    });

    // Show available Anthropic models
    this.registerCommand('ai-commit-bermudi.showAvailableAnthropicModels', async () => {
      const configManager = ConfigurationManager.getInstance();
      const models = await configManager.getAvailableAnthropicModels();

      if (!models.length) {
        vscode.window.showInformationMessage(
          'No Anthropic models available. Try running "AI Commit: Refresh Model Registry" first.'
        );
        return;
      }

      const selected = await vscode.window.showQuickPick(models, {
        placeHolder: 'Please select an Anthropic model'
      });

      if (selected) {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        await config.update(ConfigKeys.ANTHROPIC_MODEL, selected, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Anthropic model set to '${selected}'.`);
      }
    });

    // Set API key command
    this.registerCommand('ai-commit-bermudi.setApiKey', async () => {
      const modelRegistry = ModelRegistry.getInstance();
      const registryProviders = modelRegistry.getProviders();
      const providerSet = new Set<string>([...BUILTIN_PROVIDER_IDS, ...registryProviders]);

      if (providerSet.size === 0) {
        vscode.window.showWarningMessage('No providers available. Try refreshing the model registry.');
        return;
      }

      const providerItems: vscode.QuickPickItem[] = Array.from(providerSet)
        .sort()
        .map((provider) => ({
          label: provider,
          description: BUILTIN_PROVIDER_IDS.includes(provider)
            ? 'Built-in provider'
            : 'Discovered via models.dev'
        }));

      const providerSelection = await vscode.window.showQuickPick(providerItems, {
        placeHolder: 'Select the provider to set an API key for'
      });

      if (!providerSelection?.label) {
        return;
      }

      const key = await vscode.window.showInputBox({
        prompt: `Enter API key for ${providerSelection.label}`,
        placeHolder: 'API Key',
        password: true,
        ignoreFocusOut: true
      });

      if (!key || !key.trim()) {
        vscode.window.showWarningMessage('API key entry cancelled or empty.');
        return;
      }

      try {
        const keyManager = KeyManager.getInstance();
        await keyManager.storeKey(providerSelection.label, key.trim());
        vscode.window.showInformationMessage(`API Key for ${providerSelection.label} saved securely.`);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to save API key: ${error?.message ?? 'Unknown error'}`);
      }
    });
  }

  private registerCommand(command: string, handler: (...args: any[]) => any) {
    const disposable = vscode.commands.registerCommand(command, async (...args) => {
      try {
        await handler(...args);
      } catch (error) {
        const formattedArgs = formatArgsForLogging(args);
        // Log detailed error information for debugging
        console.error(`Command ${command} failed:`, {
          error,
          stack: error?.stack,
          message: error?.message,
          args: formattedArgs
        });

        const result = await vscode.window.showErrorMessage(
          `AI Commit failed: ${error.message}`,
          'Retry',
          'Configure',
          'Show Details'
        );

        if (result === 'Retry') {
          // Re-dispatch through the command system so it gets a fresh progress notification
          // and full error handling (including further retries)
          vscode.commands.executeCommand(command, ...args);
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
Arguments: ${formattedArgs}
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

function formatArgsForLogging(args: unknown[]): string {
  try {
    return inspect(args, {
      depth: 2,
      maxArrayLength: 20,
      maxStringLength: 200
    });
  } catch (error) {
    console.warn('Failed to format command arguments for logging:', error);
    return '[Unable to format arguments due to circular references]';
  }
}
