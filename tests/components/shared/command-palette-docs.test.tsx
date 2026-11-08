// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ me: null, isStaff: false }),
}));
vi.mock("@/lib/hooks/use-client-config", () => ({
  useClientConfig: () => ({}),
}));

import { CommandPalette } from "@/components/shared/command-palette";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const input = () => document.querySelector<HTMLInputElement>("[cmdk-input]")!;

function toggle() {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("the palette's Docs group", () => {
  it("lists pages when opened and sections only once something is typed", () => {
    render(<CommandPalette defaultOpen />);
    expect(screen.getByRole("option", { name: "Webhooks" })).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: "Webhooks > Events" }),
    ).toBeNull();

    fireEvent.change(input(), { target: { value: "webhooks events" } });
    expect(
      screen.getByRole("option", { name: "Webhooks > Events" }),
    ).toBeTruthy();
  });

  it("starts empty every time it opens", () => {
    render(<CommandPalette defaultOpen />);
    fireEvent.change(input(), { target: { value: "webhooks" } });
    expect(input().value).toBe("webhooks");

    toggle();
    expect(document.querySelector("[cmdk-input]")).toBeNull();
    toggle();
    expect(input().value).toBe("");
  });
});
