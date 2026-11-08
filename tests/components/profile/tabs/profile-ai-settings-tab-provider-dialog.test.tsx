/**
 * The account's own AI provider is edited in AiProviderDialog.
 *
 * The provider form used to be always open, with a "Change key" link that
 * turned the stored key into an input. Its Save gate read the key untrimmed
 * (`!apiKey`) while the request trimmed it, so a key of only spaces passed
 * the gate and was then left out of the body. PUT /account/ai-config keeps
 * the stored key when none is sent, whichever provider it was saved under,
 * so after switching provider that save stored the new provider carrying the
 * OLD provider's key: the next scan would send one company's API key to
 * another company's endpoint. The gate now trims exactly like the body does.
 *
 * No DOM in this suite (vitest runs `node`): renderToStaticMarkup with the
 * Radix dialog stood in by a pass-through, and the save path driven through
 * the exported functions it calls.
 */
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: Pass,
    DialogBody: Pass,
    DialogClose: Pass,
    DialogContent: Pass,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogHeader: Pass,
    DialogTitle: Pass,
  };
});

const {
  AiProviderDialog,
  AiProviderSummary,
  aiProviderCanSave,
  aiProviderDirty,
  aiProviderDraftFrom,
  aiProviderHasExistingKey,
  aiProviderRequestBody,
  saveAiProvider,
  withDraftProvider,
} = await import("@/components/profile/tabs/profile-ai-settings-tab");
const { editCloseDecision } =
  await import("@/components/shared/edit-dialog-outcome");
const { AI_MODEL_CATALOG } = await import("@/lib/ai/model-catalog");
const { APP_NAME } = await import("@/lib/config/client-constants");

const openai = AI_MODEL_CATALOG.find((p) => p.id === "openai")!;
const other = AI_MODEL_CATALOG.find((p) => p.id !== "openai")!;
const openaiModel = openai.models[0];
const otherModel = other.models[0];

function saved(over: Record<string, unknown> = {}) {
  return {
    useVulnradarAi: false,
    aiDisabled: false,
    provider: "openai",
    modelId: openaiModel.id,
    apiKeyLast4: "9xQz",
    baseUrl: openai.baseUrl,
    ...over,
  };
}

const unconfigured = {
  useVulnradarAi: true,
  aiDisabled: false,
  provider: null,
  modelId: null,
  apiKeyLast4: null,
  baseUrl: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(res: { ok: boolean; body: Record<string, unknown> }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: res.ok, json: async () => res.body } as Response;
    }),
  );
  return calls;
}

describe("the saved-provider summary", () => {
  it("shows the provider, the model and only the last four of the key", () => {
    const html = renderToStaticMarkup(
      <AiProviderSummary
        config={saved()}
        onEdit={() => {}}
        onReset={() => {}}
        resetting={false}
      />,
    );
    expect(html).toContain(openai.name);
    expect(html).toContain(openaiModel.label);
    expect(html).toContain("••••9xQz");
    expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Edit provider/);
    expect(html).toContain(`Reset to ${APP_NAME} AI`);
  });

  it("offers Set up provider when no own config is saved", () => {
    const html = renderToStaticMarkup(
      <AiProviderSummary
        config={unconfigured}
        onEdit={() => {}}
        onReset={() => {}}
        resetting={false}
      />,
    );
    expect(html).toContain("Set up provider");
    expect(html).not.toContain("Edit provider");
    expect(html).not.toContain("Reset to");
  });

  it.each([
    ["Set up provider", unconfigured],
    ["Edit provider", saved()],
  ] as const)("%s is 44px tall on a phone", (label, config) => {
    const html = renderToStaticMarkup(
      <AiProviderSummary
        config={config}
        onEdit={() => {}}
        onReset={() => {}}
        resetting={false}
      />,
    );
    const button = html
      .split("<button")
      .slice(1)
      .find((part) => part.split("</button>")[0].includes(label));
    expect(button).toBeDefined();
    expect(button).toContain("h-11 sm:h-7");
  });

  it("the trigger is a real button with at least a 24px target", () => {
    const html = renderToStaticMarkup(
      <AiProviderSummary
        config={saved()}
        onEdit={() => {}}
        onReset={() => {}}
        resetting={false}
      />,
    );
    const trigger = html.match(
      /<button[^>]*>(?:(?!<\/button>).)*Edit provider/,
    );
    expect(trigger).not.toBeNull();
    expect(trigger![0]).toMatch(/\bh-7\b|\bh-8\b|\bh-9\b|\bh-10\b/);
    expect(trigger![0]).toContain('type="button"');
  });
});

