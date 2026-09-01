"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const QUERY_CHANGE_EVENT = "vr:query-change";

/**
 * Fired whenever the URL changes by ANY means: our own setQueryParam helpers,
 * a Next.js <Link> soft navigation, router.push/replace, or back/forward.
 *
 * QUERY_CHANGE_EVENT only fires for our own writes and names the exact key.
 * This is the catch-all "the location changed, re-read what you depend on"
 * signal, and it exists because a Next.js soft navigation to the pathname you
 * are already on (e.g. clicking the History nav link while viewing
 * /history?scan=X) updates the URL via history.pushState but fires neither
 * popstate nor our own event, and the page component does not remount, so a
 * query-driven sub-view (the open scan) would otherwise never reset.
 *
 * Because it is a catch-all it carries no key, and a listener therefore fires
 * for URL writes that have nothing to do with it, including its own page's
 * other controls. A subscriber that does real work (a refetch above all) MUST
 * diff the value it cares about and bail when that value has not moved.
 * app/history/page.tsx reloaded the open scan on every one of these events,
 * so each findings filter toggle blanked a loaded report behind the skeleton;
 * see components/history/scan-param-sync.ts.
 */
export const LOCATION_CHANGE_EVENT = "vr:location-change";

/**
 * Patch history.pushState/replaceState once so every URL change emits
 * LOCATION_CHANGE_EVENT, including Next.js router navigations, which call these
 * directly and fire no event of their own. popstate (back/forward) is bridged
 * too. Guarded so the module being imported by many components patches once.
 */
function installLocationChangeBridge(): void {
  if (typeof window === "undefined") return;
  const w = window as typeof window & { __vrLocationBridge?: boolean };
  if (w.__vrLocationBridge) return;
  w.__vrLocationBridge = true;
  const emit = () => window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
  const origPush = window.history.pushState.bind(window.history);
  window.history.pushState = function (
    ...args: Parameters<History["pushState"]>
  ): void {
    origPush(...args);
    emit();
  };
  const origReplace = window.history.replaceState.bind(window.history);
  window.history.replaceState = function (
    ...args: Parameters<History["replaceState"]>
  ): void {
    origReplace(...args);
    emit();
  };
  window.addEventListener("popstate", emit);
}
installLocationChangeBridge();

type QueryChangeDetail = {
  key: string;
  value: string | null;
};

function emitQueryChange(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<QueryChangeDetail>(QUERY_CHANGE_EVENT, {
      detail: { key, value },
    }),
  );
}

function readSearch(): string {
  if (typeof window === "undefined") return "";
  return window.location.search;
}

function hasHistory(): boolean {
  return typeof window !== "undefined" && typeof window.history !== "undefined";
}

function getCurrentParams(): URLSearchParams {
  return new URLSearchParams(readSearch());
}

function buildHref(params: URLSearchParams): string {
  const search = params.toString();
  if (typeof window === "undefined") return search ? `?${search}` : "";
  const path = window.location.pathname + window.location.hash;
  return search ? `${path}?${search}` : path;
}

export function getQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const value = params.get(name);
  return value === null || value === "" ? null : value;
}

export function getQueryParamInt(name: string): number | null {
  const raw = getQueryParam(name);
  if (raw === null) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getAllQueryParams(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const out: Record<string, string> = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

type WriteOpts = {
  replace?: boolean;
};

export function setQueryParam(
  name: string,
  value: string | null,
  opts: WriteOpts = {},
): void {
  if (!hasHistory()) return;
  const params = getCurrentParams();
  if (value === null || value === "") {
    params.delete(name);
  } else {
    params.set(name, value);
  }
  const href = buildHref(params);
  const method = opts.replace ? "replaceState" : "pushState";
  window.history[method](null, "", href);
  emitQueryChange(name, value);
}

export function setQueryParams(
  values: Record<string, string | null>,
  opts: WriteOpts = {},
): void {
  if (!hasHistory()) return;
  const params = getCurrentParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  const href = buildHref(params);
  const method = opts.replace ? "replaceState" : "pushState";
  window.history[method](null, "", href);
  for (const [key, value] of Object.entries(values)) {
    emitQueryChange(key, value);
  }
}

export function removeQueryParam(name: string, opts: WriteOpts = {}): void {
  setQueryParam(name, null, opts);
}

export function clearQueryParams(opts: WriteOpts = {}): void {
  if (!hasHistory()) return;
  // Read which keys are present BEFORE touching history: pushState /
  // replaceState synchronously updates window.location, so reading
  // window.location.search after that call would always see the
  // already-cleared, query-string-less URL and never find anything to
  // emit an event for.
  const clearedKeys = Array.from(
    new URLSearchParams(window.location.search).keys(),
  );
  const href = window.location.pathname + window.location.hash;
  const method = opts.replace ? "replaceState" : "pushState";
  window.history[method](null, "", href);
  for (const key of clearedKeys) {
    emitQueryChange(key, null);
  }
}

export function useQueryParam<T extends string = string>(
  name: string,
  fallback: T,
): [T, (next: T | null) => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = getQueryParam(name);
    return (raw ?? fallback) as T;
  });

  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncFromUrl = () => {
      const raw = getQueryParam(name);
      const next = (raw ?? fallback) as T;
      if (next !== valueRef.current) setValue(next);
    };
    const onQueryChange = (e: Event) => {
      const detail = (e as CustomEvent<QueryChangeDetail>).detail;
      if (detail.key === name) syncFromUrl();
    };
    const onPopState = () => syncFromUrl();
    syncFromUrl();
    window.addEventListener(QUERY_CHANGE_EVENT, onQueryChange);
    // Catches Next.js <Link> soft navigations (which fire neither our event
    // nor popstate) so a param cleared by navigating away actually re-syncs.
    window.addEventListener(LOCATION_CHANGE_EVENT, onPopState);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener(QUERY_CHANGE_EVENT, onQueryChange);
      window.removeEventListener(LOCATION_CHANGE_EVENT, onPopState);
      window.removeEventListener("popstate", onPopState);
    };
  }, [name, fallback]);

  const update = useCallback(
    (next: T | null) => {
      setQueryParam(name, next);
      setValue((next ?? fallback) as T);
    },
    [name, fallback],
  );

  return [value, update];
}
