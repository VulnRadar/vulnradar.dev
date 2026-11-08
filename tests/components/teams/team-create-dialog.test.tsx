/**
 * The create-team dialog shows a refused create inside itself. The page used
 * to post the reason to a banner above the header, which the dialog's scrim
 * covers, so a 400 looked like the button did nothing.
 *
 * Rendered with renderToStaticMarkup and the Dialog primitive passed through
 * (it portals, which a static render leaves empty).
 */
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
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
    DialogOverlay: Pass,
    DialogPortal: Pass,
    DialogTitle: Pass,
    DialogTrigger: Pass,
  };
});

const { TeamCreateDialog } =
  await import("@/components/teams/team-create-dialog");

function render(error?: string | null) {
  return renderToStaticMarkup(
    <TeamCreateDialog
      open
      onOpenChange={() => {}}
      maxInvites={3}
      creating={false}
      error={error}
      onCreate={() => {}}
    />,
  );
}

describe("TeamCreateDialog error", () => {
  it("renders the refusal inside the dialog as an alert", () => {
    const html = render("Team name must be at least 2 characters.");
    expect(html).toContain("Team name must be at least 2 characters.");
    expect(html).toContain('role="alert"');
    // Inside the content, before the footer's buttons.
    expect(html.indexOf('role="alert"')).toBeLessThan(
      html.indexOf("Create team</button>"),
    );
  });

  it("renders no alert without an error", () => {
    expect(render()).not.toContain('role="alert"');
    expect(render(null)).not.toContain('role="alert"');
  });
});
