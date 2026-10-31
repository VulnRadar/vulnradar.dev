/**
 * The hooks (lib/i18n/hooks.ts) and their server-component equivalents
 * (lib/i18n/server.ts).
 *
 * The suite runs under `node` with no DOM, so the hooks are exercised the way
 * React runs them on the server: rendered through NextIntlClientProvider with
 * react-dom/server, which is a real provider and a real render, not a stub.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { CATALOG } from "@/lib/i18n/messages/catalog";
import { createFormatters } from "@/lib/i18n/format";
import { useFormatters, useSeverityLabel } from "@/lib/i18n/hooks";
import { SEVERITY_LABEL_KEYS } from "@/lib/i18n/severity";
import { SEVERITY_ORDER } from "@/lib/config/client-constants";

const server = vi.hoisted(() => ({ locale: "en" }));

vi.mock("next-intl/server", async () => {
  const { createTranslator: create } = await import("next-intl");
  const { getMessages: load } = await import("@/lib/i18n/messages");
  return {
    getLocale: async () => server.locale,
    getTranslations: async (namespace: string) =>
      create({
        locale: server.locale,
        messages: await load(server.locale as Locale),
        namespace: namespace as "result",
      }),
  };
});

async function renderIn<T>(locale: Locale, use: () => T): Promise<T> {
  let captured: T | undefined;
  function Probe() {
    captured = use();
    return null;
  }
  // The cast is for `children`, which createElement takes as its third
  // argument and the provider's props type wants named.
  const props = {
    locale,
    messages: await getMessages(locale),
    // Only so next-intl does not log its once-per-process warning.
    timeZone: "UTC",
  } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  renderToString(
    createElement(NextIntlClientProvider, props, createElement(Probe)),
  );
  return captured as T;
}

const WHEN = new Date("2026-09-16T08:07:09Z");
const result = (locale: Locale) =>
  CATALOG[locale].result as Record<string, string>;

describe("useFormatters", () => {
  it("formats in the language of the provider it is under", async () => {
    const fmt = await renderIn("ja", () => useFormatters({ timeZone: "UTC" }));
    expect(fmt.locale).toBe("ja");
    expect(fmt.date(WHEN)).toBe("2026年9月16日");
    const en = await renderIn("en", () => useFormatters({ timeZone: "UTC" }));
    expect(en.date(WHEN)).toBe("Sep 16, 2026");
  });

  it("hands back the same object on every render, so it can be a dependency", async () => {
    const first = await renderIn("de", () => useFormatters());
    const second = await renderIn("de", () => useFormatters());
    expect(first).toBe(second);
    expect(first).toBe(createFormatters("de"));
  });

  it("passes the zone through", async () => {
    const fmt = await renderIn("en", () =>
      useFormatters({ timeZone: "Asia/Tokyo" }),
    );
    expect(fmt.date("2026-09-16T20:00:00Z")).toBe("Sep 17, 2026");
  });
});

describe("useSeverityLabel", () => {
  it.each(LOCALES)("gives the %s word for each severity", async (locale) => {
    const label = await renderIn(locale, () => useSeverityLabel());
    for (const severity of SEVERITY_ORDER) {
      expect(label(severity)).toBe(
        result(locale)[SEVERITY_LABEL_KEYS[severity]],
      );
    }
  });

  it("is Japanese words for a Japanese reader, not the stored value", async () => {
    const label = await renderIn("ja", () => useSeverityLabel());
    expect(label("high")).not.toBe("high");
    expect(label("high")).not.toBe("High");
  });
});

describe("the server equivalents", () => {
  it("getFormatters formats in this request's language", async () => {
    const { getFormatters } = await import("@/lib/i18n/server");
    server.locale = "ja";
    const fmt = await getFormatters({ timeZone: "UTC" });
    expect(fmt.date(WHEN)).toBe("2026年9月16日");
    server.locale = "en";
    expect((await getFormatters({ timeZone: "UTC" })).date(WHEN)).toBe(
      "Sep 16, 2026",
    );
  });

  it("getSeverityLabel speaks this request's language", async () => {
    const { getSeverityLabel } = await import("@/lib/i18n/server");
    for (const locale of LOCALES) {
      server.locale = locale;
      const label = await getSeverityLabel();
      expect(label("critical")).toBe(result(locale).severityCritical);
    }
  });

  it("matches what createTranslator gives a mail for the same words", async () => {
    // The three routes to a severity word (hook, server component, no request)
    // are one function over three translators; this pins that they agree.
    const t = createTranslator({
      locale: "de",
      messages: await getMessages("de"),
      namespace: "result",
    });
    const { getSeverityLabel } = await import("@/lib/i18n/server");
    server.locale = "de";
    expect((await getSeverityLabel())("medium")).toBe(t("severityMedium"));
  });
});
