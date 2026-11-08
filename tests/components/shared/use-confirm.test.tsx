// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import "../../_helpers/dom";
import {
  useConfirm,
  type ConfirmRequest,
} from "@/components/shared/use-confirm";

const GENERIC = "That did not go through. Try again.";

function request(overrides: Partial<ConfirmRequest> = {}): ConfirmRequest {
  return {
    title: "Delete this scan?",
    description: "It cannot be restored.",
    confirmLabel: "Delete scan",
    onConfirm: () => undefined,
    ...overrides,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useConfirm state", () => {
  type Hook = { current: ReturnType<typeof useConfirm> };

  const dialogProps = (result: Hook) =>
    (
      result.current.confirmDialog as React.ReactElement<{
        busy: boolean;
        error: string | null;
        onConfirm: () => Promise<void>;
        onCancel: () => void;
      }>
    ).props;

  async function run(result: Hook) {
    await act(async () => {
      await dialogProps(result).onConfirm();
    });
  }

  function opened(overrides: Partial<ConfirmRequest> = {}) {
    const hook = renderHook(() => useConfirm());
    act(() => hook.result.current.confirm(request(overrides)));
    return hook;
  }

  it("renders nothing until something asks", () => {
    const { result } = renderHook(() => useConfirm());
    expect(result.current.confirmDialog).toBeNull();
    expect(result.current.confirmBusy).toBe(false);
  });

  it("is busy for exactly as long as onConfirm runs", async () => {
    const pending = deferred();
    const { result } = opened({ onConfirm: () => pending.promise });

    let finished!: Promise<void>;
    act(() => {
      finished = dialogProps(result).onConfirm();
    });
    expect(result.current.confirmBusy).toBe(true);
    expect(dialogProps(result).busy).toBe(true);
    expect(result.current.confirmDialog).not.toBeNull();

    await act(async () => {
      pending.resolve();
      await finished;
    });
    expect(result.current.confirmBusy).toBe(false);
  });

  it("closes when onConfirm succeeds", async () => {
    const onConfirm = vi.fn();
    const { result } = opened({ onConfirm });
    await run(result);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(result.current.confirmDialog).toBeNull();
  });

  it("stays open with the thrown message", async () => {
    const { result } = opened({
      onConfirm: () => {
        throw new Error("Scan is locked.");
      },
    });
    await run(result);
    expect(result.current.confirmDialog).not.toBeNull();
    expect(dialogProps(result).error).toBe("Scan is locked.");
    expect(result.current.confirmBusy).toBe(false);
  });

  it("stays open with the rejected message of an async handler", async () => {
    const pending = deferred();
    const { result } = opened({ onConfirm: () => pending.promise });
    let finished!: Promise<void>;
    act(() => {
      finished = dialogProps(result).onConfirm();
    });
    await act(async () => {
      pending.reject(new Error("Server said no."));
      await finished;
    });
    expect(dialogProps(result).error).toBe("Server said no.");
    expect(dialogProps(result).busy).toBe(false);
  });

  it.each<[string, () => boolean | void]>([
    ["returning false", () => false],
    [
      "throwing an Error with no message",
      () => {
        throw new Error("");
      },
    ],
    [
      "throwing something that is not an Error",
      () => {
        throw "nope";
      },
    ],
  ])("stays open with the generic line on %s", async (_label, onConfirm) => {
    const { result } = opened({ onConfirm });
    await run(result);
    expect(dialogProps(result).error).toBe(GENERIC);
  });

  it("clears the previous failure when the action is retried", async () => {
    const retry = deferred<boolean | void>();
    let attempts = 0;
    const { result } = opened({
      onConfirm: () => (++attempts === 1 ? false : retry.promise),
    });
    await run(result);
    expect(dialogProps(result).error).toBe(GENERIC);

    let finished!: Promise<void>;
    act(() => {
      finished = dialogProps(result).onConfirm();
    });
    expect(dialogProps(result).error).toBeNull();
    expect(dialogProps(result).busy).toBe(true);

    await act(async () => {
      retry.resolve();
      await finished;
    });
    expect(result.current.confirmDialog).toBeNull();
  });

  it("does not carry a failure over to the next confirmation", async () => {
    const { result } = opened({ onConfirm: () => false });
    await run(result);
    expect(dialogProps(result).error).toBe(GENERIC);

    act(() => result.current.confirm(request({ title: "Something else?" })));
    expect(dialogProps(result).error).toBeNull();
  });

  it("closes on cancel without running the action", () => {
    const onConfirm = vi.fn();
    const { result } = opened({ onConfirm });
    act(() => dialogProps(result).onCancel());
    expect(result.current.confirmDialog).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("useConfirm in a real dialog", () => {
  function Page({ req }: { req: ConfirmRequest }) {
    const { confirm, confirmDialog } = useConfirm();
    return (
      <>
        <button type="button" onClick={() => confirm(req)}>
          Delete
        </button>
        {confirmDialog}
      </>
    );
  }

  const confirmButton = () =>
    screen.getByRole("button", { name: "Delete scan" }) as HTMLButtonElement;

  it("disables both buttons while the action runs, then goes away", async () => {
    const pending = deferred();
    render(
      <Page
        req={request({ danger: true, onConfirm: () => pending.promise })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    screen.getByRole("alertdialog", { name: "Delete this scan?" });

    fireEvent.click(confirmButton());
    expect(confirmButton().disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows why a failed action did not happen and allows another go", async () => {
    render(
      <Page
        req={request({
          onConfirm: () => {
            throw new Error("Scan is locked.");
          },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await act(async () => {
      fireEvent.click(confirmButton());
    });
    expect(screen.getByRole("alert").textContent).toContain("Scan is locked.");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(confirmButton().disabled).toBe(false);
  });

  it("does not run the action on Cancel", () => {
    const onConfirm = vi.fn();
    render(<Page req={request({ onConfirm })} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
