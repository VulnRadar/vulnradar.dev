import { vi } from "vitest";

/**
 * An in-memory stand-in for `webextension-polyfill`, shared by the suites that
 * import a module which reaches `browser.*`.
 *
 * Install it with a factory, so the real package never has to resolve (the
 * root test job has no extension/node_modules):
 *
 *   vi.mock("webextension-polyfill", async () => ({
 *     default: (await import("./_polyfill-fake")).fake,
 *   }));
 *
 * It models only what the extension calls: storage.local with change events,
 * runtime messaging, tabs, alarms, notifications, downloads and the toolbar
 * badge. Every function is a vi.fn so a test can assert on how it was called.
 * `reset()` returns the fake to a clean slate between tests, and
 * `removeApis(...)` deletes whole namespaces to model a browser (Firefox for
 * Android) that lacks them.
 *
 * The state lives on globalThis rather than in this module's own scope: a suite
 * that calls vi.resetModules() to get a fresh service worker re-evaluates this
 * file, and the copy the factory hands to the extension code must still be the
 * one the test file holds.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => unknown;

export interface FakeEvent<L extends Listener = Listener> {
  readonly listeners: L[];
  addListener(listener: L): void;
  removeListener(listener: L): void;
  hasListener(listener: L): boolean;
}

type Change = { oldValue?: unknown; newValue?: unknown };

function createEvent<L extends Listener = Listener>(): FakeEvent<L> {
  const listeners: L[] = [];
  return {
    listeners,
    addListener: (l) => {
      listeners.push(l);
    },
    removeListener: (l) => {
      const i = listeners.indexOf(l);
      if (i >= 0) listeners.splice(i, 1);
    },
    hasListener: (l) => listeners.includes(l),
  };
}

function build() {
  /** What storage.local holds. Tests read and seed it directly. */
  const storageData: Record<string, unknown> = {};
  /** Every key passed to storage.local.set, one array per call. */
  const setCalls: string[][] = [];
  const storageChanged =
    createEvent<(changes: Record<string, Change>, areaName: string) => void>();

  function pick(keys?: string | string[] | null) {
    if (keys === undefined || keys === null) return { ...storageData };
    const out: Record<string, unknown> = {};
    for (const k of typeof keys === "string" ? [keys] : keys) {
      if (k in storageData) out[k] = storageData[k];
    }
    return out;
  }

  function emit(changes: Record<string, Change>) {
    if (Object.keys(changes).length === 0) return;
    for (const l of storageChanged.listeners) l(changes, "local");
  }

  function createApis() {
    return {
      storage: {
        local: {
          get: vi.fn(async (keys?: string | string[] | null) => pick(keys)),
          set: vi.fn(async (items: Record<string, unknown>) => {
            setCalls.push(Object.keys(items));
            const changes: Record<string, Change> = {};
            for (const [k, v] of Object.entries(items)) {
              changes[k] = { oldValue: storageData[k], newValue: v };
              storageData[k] = structuredClone(v);
            }
            emit(changes);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const changes: Record<string, Change> = {};
            for (const k of typeof keys === "string" ? [keys] : keys) {
              if (k in storageData) {
                changes[k] = { oldValue: storageData[k] };
                delete storageData[k];
              }
            }
            emit(changes);
          }),
          clear: vi.fn(async () => {
            const changes: Record<string, Change> = {};
            for (const k of Object.keys(storageData)) {
              changes[k] = { oldValue: storageData[k] };
              delete storageData[k];
            }
            emit(changes);
          }),
        },
        onChanged: storageChanged,
      },
      runtime: {
        id: "support@vulnradar.dev",
        getURL: (path: string) => `moz-extension://test-uuid/${path}`,
        getManifest: () => ({ version: "0.0.0-test" }),
        onMessage:
          createEvent<
            (
              msg: unknown,
              sender: unknown,
              sendResponse: (response: unknown) => void,
            ) => unknown
          >(),
        onInstalled: createEvent(),
        onStartup: createEvent(),
        sendMessage: vi.fn(async (_message: unknown) => undefined as unknown),
        openOptionsPage: vi.fn(async () => undefined),
      },
      tabs: {
        create: vi.fn(async (_props: unknown) => ({ id: 1 })),
        get: vi.fn(async (_id: number) => ({}) as Record<string, unknown>),
        sendMessage: vi.fn(
          async (_tabId: number, _message: unknown) => undefined as unknown,
        ),
        onActivated: createEvent(),
        onUpdated: createEvent(),
      },
      alarms: {
        create: vi.fn(async () => undefined),
        clear: vi.fn(async () => true),
        onAlarm: createEvent(),
      },
      contextMenus: {
        removeAll: vi.fn(async () => undefined),
        create: vi.fn(() => "id"),
        onClicked: createEvent(),
      },
      notifications: {
        create: vi.fn(async (id: string, _options: unknown) => id),
        onClicked: createEvent(),
      },
      downloads: {
        download: vi.fn(async () => 1),
        onChanged: createEvent(),
      },
      action: {
        setBadgeText: vi.fn(),
        setBadgeBackgroundColor: vi.fn(),
      },
    };
  }

  return {
    storageData,
    setCalls,
    storageChanged,
    createApis,
    fake: createApis(),
  };
}

const KEY = Symbol.for("vulnradar.extensionTests.polyfillFake");
const holder = globalThis as unknown as Record<
  symbol,
  ReturnType<typeof build>
>;
const state = (holder[KEY] ??= build());

export const fake = state.fake;
export const storageData = state.storageData;
export const setCalls = state.setCalls;

type Namespace = keyof typeof fake;

/** Models a browser that has no such API at all (Firefox for Android has no
 *  contextMenus and no notifications). The property is deleted, not nulled, so
 *  `browser.notifications` reads as `undefined`, exactly as it does there. */
export function removeApis(...namespaces: Namespace[]): void {
  for (const ns of namespaces) {
    delete (fake as Partial<typeof fake>)[ns];
  }
}

/** Clean slate: empty storage, fresh mocks, no listeners, every namespace
 *  restored. Call from beforeEach. */
export function reset(): void {
  for (const k of Object.keys(storageData)) delete storageData[k];
  setCalls.length = 0;
  state.storageChanged.listeners.length = 0;
  const fresh = state.createApis();
  for (const ns of Object.keys(fresh) as Namespace[]) {
    (fake as Record<string, unknown>)[ns] = fresh[ns];
  }
}
