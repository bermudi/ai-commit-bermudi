import * as vscode from 'vscode';
import { CONFIG_NAMESPACE, ConfigKeys, ConfigurationManager } from './config';

export const STATIC_PROVIDER_KEY_MAP: Record<string, ConfigKeys> = {
  openai: ConfigKeys.OPENAI_API_KEY,
  google: ConfigKeys.GEMINI_API_KEY,
  gemini: ConfigKeys.GEMINI_API_KEY,
  poe: ConfigKeys.POE_API_KEY
};

export const BUILTIN_PROVIDER_IDS = Object.freeze(Object.keys(STATIC_PROVIDER_KEY_MAP));

export const isStaticProvider = (provider?: string) =>
  provider ? Object.prototype.hasOwnProperty.call(STATIC_PROVIDER_KEY_MAP, provider) : false;

export type ProviderName = string;

const hasValidKey = (value?: string | null): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const normalizeProvider = (provider: string | undefined): ProviderName => {
  const normalized = provider?.trim().toLowerCase();
  if (normalized) {
    return normalized;
  }
  return 'openai';
};

const getStaticProviderKeys = (configManager: ConfigurationManager): Record<string, string | undefined> => {
  return Object.entries(STATIC_PROVIDER_KEY_MAP).reduce(
    (acc, [provider, key]) => {
      acc[provider] = configManager.getConfig<string>(key);
      return acc;
    },
    {} as Record<string, string | undefined>
  );
};

/**
 * Ensures that the configured AI provider has a valid key and prompts the user when it does not.
 * Returns the provider that can be used, or undefined when the user chooses to configure settings first.
 */
export async function checkAndPromptForConfiguration(
  configManager: ConfigurationManager
): Promise<ProviderName | undefined> {
  const providerKeys = getStaticProviderKeys(configManager);
  const currentProviderSetting = configManager.getConfig<string>(ConfigKeys.AI_PROVIDER) ?? 'openai';
  const currentProvider = normalizeProvider(currentProviderSetting);

  if (!isStaticProvider(currentProvider)) {
    return currentProvider;
  }

  if (hasValidKey(providerKeys[currentProvider])) {
    return currentProvider;
  }

  const validProviderEntry = Object.keys(STATIC_PROVIDER_KEY_MAP).find(
    (provider) => provider !== currentProvider && hasValidKey(providerKeys[provider])
  );

  if (!validProviderEntry) {
    const configureSelection = await vscode.window.showWarningMessage(
      'Your selected AI provider is missing an API key. Configure OpenAI, Gemini, Poe, or switch to another provider first.',
      'Configure'
    );

    if (configureSelection === 'Configure') {
      await vscode.commands.executeCommand('workbench.action.openSettings', CONFIG_NAMESPACE);
    }

    return undefined;
  }

  const selection = await vscode.window.showInformationMessage(
    `AI Commit is configured for '${currentProviderSetting}' but no key is set. Found a valid key for '${validProviderEntry}'. Switch to '${validProviderEntry}'?`,
    'Yes',
    'Configure'
  );

  if (selection === 'Yes') {
    await vscode.workspace
      .getConfiguration(CONFIG_NAMESPACE)
      .update(ConfigKeys.AI_PROVIDER, validProviderEntry, vscode.ConfigurationTarget.Global);
    return validProviderEntry;
  }

  if (selection === 'Configure') {
    await vscode.commands.executeCommand('workbench.action.openSettings', CONFIG_NAMESPACE);
  }

  return undefined;
}
