// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "../../_helpers/dom";
import { API } from "@/lib/config/client-constants";
import AdminPage from "@/app/admin/page";
import { ProfileDeveloperTab } from "@/components/profile/tabs/profile-developer-tab";
import { ShareTicketDialog } from "@/components/contact/support-tickets";

/**
 * The save handlers behind three EditDialogs, run through the code that owns
 * them. Under node they could only be read as source text or split into pure
 * helpers, which says nothing about what the real page sends or what it hands
 * back to the dialog.
 *
 * The two large parents are rendered whole with only the panel that receives
 * the handler replaced: that panel's own dialog already has its own suite, and
 * what is unproved is the handler the parent passes down.
 */
type RenameResult = { ok: boolean; error?: string };

const captured = vi.hoisted(() => ({
  teams: null as null | {
    handleTeamRename: (id: number, name: string) => Promise<RenameResult>;
  },
  webhooks: null as null | {
    webhooks: Array<{ id: number; name: string; url: string }>;
    onSaveWebhookEdit: (
      id: number,
      draft: { name: string; url: string },
    ) => Promise<string | null>;
  },
}));

vi.mock("@/components/admin/teams", () => ({
  TeamsList: (props: NonNullable<typeof captured.teams>) => {
    captured.teams = props;
    return <div>teams panel</div>;
  },
}));

vi.mock("@/components/profile/tabs/developer/webhooks-section", () => ({
  WebhooksSection: (props: NonNullable<typeof captured.webhooks>) => {
    captured.webhooks = props;
    return <div>webhooks panel</div>;
  },
}));

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({
    me: { userId: 1, role: "admin", plan: "free" },
    isStaff: true,
    isLoading: false,
  }),
}));

// Every surface on: which sections a deployment has is not under test here.
vi.mock("@/lib/hooks/use-client-config", () => ({
  useClientConfig: () =>
    new Proxy({ loaded: true } as Record<string, unknown>, {
      get: (target, key: string) => (key in target ? target[key] : true),
    }),
}));

vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl")>()),
  useTranslations: () => (key: string) => key,
}));

// The site header and its nav: page chrome that needs a router.
vi.mock("@/components/shared/app-page-shell", () => ({
  AppPageShell: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/shared/turnstile-widget", () => ({
  TurnstileWidget: () => null,
}));

/** One macrotask, so the fetches a parent starts on mount can answer. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Handler = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn>;

function route(handler: Handler) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", fetchMock);
}

const calls = (method: string, prefix: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) =>
      ((init as RequestInit | undefined)?.method ?? "GET") === method &&
      String(url).startsWith(prefix),
  );

const sentBody = (call: unknown[]) =>
  JSON.parse((call[1] as RequestInit).body as string);

beforeEach(() => {
  captured.teams = null;
  captured.webhooks = null;
});

afterEach(() => {
  // First: url-state listens to history, so a mounted page reacts to the reset.
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

// A longer budget than vitest's default five seconds, or the wait for the
// lazily loaded panel below would be cut off before its own timeout.
describe("the admin panel's handleTeamRename", { timeout: 15_000 }, () => {
  const TEAMS_URL = `${API.ADMIN}/teams`;

  /** `rename` answers the PATCH; everything else is an empty, healthy panel. */
  async function mount(rename: () => Response | Promise<Response>) {
    route((url, init) => {
      if (init?.method === "PATCH" && url === TEAMS_URL) return rename();
      if (url.startsWith(`${TEAMS_URL}?`)) {
        return json({ teams: [], page: 1, totalPages: 1 });
      }
      return json({
        users: [],
        page: 1,
        totalPages: 1,
        callerRole: "admin",
        logs: [],
      });
    });
    window.history.replaceState(null, "", "/admin?tab=teams");
    await act(async () => {
      render(<AdminPage />);
      await settle();
    });
    await waitFor(() => expect(captured.teams).not.toBeNull(), {
      timeout: 10_000,
    });
    return captured.teams as NonNullable<typeof captured.teams>;
  }

  async function renameTo(
    teams: NonNullable<typeof captured.teams>,
  ): Promise<RenameResult> {
    let out!: RenameResult;
    await act(async () => {
      out = await teams.handleTeamRename(5, "Acme Labs");
    });
    return out;
  }

  it("sends the id and the name, reports ok and refreshes the list", async () => {
    const teams = await mount(() => json({ success: true }));
    const listLoadsBefore = calls("GET", `${TEAMS_URL}?`).length;

    await expect(renameTo(teams)).resolves.toEqual({ ok: true });

    const [patch] = calls("PATCH", TEAMS_URL);
    expect(sentBody(patch)).toEqual({ teamId: 5, name: "Acme Labs" });
    expect(calls("GET", `${TEAMS_URL}?`).length).toBe(listLoadsBefore + 1);
  });

  it("hands the server's refusal back without refreshing", async () => {
    const teams = await mount(() => json({ error: "Name is taken." }, 409));
    const listLoadsBefore = calls("GET", `${TEAMS_URL}?`).length;

    await expect(renameTo(teams)).resolves.toEqual({
      ok: false,
      error: "Name is taken.",
    });
    expect(calls("GET", `${TEAMS_URL}?`).length).toBe(listLoadsBefore);
  });

  it("falls back to its own line when the refusal has no reason", async () => {
    const teams = await mount(() => json({}, 500));
    await expect(renameTo(teams)).resolves.toEqual({
      ok: false,
      error: "Failed to rename team",
    });
  });

  it("reports a dropped connection as a failure instead of throwing", async () => {
    const teams = await mount(() => {
      throw new Error("offline");
    });
    await expect(renameTo(teams)).resolves.toEqual({
      ok: false,
      error: "Failed to rename team",
    });
  });
});

