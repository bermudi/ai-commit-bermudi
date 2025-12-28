import * as vscode from 'vscode';
import { CONFIG_NAMESPACE, ConfigKeys } from './config';

const STATIC_PROVIDER_KEYS = new Set(['openai', 'google', 'gemini', 'poe']);

type ProviderKeySource = 'settings' | 'secretStorage';

type KeyLookupResult = {
  provider: string;
  key?: string;
  source: ProviderKeySource;
};

/**
 * KeyManager centralizes API key resolution across both legacy settings-driven providers
 * (OpenAI, Gemini, Poe) and the new dynamic providers that must leverage secret storage.
 */
export class KeyManager {
  private static instance: KeyManager;
  private context?: vscode.ExtensionContext;
  private caches: Map<string, KeyLookupResult> = new Map();

  private constructor() {}

  static getInstance(context?: vscode.ExtensionContext) {
    if (!this.instance) {
      this.instance = new KeyManager();
    }
    if (context) {
      this.instance.initialize(context);
    }
    return this.instance;
  }

  private initialize(context: vscode.ExtensionContext) {
    if (this.context === context) {
      return;
    }
    this.context = context;
  }

  private getSecretKeyPrefix(provider: string) {
    return `${CONFIG_NAMESPACE}.providerKey.${provider}`;
  }

  private ensureContext() {
    if (!this.context) {
      throw new Error('KeyManager requires initialization with the extension context');
    }
  }

  invalidate(provider?: string) {
    if (provider) {
      this.caches.delete(provider);
      return;
    }
    this.caches.clear();
  }

  private readLegacyKey(provider: string) {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    if (provider === 'openai') {
      return config.get<string>(ConfigKeys.OPENAI_API_KEY);
    }
    if (provider === 'google' || provider === 'gemini') {
      return config.get<string>(ConfigKeys.GEMINI_API_KEY);
    }
    if (provider === 'poe') {
      return config.get<string>(ConfigKeys.POE_API_KEY);
    }
    return undefined;
  }

  private async getSecret(provider: string) {
    this.ensureContext();
    const key = this.getSecretKeyPrefix(provider);
    return this.context!.secrets.get(key);
  }

  private async storeSecret(provider: string, value: string) {
    this.ensureContext();
    const key = this.getSecretKeyPrefix(provider);
    await this.context!.secrets.store(key, value);
  }

  private async promptForKey(provider: string): Promise<string | undefined> {
    const maskedProvider = provider.toUpperCase();
    const result = await vscode.window.showInputBox({
      prompt: `Enter API key for ${maskedProvider}`,
      placeHolder: `${maskedProvider} API key`,
      ignoreFocusOut: true,
      password: true
    });

    if (typeof result === 'string' && result.trim().length > 0) {
      await this.storeSecret(provider, result.trim());
      return result.trim();
    }
    return undefined;
  }

  async storeKey(provider: string, apiKey: string) {
    const normalizedProvider = provider.toLowerCase();
    await this.storeSecret(normalizedProvider, apiKey);
    this.invalidate(normalizedProvider);
  }

  async getKey(provider: string, options?: { promptIfMissing?: boolean }) {
    const normalizedProvider = provider.toLowerCase();
    const cached = this.caches.get(normalizedProvider);
    if (cached?.key) {
      return cached.key;
    }

    let resolvedKey = await this.getSecret(normalizedProvider);
    let source: ProviderKeySource = 'secretStorage';

    if (!resolvedKey) {
      resolvedKey = this.readLegacyKey(normalizedProvider);
      source = 'settings';
    }

    if (!resolvedKey && options?.promptIfMissing !== false) {
      resolvedKey = await this.promptForKey(normalizedProvider);
      source = 'secretStorage';
    }

    if (resolvedKey) {
      this.caches.set(normalizedProvider, {
        provider: normalizedProvider,
        key: resolvedKey,
        source
      });
    }
    return resolvedKey;
  }
}
