import mockRequire from 'mock-require';

/**
 * Mocha global setup. Runs once before any test file is loaded.
 *
 * Order of operations matters:
 *   1. Pre-register the `vscode` mock so source modules that import it
 *      (config.ts, prompts.ts, etc.) can be loaded in a non-extension host.
 *   2. Pre-register the three external SDK mocks:
 *        - `@anthropic-ai/sdk`  — default-exported class (`import SDK from ...`)
 *        - `openai`              — default-exported class
 *        - `@google/genai`       — NAMED export `GoogleGenAI`
 *      The source modules call `new SDK(config)` / `new GoogleGenAI(config)`,
 *      so the mocks must be constructable. Because test files import source
 *      modules at the top via `tsx`, those imports hoist and the source
 *      loads before test bodies run. This file is loaded by mocharc first,
 *      so the mocks are installed in time.
 *   3. The `getMockSdk(modulePath)` helper returns the handle that
 *      individual tests use to inspect calls, queue responses, or replace
 *      the responder.
 */

type SdkHandle = {
  calls: Array<{ args: unknown[]; kwargs: Record<string, unknown> }>;
  respondWith: (value: unknown) => void;
  setResponder: (fn: (args: unknown[], kwargs: Record<string, unknown>) => unknown) => void;
  reset: () => void;
};

const sdkHandles = new Map<string, SdkHandle>();

function buildTrackedProxy(
  client: Record<string, unknown>,
  handle: SdkHandle,
  dispatch: (
    args: unknown[],
    kwargs: Record<string, unknown>,
    originalFn?: (...a: unknown[]) => unknown
  ) => unknown
): Record<string, unknown> {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop === 'symbol' || prop === '__tracked' || prop === 'then') {
        return value;
      }
      if (typeof value === 'function') {
        // Always return a wrapper that records the call. The original
        // function is never invoked directly — dispatch decides what to
        // return (default: call the real function).
        return (...args: unknown[]) => {
          // Record both `args` and `kwargs` so tests can assert on either
          // access pattern. `args[0]` is the first object payload (used by
          // Anthropic tests), `kwargs` is the merged object payload (used
          // by OpenAI/Gemini/Poe tests). Additional object args merge into
          // kwargs for the OpenAI `create(payload, options)` signature.
          const positional: unknown[] = [];
          const kwargs: Record<string, unknown> = {};
          let firstObjectSeen = false;
          for (const a of args) {
            if (a && typeof a === 'object' && !Array.isArray(a)) {
              if (!firstObjectSeen) {
                positional.push(a);
                firstObjectSeen = true;
              }
              Object.assign(kwargs, a);
            } else {
              positional.push(a);
            }
          }
          handle.calls.push({ args: positional, kwargs });
          return dispatch(positional, kwargs, value as (...a: unknown[]) => unknown);
        };
      }
      // Recursively wrap nested plain objects so deep property chains like
      // `client.messages.create` are also tracked. We cache the wrapped
      // object on the target itself so repeated accesses return the same
      // proxy (preserves identity for the source's cached client).
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const targetObj = target as Record<string, unknown>;
        const cacheKey = `__wrapped_${String(prop)}`;
        const cached = targetObj[cacheKey] as Record<string, unknown> | undefined;
        if (cached) {
          return cached;
        }
        const wrapped = buildTrackedProxy(value as Record<string, unknown>, handle, dispatch);
        (wrapped as { __tracked: boolean }).__tracked = true;
        targetObj[cacheKey] = wrapped;
        return wrapped;
      }
      return value;
    }
  });
}

