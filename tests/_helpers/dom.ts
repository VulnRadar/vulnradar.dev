import { afterEach } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";

/**
 * Shared setup for the suites that opt in to jsdom with the
 * `// @vitest-environment jsdom` docblock. Import it for its side effects.
 *
 * Every other suite stays in node, so none of this can live in a global setup
 * file. Testing Library only registers its own cleanup and act flag when the
 * runner exposes `afterEach` as a global, which this config does not, so a
 * suite that skips this leaves each test's dialogs in the document for the
 * next one to find.
 */
const reactEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
reactEnv.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

/** `requestSubmit` inside act, since the handlers it runs set React state. */
export function submitForm(form: HTMLFormElement): void {
  act(() => form.requestSubmit());
}

/**
 * Enter in a single-line input, the way a browser does it. jsdom does not
 * implement implicit submission, so firing keydown alone proves nothing about
 * whether the form would have saved: submit unless a handler cancelled it.
 */
export function pressEnter(input: HTMLInputElement): void {
  const notCancelled = fireEvent.keyDown(input, { key: "Enter" });
  if (notCancelled && input.form) submitForm(input.form);
}
