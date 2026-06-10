import * as vscode from 'vscode';
import { createOpenAIApi } from './openai-utils';
import { listAvailableGeminiModels } from './gemini-utils';
import { listAvailablePoeModels } from './poe-utils';
import { ModelRegistry } from './model-registry';

export const CONFIG_NAMESPACE = 'ai-commit-bermudi';
const GLOBAL_STATE_OPENAI_MODELS_KEY = `${CONFIG_NAMESPACE}.availableOpenAIModels`;
const GLOBAL_STATE_GEMINI_MODELS_KEY = `${CONFIG_NAMESPACE}.availableGeminiModels`;
const GLOBAL_STATE_POE_MODELS_KEY = `${CONFIG_NAMESPACE}.availablePoeModels`;
const GLOBAL_STATE_ANTHROPIC_MODELS_KEY = `${CONFIG_NAMESPACE}.availableAnthropicModels`;
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-20241022';

/**
 * Configuration keys used in the AI commit extension.
 * @constant {Object}
 * @property {string} OPENAI_API_KEY - The key for OpenAI API.
 * @property {string} OPENAI_BASE_URL - The base URL for OpenAI API.
 * @property {string} OPENAI_MODEL - The model used for OpenAI.
 * @property {string} AZURE_API_VERSION - The version of Azure API.
 * @property {string} AI_COMMIT_LANGUAGE - The language for AI commit messages.
 * @property {string} SYSTEM_PROMPT - The system prompt for generating commit messages.
 * @property {string} OPENAI_TEMPERATURE - The temperature setting for OpenAI API.
 */
export enum ConfigKeys {
  OPENAI_API_KEY = 'OPENAI_API_KEY',
  OPENAI_BASE_URL = 'OPENAI_BASE_URL',
  OPENAI_MODEL = 'OPENAI_MODEL',
  AZURE_API_VERSION = 'AZURE_API_VERSION',
  AI_COMMIT_LANGUAGE = 'AI_COMMIT_LANGUAGE',
  SYSTEM_PROMPT = 'AI_COMMIT_SYSTEM_PROMPT',
  SYSTEM_APPEND = 'AI_COMMIT_SYSTEM_APPEND',
  OPENAI_TEMPERATURE = 'OPENAI_TEMPERATURE',
  ENABLE_RECENT_COMMITS_CONTEXT = 'ENABLE_RECENT_COMMITS_CONTEXT',

  GEMINI_API_KEY = 'GEMINI_API_KEY',
  GEMINI_MODEL = 'GEMINI_MODEL',
  GEMINI_TEMPERATURE = 'GEMINI_TEMPERATURE',
  ANTHROPIC_MODEL = 'ANTHROPIC_MODEL',
  ANTHROPIC_TEMPERATURE = 'ANTHROPIC_TEMPERATURE',
  POE_API_KEY = 'POE_API_KEY',
  POE_MODEL = 'POE_MODEL',
  POE_TEMPERATURE = 'POE_TEMPERATURE',
  REASONING_MODE = 'REASONING_MODE',
  AI_PROVIDER = 'AI_PROVIDER',
  IGNORED_FILES = 'IGNORED_FILES',
}

/**
 * Manages the configuration for the AI commit extension.
 */