function makeDispatch(handle: SdkHandle) {
  const responseQueue: unknown[] = [];
  let responder: ((args: unknown[], kwargs: Record<string, unknown>) => unknown) | undefined;
  return {
    dispatch(
      args: unknown[],
      kwargs: Record<string, unknown>,
      originalFn?: (...a: unknown[]) => unknown
    ) {
      if (responseQueue.length) {
        const next = responseQueue.shift();
        return typeof next === 'function'
          ? (next as (a: unknown[], k: Record<string, unknown>) => unknown)(args, kwargs)
          : next;
      }
      if (responder) {
        return responder(args, kwargs);
      }
      // Default: invoke the original function so the real mock behavior runs.
      if (typeof originalFn === 'function') {
        return originalFn.apply(undefined, args);
      }
      return undefined;
    },
    respondWith(value: unknown) {
      responseQueue.push(value);
    },
    setResponder(fn: (args: unknown[], kwargs: Record<string, unknown>) => unknown) {
      responder = fn;
    },
    reset() {
      handle.calls.length = 0;
      responseQueue.length = 0;
      responder = undefined;
    }
  };
}

function registerDefaultExportMock(
  modulePath: string,
  buildClient: () => Record<string, unknown>
) {
  const handle: SdkHandle = {
    calls: [],
    respondWith: () => undefined,
    setResponder: () => undefined,
    reset: () => undefined
  };
  const dispatchCtl = makeDispatch(handle);
  handle.respondWith = dispatchCtl.respondWith;
  handle.setResponder = dispatchCtl.setResponder;
  handle.reset = dispatchCtl.reset;

  // Build the client once and reuse it — the proxy traps forward to the
  // original function for default behavior.
  const client = buildClient();
  const proxiedClient = buildTrackedProxy(client, handle, dispatchCtl.dispatch);

  // Default export that the source imports as `import SDK from 'pkg'`.
  // Source does `new SDK({ apiKey })` so the export must be constructable.
  // In CJS, `module.exports = fn` makes it callable AND newable. With `new`,
  // the returned object (proxiedClient) becomes the instance.
  function MockConstructor(_opts?: unknown) {
    void _opts;
    return proxiedClient;
  }
  // Expose the client methods on the constructor for any code that calls
  // SDK.x statically (e.g. SDK.something()).
  Object.assign(MockConstructor, proxiedClient);
  (MockConstructor as unknown as { prototype: unknown }).prototype = proxiedClient;

  mockRequire(modulePath, MockConstructor);
  sdkHandles.set(modulePath, handle);
}

function registerNamedExportMock(
  modulePath: string,
  namedExport: string,
  buildClient: () => Record<string, unknown>,
  extraExports: Record<string, unknown> = {}
) {
  const handle: SdkHandle = {
    calls: [],
    respondWith: () => undefined,
    setResponder: () => undefined,
    reset: () => undefined
  };
  const dispatchCtl = makeDispatch(handle);
  handle.respondWith = dispatchCtl.respondWith;
  handle.setResponder = dispatchCtl.setResponder;
  handle.reset = dispatchCtl.reset;

  const client = buildClient();
  const proxiedClient = buildTrackedProxy(client, handle, dispatchCtl.dispatch);

  const namedConstructor = function MockNamedConstructor(_opts?: unknown) {
    void _opts;
    return proxiedClient;
  };
  (namedConstructor as unknown as { prototype: unknown }).prototype = proxiedClient;
  Object.assign(namedConstructor, proxiedClient);

  const moduleMock: Record<string, unknown> = {
    [namedExport]: namedConstructor,
    ...extraExports
  };
  mockRequire(modulePath, moduleMock);
  sdkHandles.set(modulePath, handle);
}

