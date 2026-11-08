/**
 * The rail on /login and /signup promised "not a grade out of ten", and the
 * first result a new account sees carries a risk score out of ten and a letter
 * grade. The pitch can only promise what the product does.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/auth/auth-layout", () => ({
  AuthFooter: () => null,
  AuthWordmark: () => null,
}));
vi.mock("@/components/shared/response-readout", () => ({
  ResponseReadout: () => null,
}));

import { AuthSplitLayout } from "@/components/auth/auth-split-layout";

describe("AuthSplitLayout pitch", () => {
  const html = renderToStaticMarkup(
    React.createElement(AuthSplitLayout, null, "form"),
  );

  it("promises evidence, not the absence of a score", () => {
    const pitch = html.match(/<p class="text-3xl[^>]*>([\s\S]*?)<\/p>/);
    expect(pitch?.[1]).toMatchInlineSnapshot(
      `"Paste a URL. Get findings with evidence, not just a score."`,
    );
  });

  it("no longer says out of ten", () => {
    expect(html).not.toContain("out of ten");
  });
});