export class ConfigurationManager {
  private static instance: ConfigurationManager;
  private configCache: Map<string, any> = new Map();
  private disposable: vscode.Disposable;
  private context: vscode.ExtensionContext;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.disposable = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_NAMESPACE)) {
        this.configCache.clear();

        if (
          event.affectsConfiguration(`${CONFIG_NAMESPACE}.OPENAI_BASE_URL`) ||
          event.affectsConfiguration(`${CONFIG_NAMESPACE}.OPENAI_API_KEY`)
        ) {
          this.updateOpenAIModelList();
        }
        if (event.affectsConfiguration(`${CONFIG_NAMESPACE}.GEMINI_API_KEY`)) {
          this.updateGeminiModelList();
        }

        if (event.affectsConfiguration(`${CONFIG_NAMESPACE}.POE_API_KEY`)) {
          this.updatePoeModelList();
        }
      }
    });
  }

  static getInstance(context?: vscode.ExtensionContext): ConfigurationManager {
    if (!this.instance) {
      if (!context) {
        throw new Error('ConfigurationManager requires a context parameter for first initialization');
      }
      this.instance = new ConfigurationManager(context);
    }
    return this.instance;
  }

  /** Test-only: reset the singleton so each test starts from a clean slate. */
  static __resetForTests(): void {
    if (this.instance) {
      try {
        this.instance.disposable?.dispose();
      } catch {
        // ignore — disposed singletons in tests
      }
    }
    this.instance = undefined as unknown as ConfigurationManager;
  }

  getConfig<T>(key: string, defaultValue?: T): T {
    if (!this.configCache.has(key)) {
      try {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const value = config.get<T>(key, defaultValue);
        this.configCache.set(key, value);
      } catch (error) {
        console.error(`Error getting config for key ${key}:`, error);
        return defaultValue;
      }
    }
    return this.configCache.get(key);
  }

  dispose() {
    this.disposable.dispose();
  }

  /**
   * Updates the list of available OpenAI models.
   */
  private async updateOpenAIModelList() {
    try {
      const registryModels = await this.fetchRegistryModels('openai');
      if (registryModels.length) {
        await this.cacheOpenAIModels(registryModels);
        return;
      }

      const apiKey = this.getConfig<string>(ConfigKeys.OPENAI_API_KEY);
      if (!apiKey) {
        console.warn('OpenAI API key not configured and models.dev data unavailable; skipping model list update');
        return;
      }

      const openai = createOpenAIApi();
      const models = await openai.models.list();
      const availableModels = models.data.map(model => model.id);

      if (availableModels.length) {
        await this.cacheOpenAIModels(availableModels);
      }
    } catch (error) {
      console.error('Failed to fetch OpenAI models:', error);
      // Don't throw here, just log the error as this is not critical for basic functionality
    }
  }

  /**
   * Updates the list of available Poe models.
   */
  private async updatePoeModelList() {
    try {
      const apiKey = this.getConfig<string>(ConfigKeys.POE_API_KEY);
      if (!apiKey) {
        console.warn('Poe API key not configured, skipping model list update');
        return;
      }

      const models = await listAvailablePoeModels();

      await this.context.globalState.update(GLOBAL_STATE_POE_MODELS_KEY, models);

      const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
      const currentModel = config.get<string>('POE_MODEL');
      if (currentModel && !models.includes(currentModel)) {
        await config.update('POE_MODEL', 'Claude-Sonnet-4.5', vscode.ConfigurationTarget.Global);
      }
    } catch (error) {
      console.error('Failed to fetch Poe models:', error);
    }
  }

  /**
   * Updates the list of available Gemini models.
   */
  private async updateGeminiModelList() {
    try {
      const models = await listAvailableGeminiModels();

      if (!models.length) {
        console.warn('No Gemini models available from SDK or registry.');
        return;
      }

      // Save available models to extension state
      await this.context.globalState.update(GLOBAL_STATE_GEMINI_MODELS_KEY, models);

      // Get the current selected model
      const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
      const currentModel = config.get<string>('GEMINI_MODEL');

      // If the current selected model is not in the available list, set it to the default value
      if (currentModel && !models.includes(currentModel)) {
        await config.update('GEMINI_MODEL', 'gemini-2.0-flash-001', vscode.ConfigurationTarget.Global);
      }
    } catch (error) {
      console.error('Failed to fetch Gemini models:', error);
      // Don't throw here, just log the error as this is not critical for basic functionality
    }
  }

  /**
   * Retrieves the list of available OpenAI models.
   * @returns {Promise<string[]>} The list of available OpenAI models.
   */
  public async getAvailableOpenAIModels(): Promise<string[]> {
    const registryModels = await this.fetchRegistryModels('openai');
    if (registryModels.length) {
      await this.context.globalState.update(GLOBAL_STATE_OPENAI_MODELS_KEY, registryModels);
      return registryModels;
    }

    if (!this.context.globalState.get<string[]>(GLOBAL_STATE_OPENAI_MODELS_KEY)) {
      await this.updateOpenAIModelList();
    }
    return this.context.globalState.get<string[]>(GLOBAL_STATE_OPENAI_MODELS_KEY, []);
  }

  /**
   * Retrieves the list of available Gemini models.
   * @returns {Promise<string[]>} The list of available Gemini models.
   */
  public async getAvailableGeminiModels(): Promise<string[]> {
    if (!this.context.globalState.get<string[]>(GLOBAL_STATE_GEMINI_MODELS_KEY)) {
      await this.updateGeminiModelList();
    }
    return this.context.globalState.get<string[]>(GLOBAL_STATE_GEMINI_MODELS_KEY, []);
  }

  /**
   * Retrieves the list of available Poe models.
   * @returns {Promise<string[]>} The list of available Poe models.
   */
  public async getAvailablePoeModels(): Promise<string[]> {
    if (!this.context.globalState.get<string[]>(GLOBAL_STATE_POE_MODELS_KEY)) {
      await this.updatePoeModelList();
    }
    return this.context.globalState.get<string[]>(GLOBAL_STATE_POE_MODELS_KEY, []);
  }

  /**
   * Retrieves the list of available Anthropic models from the registry and caches them.
   */
  public async getAvailableAnthropicModels(): Promise<string[]> {
    const registryModels = await this.fetchRegistryModels('anthropic');
    if (registryModels.length) {
      await this.cacheAnthropicModels(registryModels);
      return registryModels;
    }

    return this.context.globalState.get<string[]>(
      GLOBAL_STATE_ANTHROPIC_MODELS_KEY,
      []
    );
  }

  private async fetchRegistryModels(providerId: string): Promise<string[]> {
    const registry = ModelRegistry.getInstance();
    let models = registry.getModels(providerId);
    if (models.length) {
      return models;
    }

    try {
      await registry.refresh();
      models = registry.getModels(providerId);
    } catch (error) {
      console.warn(`Failed to refresh models.dev registry for provider ${providerId}:`, error);
    }
    return models;
  }

  private async cacheOpenAIModels(models: string[]) {
    await this.context.globalState.update(GLOBAL_STATE_OPENAI_MODELS_KEY, models);

    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const currentModel = config.get<string>('OPENAI_MODEL');
    const fallbackModel = 'gpt-4o';

    if (!currentModel || !models.includes(currentModel)) {
      await config.update('OPENAI_MODEL', fallbackModel, vscode.ConfigurationTarget.Global);
    }
  }

  private async cacheAnthropicModels(models: string[]) {
    await this.context.globalState.update(GLOBAL_STATE_ANTHROPIC_MODELS_KEY, models);
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const currentModel = config.get<string>(ConfigKeys.ANTHROPIC_MODEL);

    if (!currentModel || !models.includes(currentModel)) {
      await config.update(
        ConfigKeys.ANTHROPIC_MODEL,
        DEFAULT_ANTHROPIC_MODEL,
        vscode.ConfigurationTarget.Global
      );
    }
  }
}