// ── vscode mock ───────────────────────────────────────────────────────────
const vscodeMock = {
  workspace: {
    getConfiguration: (_namespace?: string) => ({
      get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
      update: async () => undefined,
      has: () => false,
      inspect: () => undefined
    }),
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    isVirtualDocument: () => false
  },
  window: {
    showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showQuickPick: async () => undefined,
    showInputBox: async () => undefined,
    withProgress: async (_options: unknown, task: (progress: unknown) => Promise<unknown>) =>
      task({ report: () => undefined })
  },
  commands: {
    registerCommand: () => ({ dispose: () => undefined }),
    executeCommand: async () => undefined
  },
  env: {
    language: 'en',
    sessionId: 'test-session',
    isTelemetryEnabled: false
  },
  Uri: {
    file: (p: string) => ({ fsPath: p, path: p, scheme: 'file' }),
    parse: (p: string) => ({ fsPath: p, path: p, scheme: 'file' }),
    joinPath: (...parts: unknown[]) => ({ fsPath: parts.join('/'), path: parts.join('/'), scheme: 'file' })
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3
  },
  Disposable: class {
    private callOnDispose: () => void;
    constructor(callOnDispose: () => void) {
      this.callOnDispose = callOnDispose;
    }
    dispose() {
      this.callOnDispose();
    }
  },
  ProgressLocation: {
    Notification: 15,
    SourceControl: 10,
    Window: 10
  },
  EventEmitter: class {
    private listeners: Array<(e: unknown) => void> = [];
    event = (listener: (e: unknown) => void) => {
      this.listeners.push(listener);
      return { dispose: () => undefined };
    };
    fire(data: unknown) {
      this.listeners.forEach((l) => l(data));
    }
    dispose() {
      this.listeners = [];
    }
  },
  ExtensionContext: class {},
  SourceControl: class {},
  SourceControlResourceGroup: class {}
};

mockRequire('vscode', vscodeMock);

// ── fs-extra mock (no-op proxy) ──────────────────────────────────────────
const noopFsExtra = new Proxy(
  {},
  {
    get: (_target, prop: string) => {
      if (prop === '__esModule') return false;
      if (prop === 'default') return noopFsExtra;
      if (prop === 'then') return undefined;
      return (..._args: unknown[]) => Promise.resolve(undefined);
    }
  }
);

mockRequire('fs-extra', noopFsExtra);

// ── SDK mocks ────────────────────────────────────────────────────────────

// Anthropic: `import Anthropic from '@anthropic-ai/sdk'` → `new Anthropic({apiKey})`
//   client.messages.create(payload) → { content: [{ type: 'text', text: '...' }] }
registerDefaultExportMock('@anthropic-ai/sdk', () => ({
  messages: {
    create: async (_payload: unknown) => ({
      content: [{ type: 'text', text: 'commits: mock commit message' }]
    })
  }
}));

// OpenAI: `import OpenAI from 'openai'` → `new OpenAI(config)`
//   client.chat.completions.create(payload, opts) → { choices: [{ message: { content: '...' } }] }
registerDefaultExportMock('openai', () => ({
  chat: {
    completions: {
      create: async (_payload: unknown, _opts?: unknown) => ({
        choices: [{ message: { content: 'commits: mock poe chat' } }]
      })
    }
  },
  models: { list: async () => ({ data: [] }) }
}));

// @google/genai: `import { GoogleGenAI } from '@google/genai'` → `new GoogleGenAI({apiKey})`
//   client.models.generateContent(req) → { text, candidates: [] }
//   client.models.get({ model }) → { thinking: true|false }
//   client.models.list() → { models: [...] }
//   Also re-exports the `ThinkingLevel` enum (used by src/gemini-utils.ts).
registerNamedExportMock(
  '@google/genai',
  'GoogleGenAI',
  () => ({
    models: {
      get: async (_args: unknown) => ({ thinking: true }),
      generateContent: async (_args: unknown) => ({
        text: 'commits: mock gemini response',
        candidates: []
      }),
      list: async () => ({ models: [] })
    }
  }),
  {
    ThinkingLevel: {
      THINKING_LEVEL_UNSPECIFIED: 'THINKING_LEVEL_UNSPECIFIED',
      MINIMAL: 'MINIMAL',
      LOW: 'LOW',
      MEDIUM: 'MEDIUM',
      HIGH: 'HIGH'
    }
  }
);

// Expose handles for tests
declare global {
  // eslint-disable-next-line no-var
  var __sdkHandles: Map<string, SdkHandle>;
}
(globalThis as { __sdkHandles: Map<string, SdkHandle> }).__sdkHandles = sdkHandles;
