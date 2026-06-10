import * as vscode from 'vscode';

const MODELS_DEV_URL = 'https://models.dev/api.json';
const MODEL_REGISTRY_STATE_KEY = 'ai-commit-bermudi.modelRegistryCache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type ModelsDevProvider = {
  id: string;
  api?: string;
  models?: Record<string, ModelsDevModel>;
  [key: string]: unknown;
};

export type ModelsDevModel = {
  id: string;
  reasoning?: boolean;
  [key: string]: unknown;
};

type ModelsDevResponse = Record<string, ModelsDevProvider>;

export type ProviderMetadata = {
  id: string;
  apiBaseUrl?: string;
  raw?: ModelsDevProvider;
};

type ModelRegistryState = {
  data: ModelsDevResponse;
  timestamp: number;
};

const PROVIDER_NAME_MAP: Record<string, string> = {
  openai: 'openai',
  gemini: 'google'
};

function normalizeModelKey(id?: string) {
  return id?.trim().toLowerCase() ?? '';
}

function buildModelAliases(id: string): string[] {
  const aliases = new Set<string>();
  const normalized = normalizeModelKey(id);
  if (normalized) {
    aliases.add(normalized);
  }

  const slashFragment = id.split('/').pop();
  if (slashFragment) {
    const key = normalizeModelKey(slashFragment);
    if (key) {
      aliases.add(key);
    }
  }

  const colonFragment = id.split(':').pop();
  if (colonFragment) {
    const key = normalizeModelKey(colonFragment);
    if (key) {
      aliases.add(key);
    }
  }

  return Array.from(aliases);
}

export class ModelRegistry {
  private static instance: ModelRegistry;
  private context?: vscode.ExtensionContext;
  private cache: ModelsDevResponse | null = null;
  private lastFetched = 0;
  private modelIndex: Map<string, ModelsDevModel> = new Map();
  private inflightRefresh?: Promise<ModelsDevResponse | null>;

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new ModelRegistry();
    }
    return this.instance;
  }

  /** Test-only: reset the singleton and clear cached data. */
  static __resetForTests() {
    if (this.instance) {
      this.instance.cache = null;
      this.instance.modelIndex = new Map();
      this.instance.lastFetched = 0;
      this.instance.inflightRefresh = undefined;
    }
    this.instance = undefined as unknown as ModelRegistry;
  }

  initialize(context: vscode.ExtensionContext) {
    this.context = context;
    this.tryHydrateFromState();
  }

  async refresh(options?: { force?: boolean }) {
    const now = Date.now();
    const shouldForce = options?.force ?? false;
    if (!shouldForce && this.cache && now - this.lastFetched < CACHE_TTL_MS) {
      return this.cache;
    }

    if (this.inflightRefresh && !shouldForce) {
      return this.inflightRefresh;
    }

    const refreshPromise = this.performRefresh();
    if (!shouldForce) {
      this.inflightRefresh = refreshPromise;
    }

    try {
      return await refreshPromise;
    } finally {
      if (this.inflightRefresh === refreshPromise) {
        this.inflightRefresh = undefined;
      }
    }
  }

  getProviders() {
    this.ensureCache();
    const cacheKeys = Object.keys(this.cache ?? {});
    const aliasKeys = Object.entries(PROVIDER_NAME_MAP)
      .filter(([, target]) => cacheKeys.includes(target))
      .map(([alias]) => alias);
    return Array.from(new Set([...cacheKeys, ...aliasKeys])).sort();
  }

  getModels(providerId: string) {
    this.ensureCache();
    const mappedProvider = PROVIDER_NAME_MAP[providerId] ?? providerId;
    const provider = this.cache?.[mappedProvider];
    if (!provider?.models) {
      return [];
    }
    return Object.keys(provider.models);
  }

  getCapabilities(modelId?: string) {
    if (!modelId) {
      return undefined;
    }
    this.ensureCache();
    return this.modelIndex.get(normalizeModelKey(modelId));
  }

  getProviderMetadata(providerId: string): ProviderMetadata | undefined {
    this.ensureCache();
    const mappedProvider = PROVIDER_NAME_MAP[providerId] ?? providerId;
    const provider = this.cache?.[mappedProvider];
    if (!provider) {
      return undefined;
    }
    return {
      id: provider.id ?? mappedProvider,
      apiBaseUrl: typeof provider.api === 'string' ? provider.api : undefined,
      raw: provider
    };
  }

  private async performRefresh() {
    try {
      const data = await fetchModelsDev();
      const timestamp = Date.now();
      this.setCache(data, timestamp);
      return data;
    } catch (error) {
      console.warn('ModelRegistry refresh failed', error);
      if (!this.cache) {
        this.tryHydrateFromState();
      }
      throw error;
    }
  }

  private ensureCache() {
    if (this.cache) {
      return;
    }
    this.tryHydrateFromState();
  }

  private tryHydrateFromState() {
    if (!this.context) {
      return;
    }
    const stored = this.context.globalState.get<ModelRegistryState>(MODEL_REGISTRY_STATE_KEY);
    if (stored?.data) {
      this.setCache(stored.data, stored.timestamp, false);
    }
  }

  private setCache(data: ModelsDevResponse, timestamp: number, persist = true) {
    this.cache = data;
    this.lastFetched = timestamp;
    this.rebuildModelIndex();
    if (persist && this.context) {
      void this.context.globalState.update(MODEL_REGISTRY_STATE_KEY, {
        data,
        timestamp
      });
    }
  }

  private rebuildModelIndex() {
    this.modelIndex.clear();
    if (!this.cache) {
      return;
    }
    for (const provider of Object.values(this.cache)) {
      const models = provider?.models;
      if (!models) {
        continue;
      }
      for (const [modelId, model] of Object.entries(models)) {
        const aliases = new Set<string>([
          ...buildModelAliases(modelId),
          ...buildModelAliases((model?.id as string) ?? '')
        ]);
        for (const alias of aliases) {
          this.modelIndex.set(alias, model);
        }
      }
    }
  }
}

function fetchModelsDev(): Promise<ModelsDevResponse> {
  const fetcher: typeof fetch | undefined = (globalThis as { fetch?: typeof fetch }).fetch;
  if (!fetcher) {
    return Promise.reject(new Error('fetch is not available in this environment'));
  }
  return (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(MODELS_DEV_URL, {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`models.dev responded with ${response.status} ${response.statusText}`);
      }
      const data = (await response.json()) as ModelsDevResponse;
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  })();
}
