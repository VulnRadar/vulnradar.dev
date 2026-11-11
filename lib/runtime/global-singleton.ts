/**
 * One instance of a piece of process-wide state, however many times the
 * module that declares it is bundled.
 *
 * Next compiles a server module once per runtime layer (route handlers,
 * instrumentation, the server components graph), so a module-level
 * `new Set()` is several sets in one process and each copy only sees its own
 * writes. That is how a scan cancelled from a route kept running: the route
 * flagged one copy of the cancel set and the job checked another. Keyed on
 * `Symbol.for(key)` so every copy, in every layer, resolves the same slot on
 * globalThis, and a symbol rather than a string so the slot never shows up in
 * an enumeration of globalThis.
 *
 * `init` runs once, the first time any copy asks for `key`. Keys are
 * namespaced `vulnradar.<module>.<thing>`: two modules that picked the same
 * key would silently share one object of possibly different shapes.
 */
export function globalSingleton<T>(key: string, init: () => T): T {
  const store = globalThis as unknown as Record<symbol, T | undefined>;
  const slot = Symbol.for(key);
  let value = store[slot];
  if (value === undefined) {
    value = init();
    store[slot] = value;
  }
  return value;
}
