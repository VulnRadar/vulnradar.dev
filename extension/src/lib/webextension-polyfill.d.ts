// Type shim for webextension-polyfill. The polyfill exposes a `browser`
// global; the types below are minimal but cover every API the extension
// actually uses (storage, runtime, tabs, action, alarms, notifications).
// For browser-specific extensions, @types/chrome and
// @types/firefox-webext-browser already provide the same surfaces.

declare module "webextension-polyfill" {
  namespace browser {
    type StorageAreaName = "local" | "sync" | "managed" | "session";

    interface StorageChange {
      newValue?: unknown;
      oldValue?: unknown;
    }

    interface StorageArea {
      get(
        keys?: string | string[] | null | Record<string, unknown>,
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

    interface OnInstalledDetails {
      reason:
        | "install"
        | "update"
        | "chrome_update"
        | "shared_module_update";
      previousVersion?: string;
    }

    interface RuntimeStatic {
      id: string;
      lastError?: { message?: string };
      sendMessage: (msg: unknown) => Promise<unknown>;
      sendMessage: (id: string, msg: unknown) => Promise<unknown>;
      sendNativeMessage: (id: string, msg: unknown) => Promise<unknown>;
      connect?: (
        info?: { name?: string; includeTlsChannelId?: boolean },
      ) => RuntimePort;
      getURL: (path?: string) => string;
      getManifest: () => unknown;
      openOptionsPage: () => Promise<void>;
      onInstalled: { addListener: (cb: (d: OnInstalledDetails) => void) => void };
      onStartup: { addListener: (cb: () => void) => void };
      onMessage: {
        addListener: (
          cb: (msg: unknown, sender: unknown) => unknown | Promise<unknown>,
        ) => void;
        removeListener: (
          cb: (msg: unknown, sender: unknown) => unknown | Promise<unknown>,
        ) => void;
      };
    }

    interface Tab {
      id?: number;
      url?: string;
      title?: string;
      active?: boolean;
    }

    interface TabsStatic {
      query: (q: Record<string, unknown>) => Promise<Tab[]>;
      get: (tabId: number) => Promise<Tab | undefined>;
      create: (
        createProperties: Record<string, unknown>,
      ) => Promise<Tab | undefined>;
      sendMessage: (
        tabId: number,
        msg: unknown,
      ) => Promise<unknown>;
    }

    interface ActionBadge {
      setBadgeText: (d: { text: string; tabId?: number }) => Promise<void>;
      setBadgeBackgroundColor: (d: { color: string | string[] }) => Promise<void>;
      setIcon: (d: { path?: string; tabId?: number }) => Promise<void>;
      onClicked: {
        addListener: (cb: (tab: Tab) => void) => void;
        removeListener: (cb: (tab: Tab) => void) => void;
      };
      openPopup?: () => Promise<void>;
    }

    interface ActionStatic {
      onClicked: ActionBadge["onClicked"];
      setBadgeText: ActionBadge["setBadgeText"];
      setBadgeBackgroundColor: ActionBadge["setBadgeBackgroundColor"];
      setIcon: ActionBadge["setIcon"];
      openPopup?: () => Promise<void>;
    }

    interface Alarm {
      name: string;
      scheduledTime?: number;
    }

    interface AlarmsStatic {
      get: () => Promise<Alarm[]>;
      create: (name: string, info: { delayInMinutes: number }) => Promise<void>;
      clear: (name: string) => Promise<boolean>;
      onAlarm: {
        addListener: (cb: (alarm: Alarm) => void) => void;
        removeListener: (cb: (alarm: Alarm) => void) => void;
      };
    }

    interface NotificationOptions {
      type?: "basic" | "image" | "list" | "progress";
      iconUrl?: string;
      title?: string;
      message?: string;
    }

    interface NotificationsStatic {
      create: (id: string, options: NotificationOptions) => Promise<string>;
    }
  }

  const browser: {
    storage: browser.StorageStatic;
    runtime: browser.RuntimeStatic;
    tabs: browser.TabsStatic;
    action: browser.ActionStatic;
    alarms: browser.AlarmsStatic;
    notifications: browser.NotificationsStatic;
  };
  export default browser;
}
