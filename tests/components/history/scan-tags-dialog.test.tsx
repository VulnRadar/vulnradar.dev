/**
 * "+ Add tag" opens AddTagDialog instead of swapping the chip for an input.
 *
 * The inline input saved on Enter and on blur, so clicking anywhere else on a
 * history row after a typo added the typo. The dialog saves on Enter or Save
 * only, keeps the two client checks, and stays open with the message when the
 * server refuses. The remove and dismiss X buttons stay one click.
 *
 * Rendered through a pass-through stand-in for components/ui/dialog, with the
 * props AddTagDialog hands to EditDialog recorded so its save and close paths
 * can be driven without a DOM.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { EditDialogProps } from "@/components/shared/edit-dialog";
import {
  editCloseDecision,
  interpretEditSave,
} from "@/components/shared/edit-dialog-outcome";
import { CONFIG_MAX_TAG_LENGTH } from "@/lib/config/config-values";
import type { ScanTag } from "@/components/history/history-types";

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

const captured = vi.hoisted(() => ({ props: [] as EditDialogProps[] }));

vi.mock("@/components/shared/edit-dialog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/shared/edit-dialog")>();
  return {
    ...actual,
    EditDialog: (props: EditDialogProps) => {
      captured.props.push(props);
      return <actual.EditDialog {...props} />;
    },
  };
});

const {
  ScanTags,
  AddTagDialog,
  checkNewTag,
  submitNewTag,
  TAG_INPUT_MAX_LENGTH,
} = await import("@/components/history/scan-tags");

const TAGS: ScanTag[] = [
  { tag: "Production", source: "user" },
  { tag: "wordpress", source: "auto" },
];

function lastProps(): EditDialogProps {
  const props = captured.props.at(-1);
  if (!props) throw new Error("EditDialog was not rendered");
  return props;
}

beforeEach(() => {
  captured.props.length = 0;
});

describe("the tag row", () => {
  const noop = async () => null;

  it("renders the dashed Add tag chip, lifted and at least 24px tall", () => {
    const html = renderToStaticMarkup(
      <ScanTags scanId="abc" tags={TAGS} onAdd={noop} onRemove={noop} />,
    );
    const chip = /<button[^>]*aria-label="Add tag"[^>]*>/.exec(html);
    expect(chip).not.toBeNull();
    expect(chip![0]).toContain("min-h-6");
    expect(chip![0]).toContain("relative z-10");
    expect(chip![0]).toContain("border-dashed");
    // Hidden until the row is hovered or focused, and untappable while hidden.
    expect(chip![0]).toContain("pointer-events-none");
    // No inline input and no dialog until it is clicked.
    expect(html).not.toContain("<input");
    expect(captured.props).toHaveLength(0);
  });

  it("keeps remove and dismiss as one-click buttons", () => {
    const html = renderToStaticMarkup(
      <ScanTags scanId="abc" tags={TAGS} onAdd={noop} onRemove={noop} />,
    );
    expect(html).toContain('aria-label="Remove tag Production"');
    expect(html).toContain(
      'aria-label="Dismiss auto tag wordpress: not accurate for this scan"',
    );
  });

  it("renders chips only when read-only", () => {
    const html = renderToStaticMarkup(
      <ScanTags
        scanId="abc"
        tags={TAGS}
        onAdd={noop}
        onRemove={noop}
        readOnly
      />,
    );
    expect(html).toContain("Production");
    expect(html).toContain("wordpress");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Add tag");
  });

  it("keeps the tour anchor on the wrapper", () => {
    const html = renderToStaticMarkup(
      <ScanTags scanId="abc" tags={TAGS} onAdd={noop} onRemove={noop} />,
    );
    expect(html.startsWith("<div ")).toBe(true);
    expect(html.slice(0, html.indexOf(">"))).toMatch(/data-tour/);
  });
});

describe("AddTagDialog", () => {
  it("opens with one labelled, empty field, Cancel and Add tag", () => {
    const html = renderToStaticMarkup(
      <AddTagDialog
        scanId="abc"
        tags={TAGS}
        onAdd={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Add a tag");
    const labelFor = /<label[^>]*for="([^"]+)"[^>]*>Tag<\/label>/.exec(html);
    expect(labelFor).not.toBeNull();
    const input = new RegExp(`<input[^>]*id="${labelFor![1]}"[^>]*>`).exec(
      html,
    );
    expect(input).not.toBeNull();
    expect(input![0]).toContain('value=""');
    expect(input![0]).toContain(`maxLength="${TAG_INPUT_MAX_LENGTH}"`);
    expect(html).toContain(">Cancel<");

    const props = lastProps();
    expect(props.saveLabel).toBe("Add tag");
    expect(props.tier).toBe("compact");
    expect(props.size).toBe("sm");
    // An empty field cannot be saved, and closing it does not ask.
    expect(props.canSave).toBe(false);
    expect(props.dirty).toBe(false);
  });

  it("caps the field at the length the server keeps", () => {
    expect(TAG_INPUT_MAX_LENGTH).toBe(Math.min(CONFIG_MAX_TAG_LENGTH, 50));
  });

  it("closes on Cancel or Escape without adding anything", () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    renderToStaticMarkup(
      <AddTagDialog scanId="abc" tags={TAGS} onAdd={onAdd} onClose={onClose} />,
    );
    const props = lastProps();
    expect(
      editCloseDecision({ busy: false, dirty: props.dirty ?? false }),
    ).toBe("close");
    props.onOpenChange(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe("the add-tag save", () => {
  it("refuses a tag longer than the server keeps, before sending it", async () => {
    const onAdd = vi.fn();
    const long = "x".repeat(CONFIG_MAX_TAG_LENGTH + 1);
    const outcome = await submitNewTag("abc", long, TAGS, onAdd);
    expect(outcome).toBe(
      `Tags are shortened to ${CONFIG_MAX_TAG_LENGTH} characters when saved.`,
    );
    expect(onAdd).not.toHaveBeenCalled();
    expect(interpretEditSave(outcome).kind).toBe("failed");
  });

  it("refuses a tag already on the scan, ignoring case, before sending it", async () => {
    const onAdd = vi.fn();
    const outcome = await submitNewTag("abc", "  production ", TAGS, onAdd);
    expect(outcome).toBe("That tag is already on this scan.");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("does not count an auto tag as a duplicate", () => {
    expect(checkNewTag("WordPress", TAGS)).toEqual({
      ok: true,
      tag: "WordPress",
    });
  });

  it("sends the trimmed tag and closes when it sticks", async () => {
    const onAdd = vi.fn(async () => null);
    const outcome = await submitNewTag(42, "  staging  ", TAGS, onAdd);
    expect(onAdd).toHaveBeenCalledWith(42, "staging");
    expect(outcome).toBeNull();
    expect(interpretEditSave(outcome)).toEqual({ kind: "saved" });
  });

  it("stays open with the server's message when the add fails", async () => {
    const onAdd = vi.fn(async () => "You have reached the tag limit.");
    const outcome = await submitNewTag("abc", "staging", TAGS, onAdd);
    expect(interpretEditSave(outcome)).toEqual({
      kind: "failed",
      message: "You have reached the tag limit.",
    });
  });
});