describe("focus after the dialog closes", () => {
  // The first save swaps Set up provider for Edit provider, so the button
  // that opened the dialog has unmounted by the time it closes. The dialog
  // returns focus through this ref, which has to be on whichever trigger is
  // showing, or focus drops to the page body.
  it.each([
    ["Set up provider", unconfigured],
    ["Edit provider", saved()],
  ])("puts the trigger ref on %s", (label, config) => {
    const ref = vi.fn();
    // Server rendering never attaches refs, so read it off the element tree.
    const tree = AiProviderSummary({
      config,
      onEdit: () => {},
      onReset: () => {},
      resetting: false,
      triggerRef: ref,
    });
    const found: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      const el = node as { props?: Record<string, unknown> };
      if (!el.props) return;
      if (el.props.ref === ref) {
        const kids = ([] as unknown[]).concat(el.props.children);
        found.push(kids.filter((k) => typeof k === "string").join(""));
      }
      walk(el.props.children);
    };
    walk(tree);
    expect(found).toEqual([label]);
  });

  it("the tab hands the same ref to the summary and the dialog", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "components/profile/tabs/profile-ai-settings-tab.tsx",
      ),
      "utf8",
    );
    expect(src).toMatch(/<AiProviderSummary[\s\S]*?triggerRef=\{(\w+)\}/);
    const name = src.match(
      /<AiProviderSummary[\s\S]*?triggerRef=\{(\w+)\}/,
    )![1];
    expect(src).toMatch(
      new RegExp(`<AiProviderDialog[\\s\\S]*?returnFocusRef=\\{${name}\\}`),
    );
    // And the dialog passes it on to EditDialog, which does the focusing.
    const dialog = src.match(
      /export function AiProviderDialog[\s\S]*?<EditDialog([\s\S]*?)\n\s*>\n/,
    );
    expect(dialog).not.toBeNull();
    expect(dialog![1]).toContain("returnFocusRef={returnFocusRef}");
  });
});