describe("the developer tab's handleSaveWebhookEdit", () => {
  const HOOK = { id: 7, name: "Deploys", url: "https://hooks.example/a" };

  async function mount(save: () => Response | Promise<Response>) {
    const setSuccess = vi.fn();
    route((url, init) =>
      init?.method === "PATCH" && url === `${API.WEBHOOKS}/7`
        ? save()
        : json({}),
    );
    window.history.replaceState(null, "", "/profile?dtab=webhooks");
    const props = {
      setError: vi.fn(),
      setSuccess,
      loading: false,
      preloadedApiKeys: [],
      preloadedSchedules: [],
    };
    function Page() {
      return (
        <ProfileDeveloperTab
          {...(props as unknown as Parameters<typeof ProfileDeveloperTab>[0])}
        />
      );
    }
    await act(async () => {
      render(<Page />);
      await settle();
    });
    await waitFor(() => expect(captured.webhooks).not.toBeNull());
    return { setSuccess };
  }

  async function saveEdit(draft: { name: string; url: string }) {
    let out!: string | null;
    await act(async () => {
      out = await (
        captured.webhooks as NonNullable<typeof captured.webhooks>
      ).onSaveWebhookEdit(HOOK.id, draft);
    });
    return out;
  }

  it("sends the name and the URL with the type left to detection", async () => {
    const { setSuccess } = await mount(() => json({ name: "Renamed" }));
    await expect(
      saveEdit({ name: "Renamed", url: "https://hooks.example/b" }),
    ).resolves.toBeNull();

    const [patch] = calls("PATCH", `${API.WEBHOOKS}/7`);
    expect((patch[1] as RequestInit).headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(sentBody(patch)).toEqual({
      name: "Renamed",
      url: "https://hooks.example/b",
      type: "auto",
    });
    expect(setSuccess).toHaveBeenCalledWith("Webhook updated.");
  });

  it("sends Default for a blank name", async () => {
    await mount(() => json({}));
    await saveEdit({ name: "", url: HOOK.url });
    expect(sentBody(calls("PATCH", `${API.WEBHOOKS}/7`)[0]).name).toBe(
      "Default",
    );
  });

  it("returns the server's refusal for the dialog to show", async () => {
    const { setSuccess } = await mount(() =>
      json({ error: "That URL is not allowed." }, 400),
    );
    await expect(saveEdit({ name: "A", url: "http://x" })).resolves.toBe(
      "That URL is not allowed.",
    );
    expect(setSuccess).not.toHaveBeenCalled();
  });

  it("falls back to its own line when the refusal has no reason", async () => {
    await mount(() => json({}, 500));
    await expect(saveEdit({ name: "A", url: "http://x" })).resolves.toBe(
      "Failed to update webhook.",
    );
  });

  it("returns a failure for a dropped connection instead of throwing", async () => {
    await mount(() => {
      throw new Error("offline");
    });
    await expect(saveEdit({ name: "A", url: "http://x" })).resolves.toBe(
      "Failed to update webhook.",
    );
  });
});

describe("ShareTicketDialog's save", () => {
  const SHARES_URL = API.SUPPORT_TICKET_SHARES(5);
  const ALICE = { userId: 1, email: "alice@example.com", name: "Alice" };
  const BOB = { userId: 2, email: "bob@example.com", name: "Bob" };
  const CAROL = { userId: 3, email: "carol@example.com", name: null };

  const button = (name: string) =>
    screen.getByRole("button", { name }) as HTMLButtonElement;
  const removeAlice = "Remove Alice (alice@example.com)";
  const addBob = "Add Bob (bob@example.com)";
  const addCarol = "Add carol@example.com";

  type Op = (url: string, init: RequestInit) => Response;

  async function mount(
    op: Op = () => json({ success: true }),
    lists: () => Response = () =>
      json({ shares: [ALICE], eligible: [BOB, CAROL] }),
  ) {
    const onClose = vi.fn();
    route((url, init) => (init?.method ? op(url, init) : lists()));
    render(<ShareTicketDialog ticketId={5} onClose={onClose} />);
    await screen.findByRole("button", { name: removeAlice });
    return { onClose };
  }

  async function save() {
    await act(async () => {
      fireEvent.click(button("Save sharing"));
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("holds Save closed until something is staged", async () => {
    await mount();
    expect(button("Save sharing").disabled).toBe(true);
    fireEvent.click(button(addBob));
    expect(button("Save sharing").disabled).toBe(false);
    fireEvent.click(button(addBob));
    expect(button("Save sharing").disabled).toBe(true);
  });

  it("sends nothing until Save, then adds before it removes and closes", async () => {
    const { onClose } = await mount();
    fireEvent.click(button(removeAlice));
    fireEvent.click(button(addBob));
    expect(calls("POST", SHARES_URL)).toHaveLength(0);
    expect(calls("DELETE", SHARES_URL)).toHaveLength(0);

    await save();

    const sent = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method,
    );
    expect(sent.map(([, init]) => (init as RequestInit).method)).toEqual([
      "POST",
      "DELETE",
    ]);
    expect(sent[0][0]).toBe(SHARES_URL);
    expect(sentBody(sent[0])).toEqual({ userId: 2 });
    expect(sent[1][0]).toBe(`${SHARES_URL}?userId=1`);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open and says what went through when a later step fails", async () => {
    const { onClose } = await mount((_url, init) =>
      init.method === "DELETE"
        ? json({ error: "Not allowed" }, 403)
        : json({ success: true }),
    );
    fireEvent.click(button(removeAlice));
    fireEvent.click(button(addBob));
    const loadsBefore = calls("GET", SHARES_URL).length;

    await save();

    expect(onClose).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toContain("Shared with Bob (bob@example.com).");
    expect(alert).toContain(
      "Could not remove Alice (alice@example.com): Not allowed.",
    );
    await waitFor(() =>
      expect(calls("GET", SHARES_URL).length).toBe(loadsBefore + 1),
    );
  });

  it("keeps only what did not go through staged for the retry", async () => {
    let refuse = true;
    await mount((_url, init) =>
      init.method === "DELETE" && refuse
        ? json({ error: "Not allowed" }, 403)
        : json({ success: true }),
    );
    fireEvent.click(button(removeAlice));
    fireEvent.click(button(addBob));
    await save();
    await waitFor(() =>
      expect(button(removeAlice).getAttribute("aria-pressed")).toBe("true"),
    );
    expect(button(addBob).getAttribute("aria-pressed")).toBe("false");

    refuse = false;
    fetchMock.mockClear();
    await save();
    const sent = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method,
    );
    expect(sent).toHaveLength(1);
    expect((sent[0][1] as RequestInit).method).toBe("DELETE");
  });

  it("stops at the first failure and counts what it did not try", async () => {
    await mount((_url, init) =>
      init.method === "POST"
        ? json({ error: "Seat limit reached" }, 403)
        : json({ success: true }),
    );
    fireEvent.click(button(addBob));
    fireEvent.click(button(addCarol));
    fireEvent.click(button(removeAlice));

    await save();

    expect(calls("POST", SHARES_URL)).toHaveLength(1);
    expect(calls("DELETE", SHARES_URL)).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toContain(
      "Could not share with Bob (bob@example.com): Seat limit reached. 2 other changes were not tried.",
    );
  });

  it("offers a retry when the lists do not load, with Save still closed", async () => {
    const onClose = vi.fn();
    let healthy = false;
    route(() =>
      healthy ? json({ shares: [ALICE], eligible: [] }) : json({}, 500),
    );
    render(<ShareTicketDialog ticketId={5} onClose={onClose} />);
    await screen.findByText("Could not load sharing.");
    expect(button("Save sharing").disabled).toBe(true);

    healthy = true;
    fireEvent.click(button("Try again"));
    await screen.findByRole("button", { name: removeAlice });
  });

  it("asks before throwing away staged changes", async () => {
    const { onClose } = await mount();
    fireEvent.click(button(addBob));
    fireEvent.click(button("Cancel"));
    expect(
      screen.getByRole("alertdialog", { name: "Discard your changes?" }),
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
