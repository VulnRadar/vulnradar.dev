// @vitest-environment jsdom
/**
 * The contact category picker is a role="radio" group, and now behaves like
 * one from the keyboard. Every option used to be its own tab stop, so a
 * keyboard user tabbed through all nine categories to reach the form, and the
 * arrows a screen reader announces for a radio group did nothing.
 */
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContactCategorySelector } from "@/components/contact/contact-category-selector";
import { CATEGORIES } from "@/components/contact/contact-types";

afterEach(cleanup);

function Picker({ initial = null }: { initial?: string | null }) {
  const [selected, setSelected] = useState<string | null>(initial);
  return <ContactCategorySelector selected={selected} onSelect={setSelected} />;
}

function radios() {
  return screen.getAllByRole("radio");
}

describe("ContactCategorySelector keyboard", () => {
  it("offers every category, and only one of them is a tab stop", () => {
    render(<Picker />);
    expect(radios()).toHaveLength(CATEGORIES.length);
    expect(radios().filter((r) => r.tabIndex === 0)).toHaveLength(1);
    // Nothing checked yet: the tab stop is the first option on the page.
    expect(radios()[0].tabIndex).toBe(0);
  });

  it("puts the tab stop on the checked category", () => {
    render(<Picker initial="security" />);
    const checked = radios().find(
      (r) => r.getAttribute("aria-checked") === "true",
    );
    expect(checked?.tabIndex).toBe(0);
    expect(radios().filter((r) => r.tabIndex === 0)).toHaveLength(1);
  });

  it("walks the options in page order with the arrows, checking each", () => {
    render(<Picker />);
    const options = radios();
    options[0].focus();

    fireEvent.keyDown(options[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(options[1]);
    expect(options[1].getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(options[1], { key: "ArrowUp" });
    expect(document.activeElement).toBe(options[0]);
  });

  it("goes to the ends with Home and End", () => {
    render(<Picker />);
    const options = radios();
    fireEvent.keyDown(options[0], { key: "End" });
    expect(document.activeElement).toBe(options[options.length - 1]);
    fireEvent.keyDown(options[options.length - 1], { key: "Home" });
    expect(document.activeElement).toBe(options[0]);
  });
});
