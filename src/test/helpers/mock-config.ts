import { ConfigurationManager, ConfigKeys } from '../../config';
import { __resetGeminiForTests } from '../../gemini-utils';
import { __resetPoeForTests } from '../../poe-utils';
import { __resetOpenAIForTests } from '../../openai-utils';

/**
 * Test helper: install a fake config store and reset the singleton so each
 * test starts with a clean ConfigurationManager. Returns a `set` helper.
 *
 * Seeds the singleton with a stub ExtensionContext so `getInstance()` never
 * throws when source code touches it first.
 */
export function installMockConfig() {
  const fakeConfig: Record<string, unknown> = {};
  let installed = false;

  const install = () => {
    fakeConfig[ConfigKeys.OPENAI_API_KEY] = 'sk-test-openai';
    fakeConfig[ConfigKeys.OPENAI_MODEL] = 'gpt-4o';
    fakeConfig[ConfigKeys.OPENAI_TEMPERATURE] = 0.7;
    fakeConfig[ConfigKeys.OPENAI_BASE_URL] = '';
    fakeConfig[ConfigKeys.AZURE_API_VERSION] = '';
    fakeConfig[ConfigKeys.GEMINI_API_KEY] = 'gemini-test-key';
    fakeConfig[ConfigKeys.GEMINI_MODEL] = 'gemini-2.0-flash-001';
    fakeConfig[ConfigKeys.GEMINI_TEMPERATURE] = 0.7;
    fakeConfig[ConfigKeys.ANTHROPIC_MODEL] = 'claude-3-5-sonnet-20241022';
    fakeConfig[ConfigKeys.ANTHROPIC_TEMPERATURE] = 0.7;
    fakeConfig[ConfigKeys.POE_API_KEY] = 'poe-test-key';
    fakeConfig[ConfigKeys.POE_MODEL] = 'Claude-Sonnet-4.5';
    fakeConfig[ConfigKeys.POE_TEMPERATURE] = 0.7;
    fakeConfig[ConfigKeys.REASONING_MODE] = 'balanced';
    fakeConfig[ConfigKeys.AI_PROVIDER] = 'openai';
    fakeConfig[ConfigKeys.IGNORED_FILES] = [];
    fakeConfig[ConfigKeys.AI_COMMIT_LANGUAGE] = 'English';
    fakeConfig[ConfigKeys.SYSTEM_PROMPT] = '';
    fakeConfig[ConfigKeys.SYSTEM_APPEND] = '';
    fakeConfig[ConfigKeys.ENABLE_RECENT_COMMITS_CONTEXT] = false;
  };

  install();

  const originalGetConfig = ConfigurationManager.prototype.getConfig;
  (ConfigurationManager.prototype as unknown as { getConfig: typeof originalGetConfig }).getConfig = function <T>(
    key: string,
    defaultValue?: T
  ): T {
    if (Object.prototype.hasOwnProperty.call(fakeConfig, key)) {
      return fakeConfig[key] as T;
    }
    return defaultValue as T;
  };

  // Reset then re-seed with a stub context so getInstance() never throws.
  __resetGeminiForTests();
  __resetPoeForTests();
  __resetOpenAIForTests();
  ConfigurationManager.__resetForTests();
  ConfigurationManager.getInstance({
    globalState: {
      get: <T>(_key: string, defaultValue?: T) => defaultValue as T,
      update: async (_key: string, _value: unknown) => undefined
    },
    subscriptions: [],
    extensionPath: '',
    extensionUri: { fsPath: '', path: '', scheme: 'file' } as never
  } as never);

  installed = true;

  return {
    set<T>(key: string, value: T) {
      fakeConfig[key] = value;
    },
    restore() {
      (ConfigurationManager.prototype as unknown as { getConfig: typeof originalGetConfig }).getConfig =
        originalGetConfig;
      ConfigurationManager.__resetForTests();
      installed = false;
    }
  };
}
