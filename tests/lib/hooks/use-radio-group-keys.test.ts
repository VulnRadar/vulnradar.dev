// @vitest-environment jsdom
/**
 * useRadioGroupKeys (lib/hooks/use-radio-group-keys.ts): a role="radio" group
 * that behaves like one from the keyboard. One tab stop for the group, arrows
 * that move and check, Home and End.
 */
import { createElement, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  nextRadioIndex,
  radioTabStop,
  useRadioGroupKeys,
} from "@/lib/hooks/use-radio-group-keys";

afterEach(cleanup);

describe("nextRadioIndex", () => {
  it("moves forward on ArrowRight and ArrowDown, wrapping at the end", () => {
    expect(nextRadioIndex("ArrowRight", 0, 3)).toBe(1);
    expect(nextRadioIndex("ArrowDown", 1, 3)).toBe(2);
    expect(nextRadioIndex("ArrowRight", 2, 3)).toBe(0);
  });

  it("moves back on ArrowLeft and ArrowUp, wrapping at the start", () => {
    expect(nextRadioIndex("ArrowLeft", 2, 3)).toBe(1);
    expect(nextRadioIndex("ArrowUp", 0, 3)).toBe(2);
  });

  it("goes to the ends on Home and End", () => {
    expect(nextRadioIndex("Home", 2, 3)).toBe(0);
    expect(nextRadioIndex("End", 0, 3)).toBe(2);
  });

  it("leaves every other key alone, and an empty group", () => {
    expect(nextRadioIndex("Tab", 0, 3)).toBeNull();
    expect(nextRadioIndex("Enter", 0, 3)).toBeNull();
    expect(nextRadioIndex("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("radioTabStop", () => {
  it("is the checked option, or the first while nothing is checked", () => {
    expect(radioTabStop(["a", "b", "c"], "b")).toBe("b");
    expect(radioTabStop(["a", "b", "c"], null)).toBe("a");
    expect(radioTabStop(["a", "b", "c"], "gone")).toBe("a");
  });
});

const VALUES = ["one", "two", "three"] as const;

function Group() {
  const [selected, setSelected] = useState<string | null>(null);
  const { getRadioProps } = useRadioGroupKeys({
    values: VALUES,
    selected,
    onSelect: setSelected,
  });
  return createElement(
    "div",
    { role: "radiogroup", "aria-label": "Numbers" },
    VALUES.map((v) =>
      createElement(
        "button",
        {
          key: v,
          type: "button",
          role: "radio",
          "aria-checked": selected === v,
          ...getRadioProps(v),
          onClick: () => setSelected(v),
        },
        v,
      ),
    ),
  );
}

function radios() {
  return screen.getAllByRole("radio");
}

describe("useRadioGroupKeys", () => {
  it("makes the group a single tab stop", () => {
    render(createElement(Group));
    expect(radios().map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it("moves the tab stop to the checked option", () => {
    render(createElement(Group));
    fireEvent.click(radios()[2]);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
  });

  it("checks and focuses the option an arrow lands on", () => {
    render(createElement(Group));
    radios()[0].focus();
    fireEvent.keyDown(radios()[0], { key: "ArrowDown" });

    expect(radios()[1].getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radios()[1]);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("goes to the last option on End and the first on Home", () => {
    render(createElement(Group));
    fireEvent.keyDown(radios()[0], { key: "End" });
    expect(document.activeElement).toBe(radios()[2]);
    fireEvent.keyDown(radios()[2], { key: "Home" });
    expect(document.activeElement).toBe(radios()[0]);
    expect(radios()[0].getAttribute("aria-checked")).toBe("true");
  });

  it("leaves a modified arrow to the browser", () => {
    render(createElement(Group));
    fireEvent.keyDown(radios()[0], { key: "ArrowRight", altKey: true });
    expect(
      radios().every((r) => r.getAttribute("aria-checked") === "false"),
    ).toBe(true);
  });
});
