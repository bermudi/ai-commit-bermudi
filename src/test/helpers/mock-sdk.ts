/**
 * Test helper: retrieve the SDK mock handle that was pre-registered by
 * `src/test/setup.ts` (which mocha requires first).
 *
 * The setup file installs default constructors for @anthropic-ai/sdk,
 * openai, and @google/genai. This helper returns the handle so individual
 * tests can inspect calls, queue specific responses, or replace the responder.
 */

export type RecordedCall = { args: unknown[]; kwargs: Record<string, unknown> };

export interface SdkMockHandle {
  /** Recorded method invocations on the mock client. */
  calls: RecordedCall[];
  /** Queue a single value to be returned by the next call (FIFO). */
  respondWith: (value: unknown) => void;
  /** Replace the responder. Receives (args, kwargs) and returns a value. */
  setResponder: (fn: (args: unknown[], kwargs: Record<string, unknown>) => unknown) => void;
  /** Clear recorded calls and queued responses. */
  reset: () => void;
}

export function getMockSdk(modulePath: string): SdkMockHandle {
  const handles = (globalThis as { __sdkHandles: Map<string, SdkMockHandle> }).__sdkHandles;
  const handle = handles?.get(modulePath);
  if (!handle) {
    throw new Error(
      `No SDK mock registered for "${modulePath}". ` +
      `Add a registerSdkMock() call in src/test/setup.ts.`
    );
  }
  return handle;
}
