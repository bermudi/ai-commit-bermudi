import * as vscode from 'vscode';
import { CONFIG_NAMESPACE, ConfigKeys, ConfigurationManager } from './config';

export const providers = {
  openai: ConfigKeys.OPENAI_API_KEY,
  gemini: ConfigKeys.GEMINI_API_KEY,
  poe: ConfigKeys.POE_API_KEY
} as const;

export type ProviderName = keyof typeof providers;

const hasValidKey = (value?: string | null): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const normalizeProvider = (provider: string | undefined): ProviderName => {
  const candidate = provider?.toLowerCase() as ProviderName | undefined;
  if (candidate && candidate in providers) {
    return candidate;
  }
  return 'openai';
};

const getProviderKeys = (configManager: ConfigurationManager): Record<ProviderName, string | undefined> => {
  const providerEntries = Object.entries(providers) as [ProviderName, ConfigKeys][];

  return providerEntries.reduce(
    (acc, [provider, key]) => {
      acc[provider] = configManager.getConfig<string>(key);
      return acc;
    },
    {} as Record<ProviderName, string | undefined>
  );
};

/**
 * Ensures that the configured AI provider has a valid key and prompts the user when it does not.
 * Returns the provider that can be used, or undefined when the user chooses to configure settings first.
 */
export async function checkAndPromptForConfiguration(
  configManager: ConfigurationManager
): Promise<ProviderName | undefined> {
  const providerKeys = getProviderKeys(configManager);
  const currentProviderSetting = configManager.getConfig<string>(ConfigKeys.AI_PROVIDER) ?? 'openai';
  const currentProvider = normalizeProvider(currentProviderSetting);

  if (hasValidKey(providerKeys[currentProvider])) {
    return currentProvider;
  }

  const providerEntries = Object.entries(providers) as [ProviderName, ConfigKeys][];
  const validProviderEntry = providerEntries.find(
    ([provider]) => provider !== currentProvider && hasValidKey(providerKeys[provider])
  );

  if (!validProviderEntry) {
    const configureSelection = await vscode.window.showWarningMessage(
      'You need to set up an API key for at least one provider (OpenAI, Gemini, or Poe) to use AI Commit.',
      'Configure'
    );

    if (configureSelection === 'Configure') {
      await vscode.commands.executeCommand('workbench.action.openSettings', CONFIG_NAMESPACE);
    }

    return undefined;
  }

  const [validProvider] = validProviderEntry;
  const selection = await vscode.window.showInformationMessage(
    `AI Commit is configured for '${currentProviderSetting}' but no key is set. Found a valid key for '${validProvider}'. Switch to '${validProvider}'?`,
    'Yes',
    'Configure'
  );

  if (selection === 'Yes') {
    await vscode.workspace
      .getConfiguration(CONFIG_NAMESPACE)
      .update(ConfigKeys.AI_PROVIDER, validProvider, vscode.ConfigurationTarget.Global);
    return validProvider;
  }

  if (selection === 'Configure') {
    await vscode.commands.executeCommand('workbench.action.openSettings', CONFIG_NAMESPACE);
  }

  return undefined;
}
