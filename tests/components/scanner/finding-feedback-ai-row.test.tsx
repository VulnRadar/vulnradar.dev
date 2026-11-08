// @vitest-environment jsdom
/**
 * "Mark this result" against a row the AI verifier wrote.
 *
 * Human-only suppression made that row stop hiding anything, and the control
 * went on drawing it as the user's own verdict: "False positive" pressed over a
 * finding that was still visible, still scored and still failing the CI gate,
 * with nothing to say that only a click of that already-pressed button would
 * make it count.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../../_helpers/dom";
import { FindingFeedback } from "@/components/scanner/issue-detail";
import { API } from "@/lib/config/client-constants";
import { AI_FEEDBACK_NOTE } from "@/lib/scanner/feedback-source";

const FALSE_POSITIVE_LINE =
  "AI verification suggested false positive. Mark it yourself to hide it.";

const fetchMock =
  vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function storedRow(verdict: string, notes: string | null) {
  fetchMock.mockResolvedValueOnce(
    json({ feedback: [{ finding_id: "f1", verdict, notes }] }),
  );
}

async function show() {
  const result = render(
    <FindingFeedback findingId="f1" findingUrl="https://example.com/" />,
  );
  await screen.findByRole("button", { name: "False positive" });
  return result;
}

const button = (name: string) => screen.getByRole("button", { name });

const pressedButtons = () =>
  screen
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.textContent);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FindingFeedback with an AI-written row", () => {
  it("presses nothing and says what the AI suggested", async () => {
    storedRow("false_positive", AI_FEEDBACK_NOTE);
    await show();

    expect(pressedButtons()).toEqual([]);
    expect(button("False positive").getAttribute("aria-pressed")).toBe("false");
    expect(button("False positive").className).not.toContain("bg-primary/10");
    expect(screen.getByText(FALSE_POSITIVE_LINE)).toBeTruthy();
  });

  it("treats an AI confirmation the same way", async () => {
    storedRow("confirmed", AI_FEEDBACK_NOTE);
    await show();

    expect(pressedButtons()).toEqual([]);
    expect(
      screen.getByText(/^AI verification suggested confirmed\./),
    ).toBeTruthy();
  });

  it("makes the verdict the person's when they click the suggested button", async () => {
    storedRow("false_positive", AI_FEEDBACK_NOTE);
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    const onVerdictChanged = vi.fn();
    render(
      <FindingFeedback
        findingId="f1"
        findingUrl="https://example.com/"
        scanHistoryId={7}
        onVerdictChanged={onVerdictChanged}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "False positive" }),
    );

    await waitFor(() => expect(pressedButtons()).toEqual(["False positive"]));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(API.SCAN_FEEDBACK);
    expect(JSON.parse(String(init?.body))).toEqual({
      findingId: "f1",
      findingUrl: "https://example.com/",
      scanHistoryId: 7,
      verdict: "false_positive",
    });
    expect(screen.queryByText(FALSE_POSITIVE_LINE)).toBeNull();
    expect(onVerdictChanged).toHaveBeenCalledOnce();
  });

  it("keeps the suggestion when the save fails", async () => {
    storedRow("false_positive", AI_FEEDBACK_NOTE);
    fetchMock.mockResolvedValueOnce(json({ error: "nope" }, 500));
    await show();

    fireEvent.click(button("False positive"));

    await screen.findByText("Couldn't save that, try again.");
    expect(pressedButtons()).toEqual([]);
    expect(screen.getByText(FALSE_POSITIVE_LINE)).toBeTruthy();
  });
});

describe("FindingFeedback with a person's row", () => {
  it.each([
    ["no note", null],
    ["their own note", "Staging only, not reachable."],
  ])("presses the stored verdict with %s", async (_label, notes) => {
    storedRow("false_positive", notes);
    await show();

    expect(pressedButtons()).toEqual(["False positive"]);
    expect(screen.queryByText(/^AI verification suggested/)).toBeNull();
  });
});
