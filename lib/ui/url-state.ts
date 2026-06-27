"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const QUERY_CHANGE_EVENT = "vr:query-change";

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
  const href = window.location.pathname + window.location.hash;
  const method = opts.replace ? "replaceState" : "pushState";
  window.history[method](null, "", href);
  new URLSearchParams(window.location.search).forEach((_value, key) => {
    emitQueryChange(key, null);
  });
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
  valueRef.current = value;

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
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener(QUERY_CHANGE_EVENT, onQueryChange);
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

export function useQueryParamInt(
  name: string,
  fallback: number | null,
): [number | null, (next: number | null) => void] {
  const [value, setValue] = useState<number | null>(() => {
    const raw = getQueryParamInt(name);
    return raw ?? fallback;
  });

  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncFromUrl = () => {
      const raw = getQueryParamInt(name);
      const next = raw ?? fallback;
      if (next !== valueRef.current) setValue(next);
    };
    const onQueryChange = (e: Event) => {
      const detail = (e as CustomEvent<QueryChangeDetail>).detail;
      if (detail.key === name) syncFromUrl();
    };
    const onPopState = () => syncFromUrl();
    syncFromUrl();
    window.addEventListener(QUERY_CHANGE_EVENT, onQueryChange);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener(QUERY_CHANGE_EVENT, onQueryChange);
      window.removeEventListener("popstate", onPopState);
    };
  }, [name, fallback]);

  const update = useCallback(
    (next: number | null) => {
      setQueryParam(
        name,
        next === null ? null : String(next),
      );
      setValue(next);
    },
    [name],
  );

  return [value, update];
}