// @vitest-environment jsdom
/**
 * Linking a sign-in provider adds a permanent way into the account, so it asks
 * for the current password first. A navigation cannot carry a password, so the
 * Social tab POSTs it to the start route and goes where the route says.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  ProviderReauthDialog,
  ProviderReauthFields,
  requestProviderStart,
} from "@/components/profile/tabs/provider-reauth-dialog";

const START = "/api/v3/auth/oauth/github?action=link";
const mockFetch = vi.fn();

function reply(body: unknown, statusCode = 200) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  // jsdom reports window.location assignment as "not implemented".
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProviderReauthFields", () => {
  const props = {
    label: "GitHub",
    password: "",
    onPasswordChange: () => undefined,
    error: null,
  };

  it("has a password input when the account has a password", () => {
    const html = renderToStaticMarkup(
      <ProviderReauthFields {...props} hasPassword />,
    );
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
  });

  it("has none when the account has no password", () => {
    const html = renderToStaticMarkup(
      <ProviderReauthFields {...props} hasPassword={false} />,
    );
    expect(html).not.toContain("<input");
  });

  it("shows the route's refusal", () => {
    const html = renderToStaticMarkup(
      <ProviderReauthFields
        {...props}
        hasPassword
        error="Password is incorrect."
      />,
    );
    expect(html).toContain("Password is incorrect.");
  });
});

describe("requestProviderStart", () => {
  it("posts the password exactly as typed and returns the url", async () => {
    mockFetch.mockResolvedValueOnce(
      reply({ url: "https://github.com/login/oauth/authorize?x=1" }),
    );

    const result = await requestProviderStart(START, true, "  spaced pw ");

    expect(result).toEqual({
      url: "https://github.com/login/oauth/authorize?x=1",
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(START);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ password: "  spaced pw " });
  });

  it("sends no password for a password-less account", async () => {
    mockFetch.mockResolvedValueOnce(reply({ url: "https://x.example/a" }));

    await requestProviderStart(START, false, "");

    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({});
  });

  it("carries the route's message on a refusal", async () => {
    mockFetch.mockResolvedValueOnce(
      reply({ error: "Password is incorrect." }, 403),
    );

    expect(await requestProviderStart(START, true, "x")).toEqual({
      error: "Password is incorrect.",
    });
  });

  it("will not navigate to anything but an https url", async () => {
    mockFetch.mockResolvedValueOnce(reply({ url: "javascript:alert(1)" }));

    const result = await requestProviderStart(START, true, "x");

    expect(result).toHaveProperty("error");
  });

  it("has an answer for a non-JSON reply and for no reply", async () => {
    mockFetch.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect(await requestProviderStart(START, true, "x")).toHaveProperty(
      "error",
    );

    mockFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await requestProviderStart(START, true, "x")).toHaveProperty(
      "error",
    );
  });
});

describe("ProviderReauthDialog", () => {
  it("keeps the dialog open with the message on a 403", async () => {
    mockFetch.mockResolvedValueOnce(
      reply({ error: "Password is incorrect." }, 403),
    );
    const onStarted = vi.fn();
    const onClose = vi.fn();

    render(
      <ProviderReauthDialog
        label="GitHub"
        startUrl={START}
        hasPassword
        onStarted={onStarted}
        onClose={onClose}
      />,
    );
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Password is incorrect.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onStarted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("will not submit an empty password", () => {
    render(
      <ProviderReauthDialog
        label="GitHub"
        startUrl={START}
        hasPassword
        onClose={() => undefined}
      />,
    );

    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("calls onStarted before it navigates", async () => {
    mockFetch.mockResolvedValueOnce(reply({ url: "https://github.com/a" }));
    const onStarted = vi.fn();

    render(
      <ProviderReauthDialog
        label="GitHub"
        startUrl={START}
        hasPassword={false}
        onStarted={onStarted}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
  });

  it("Cancel closes it", () => {
    const onClose = vi.fn();

    render(
      <ProviderReauthDialog
        label="Discord"
        startUrl={START}
        hasPassword
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
  });
});