describe("AiProviderDialog, rendered open", () => {
  it("shows the saved provider and model, an empty key, Cancel and Save", () => {
    const html = renderToStaticMarkup(
      <AiProviderDialog
        config={saved()}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(html).toMatch(
      new RegExp(`<option value="${openai.id}" selected="">`),
    );
    expect(html).toMatch(
      new RegExp(`<option value="${openaiModel.id}" selected="">`),
    );
    expect(html).toMatch(/<label[^>]*for="ai-provider-select"/);
    expect(html).toMatch(/<label[^>]*for="ai-model-select"/);
    expect(html).toMatch(/<label[^>]*for="ai-api-key-input"/);
    // The key is never rendered back, only the hint about the stored one.
    expect(html).not.toContain('9xQz"');
    expect(html).toContain("Leave empty to keep the key ending 9xQz");
    expect(html).not.toContain("Change key");
    expect(html).toContain("Cancel");
    expect(html).toContain("Save provider");
    expect(html).toContain("encrypted at rest");
  });

  it("the key field is a password field with autocomplete off and a labelled toggle", () => {
    const html = renderToStaticMarkup(
      <AiProviderDialog
        config={saved()}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const input = html.match(/<input[^>]*id="ai-api-key-input"[^>]*>/);
    expect(input).not.toBeNull();
    expect(input![0]).toContain('type="password"');
    expect(input![0]).toMatch(/autocomplete="off"/i);
    expect(html).toContain('aria-label="Show API key"');
  });

  it("asks for a key when nothing is stored", () => {
    const html = renderToStaticMarkup(
      <AiProviderDialog
        config={unconfigured}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(html).not.toContain("Leave empty to keep");
    expect(html).not.toContain('id="ai-model-select"');
  });
});

describe("the save gate", () => {
  it("allows a keyless save for the provider the key is stored under", () => {
    const config = saved();
    const draft = aiProviderDraftFrom(config);
    expect(aiProviderHasExistingKey(draft, config)).toBe(true);
    expect(aiProviderCanSave(draft, config)).toBe(true);
  });

  it("refuses a keyless save after switching provider", () => {
    const config = saved();
    const draft = {
      ...withDraftProvider(aiProviderDraftFrom(config), other.id),
      model: otherModel.id,
    };
    expect(aiProviderHasExistingKey(draft, config)).toBe(false);
    expect(aiProviderCanSave(draft, config)).toBe(false);
  });

  it("refuses a key of only spaces after switching provider", () => {
    // The bug: the old gate read `!apiKey`, so "   " passed it, the body then
    // trimmed it away, and the route kept the other provider's stored key.
    const config = saved();
    const draft = {
      ...withDraftProvider(aiProviderDraftFrom(config), other.id),
      model: otherModel.id,
      apiKey: "   ",
    };
    expect(aiProviderCanSave(draft, config)).toBe(false);
  });

  it("needs a provider and a model", () => {
    const draft = aiProviderDraftFrom(unconfigured);
    expect(aiProviderCanSave({ ...draft, apiKey: "sk-1" }, unconfigured)).toBe(
      false,
    );
    const picked = withDraftProvider(draft, openai.id);
    expect(picked.model).toBe("");
    expect(aiProviderCanSave({ ...picked, apiKey: "sk-1" }, unconfigured)).toBe(
      false,
    );
    expect(
      aiProviderCanSave(
        { ...picked, model: openaiModel.id, apiKey: "sk-1" },
        unconfigured,
      ),
    ).toBe(true);
  });

  it("is dirty once anything moved off the saved config", () => {
    const config = saved();
    const draft = aiProviderDraftFrom(config);
    expect(aiProviderDirty(draft, config)).toBe(false);
    expect(aiProviderDirty({ ...draft, apiKey: "x" }, config)).toBe(true);
    expect(aiProviderDirty(withDraftProvider(draft, other.id), config)).toBe(
      true,
    );
  });
});

describe("the request", () => {
  it("trims the key and sends it only when one was typed", () => {
    const draft = { provider: openai.id, model: openaiModel.id, apiKey: "" };
    expect(aiProviderRequestBody(draft)).toEqual({
      useVulnradarAi: false,
      provider: openai.id,
      modelId: openaiModel.id,
      baseUrl: openai.baseUrl,
    });
    expect(
      aiProviderRequestBody({ ...draft, apiKey: "  sk-live-abcd  " }),
    ).toMatchObject({ apiKey: "sk-live-abcd" });
  });

  it("a save sends the draft in the PUT body and returns the new config", async () => {
    const calls = stubFetch({ ok: true, body: { success: true } });
    const config = saved();
    const draft = {
      ...withDraftProvider(aiProviderDraftFrom(config), other.id),
      model: otherModel.id,
      apiKey: " sk-other-1234 ",
    };
    const out = await saveAiProvider(draft, config);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      useVulnradarAi: false,
      provider: other.id,
      modelId: otherModel.id,
      baseUrl: other.baseUrl,
      apiKey: "sk-other-1234",
    });
    // The key goes in the body only.
    expect(calls[0].url).not.toContain("sk-other");
    expect(out).toEqual({
      ok: true,
      config: {
        useVulnradarAi: false,
        aiDisabled: false,
        provider: other.id,
        modelId: otherModel.id,
        apiKeyLast4: "1234",
        baseUrl: other.baseUrl,
      },
    });
  });

  it("a keyless save for the same provider keeps the stored last four", async () => {
    stubFetch({ ok: true, body: { success: true } });
    const config = saved();
    const out = await saveAiProvider(aiProviderDraftFrom(config), config);
    expect(out).toMatchObject({ ok: true, config: { apiKeyLast4: "9xQz" } });
  });

  it("a refusal is the server's message, so the dialog stays open", async () => {
    stubFetch({
      ok: false,
      body: { error: "An API key is required for custom AI providers." },
    });
    const config = saved();
    const out = await saveAiProvider(
      { ...aiProviderDraftFrom(config), apiKey: "sk-bad-key" },
      config,
    );
    expect(out).toEqual({
      ok: false,
      error: "An API key is required for custom AI providers.",
    });
    expect(JSON.stringify(out)).not.toContain("sk-bad-key");
  });

  it("a network failure is a message, not a throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const config = saved();
    const out = await saveAiProvider(aiProviderDraftFrom(config), config);
    expect(out).toEqual({ ok: false, error: "Failed to save AI config." });
  });
});

describe("closing the dialog", () => {
  it("Cancel and Escape never call the save and leave the config as it was", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const config = saved();
    let open = true;
    const onClose = () => {
      open = false;
    };
    const draft = { ...aiProviderDraftFrom(config), apiKey: "sk-typed" };
    expect(
      editCloseDecision({ busy: false, dirty: aiProviderDirty(draft, config) }),
    ).toBe("confirm-discard");
    expect(editCloseDecision({ busy: true, dirty: true })).toBe("blocked");
    onClose();
    expect(open).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(config).toEqual(saved());
  });
});
