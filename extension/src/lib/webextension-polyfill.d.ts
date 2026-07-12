// Type shim for webextension-polyfill. The polyfill exposes a `browser`
// global; the types below are minimal (the codebase's only used APIs
// are storage.* and runtime.*). For browser-specific extensions to
// `chrome.*` types already exist via @types/chrome and
// @types/firefox-webext-browser.

declare module "webextension-polyfill" {
  namespace browser {
    type StorageAreaName = "local" | "sync" | "managed" | "session";
    interface StorageChange {
      newValue?: unknown;
      oldValue?: unknown;
    }
    interface StorageArea {
      get(
        keys: string | string[] | null | Record<string, unknown>,
      ): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      clear(): Promise<void>;
    }
    interface Storage {
      local: StorageArea;
      sync: StorageArea;
      managed: StorageArea;
      session: StorageArea;
    }
    interface StorageChangedCallback {
      (
        changes: Record<string, StorageChange>,
        areaName: StorageAreaName,
      ): void;
    }
    interface StorageChanged {
      addListener(cb: StorageChangedCallback): void;
      removeListener(cb: StorageChangedCallback): void;
    }
    interface StorageStatic extends Storage {
      onChanged: StorageChanged;
    }
    interface RuntimePort {
      name: string;
      disconnect(): void;
      postMessage(msg: unknown): void;
    }
    interface RuntimeStatic {
      id: string;
      lastError?: { message?: string };
      sendMessage: (id?: string, msg?: unknown) => Promise<unknown>;
      sendNativeMessage: (id: string, msg: unknown) => Promise<unknown>;
      connect?: (
        info?: { name?: string; includeTlsChannelId?: boolean },
      ) => RuntimePort;
      getURL: (path?: string) => string;
      getManifest: () => unknown;
    }
  }
  const browser: {
    storage: browser.StorageStatic;
    runtime: browser.RuntimeStatic;
  };
  export default browser;
}
