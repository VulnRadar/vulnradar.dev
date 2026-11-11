"use client";

import { useRef, type KeyboardEvent } from "react";

/**
 * Where a key moves focus in a radio group of `count` options, from
 * `current`, or null for a key the group does not handle. Arrows wrap, as the
 * WAI-ARIA radio group pattern describes; Home and End go to the ends.
 */
export function nextRadioIndex(
  key: string,
  current: number,
  count: number,
): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * The tab stop of a radio group: the checked option, or the first one while
 * nothing is checked, so Tab enters the group once and leaves it once.
 */
export function radioTabStop<T>(
  values: readonly T[],
  selected: T | null,
): T | undefined {
  return selected !== null && values.includes(selected) ? selected : values[0];
}

/** What `getRadioProps` hands each option, to spread onto it. */
export interface RadioItemProps {
  tabIndex: 0 | -1;
  ref: (node: HTMLElement | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

interface RadioGroupKeysOptions<T extends string> {
  /** Every option, in the order they appear on the page. */
  values: readonly T[];
  selected: T | null;
  onSelect: (value: T) => void;
}

/**
 * Keyboard behaviour for a group of role="radio" buttons: a roving tabindex
 * (one tab stop for the whole group), arrows that move focus and check the
 * option they land on, Home and End.
 *
 * Without it every option was its own tab stop, so a keyboard user tabbed
 * through all nine contact categories to reach the form under them, and the
 * arrows a screen reader announces for a radio group did nothing.
 *
 * Spread `getRadioProps(value)` onto each option.
 */
export function useRadioGroupKeys<T extends string>({
  values,
  selected,
  onSelect,
}: RadioGroupKeysOptions<T>) {
  const nodes = useRef(new Map<T, HTMLElement>());
  const tabStop = radioTabStop(values, selected);

  function getRadioProps(value: T): RadioItemProps {
    return {
      tabIndex: value === tabStop ? 0 : -1,
      ref: (node: HTMLElement | null) => {
        if (node) nodes.current.set(value, node);
        else nodes.current.delete(value);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        // Alt+Left is "back" in most browsers; a modified key is not ours.
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const next = nextRadioIndex(
          event.key,
          values.indexOf(value),
          values.length,
        );
        if (next === null) return;
        event.preventDefault();
        const target = values[next];
        onSelect(target);
        nodes.current.get(target)?.focus();
      },
    };
  }

  return { getRadioProps };
}
