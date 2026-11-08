/**
 * Drives a function component's handlers under node, with no renderer.
 *
 * This suite has no DOM library, so a component cannot be clicked. What a
 * click does, though, is call a handler the component put in its element
 * tree, and React's hooks under that are only a list of slots read in call
 * order. So a test file mocks `react` with `mockReact`, calls the component
 * as a plain function through `harness`, finds the element it wants in the
 * returned tree, calls its handler, and renders again to read the new state.
 * Child components are never called: their elements, and the props the
 * component handed them, are what is under test.
 *
 * In the test file:
 *
 *   vi.mock("react", async (importOriginal) => {
 *     const { mockReact } = await import("./_hook-harness");
 *     return mockReact(await importOriginal<typeof import("react")>());
 *   });
 */

interface Store {
  slots: unknown[];
  index: number;
}

let current: Store | null = null;

function store(): Store {
  if (!current) throw new Error("a hook ran outside a harness render");
  return current;
}

function slot<T>(make: () => T): { s: Store; i: number; value: T } {
  const s = store();
  const i = s.index++;
  if (!(i in s.slots)) s.slots[i] = make();
  return { s, i, value: s.slots[i] as T };
}

export function mockReact<T extends object>(actual: T): T {
  const overrides = {
    useState: <V>(init: V | (() => V)) => {
      const { s, i, value } = slot(() =>
        typeof init === "function" ? (init as () => V)() : init,
      );
      const set = (next: V | ((prev: V) => V)) => {
        s.slots[i] =
          typeof next === "function"
            ? (next as (prev: V) => V)(s.slots[i] as V)
            : next;
      };
      return [value, set];
    },
    useRef: <V>(init: V) => slot(() => ({ current: init })).value,
    useId: () => `:h${slot(() => store().index).value}:`,
    useMemo: <V>(make: () => V) => make(),
    useCallback: <F>(fn: F) => fn,
    // Effects never run: what they would do is not what these suites test,
    // and a test that needs one calls the state it would have set directly.
    useEffect: () => {},
    useLayoutEffect: () => {},
    useInsertionEffect: () => {},
    useSyncExternalStore: <V>(_subscribe: unknown, getSnapshot: () => V) =>
      getSnapshot(),
    useContext: <V>(context: { _currentValue: V }) => context._currentValue,
  };
  const base = (actual as { default?: object }).default ?? actual;
  return { ...actual, ...overrides, default: { ...base, ...overrides } } as T;
}

/** One component instance: its hook state survives between renders. */
export function harness<P>(component: (props: P) => unknown) {
  const s: Store = { slots: [], index: 0 };
  return {
    render(props: P): unknown {
      const previous = current;
      current = s;
      s.index = 0;
      try {
        return component(props);
      } finally {
        current = previous;
      }
    },
  };
}

export interface El {
  type: unknown;
  props: Record<string, unknown>;
}

export function isEl(node: unknown): node is El {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    "props" in node &&
    typeof (node as El).props === "object"
  );
}

function walk(node: unknown, visit: (el: El) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isEl(node)) return;
  visit(node);
  for (const [key, value] of Object.entries(node.props)) {
    if (key === "children" || isEl(value) || Array.isArray(value)) {
      walk(value, visit);
    }
  }
}

export function findAll(node: unknown, match: (el: El) => boolean): El[] {
  const out: El[] = [];
  walk(node, (el) => {
    if (match(el)) out.push(el);
  });
  return out;
}

export function find(node: unknown, match: (el: El) => boolean): El {
  const all = findAll(node, match);
  if (all.length === 0) throw new Error("no element matched");
  return all[0];
}

/** The text a screen would show for this node: every string under it. */
export function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isEl(node)) return textOf(node.props.children);
  return "";
}

export const ofType =
  (type: unknown) =>
  (el: El): boolean =>
    el.type === type;

export const labelled =
  (label: string) =>
  (el: El): boolean =>
    el.props["aria-label"] === label;
