/**
 * The audit log's link to the account an entry acted on.
 *
 * The account page answers 403 to a role without VIEW_USERS, and a security
 * analyst holds the audit log without it. The target's name was a link that
 * could only end in a refusal toast, so it is plain text for those roles.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { AuditLog } = await import("@/components/admin/audit/audit-log");
const { EMPTY_AUDIT_FILTERS } =
  await import("@/components/admin/audit/audit-filters");

const entry = {
  id: 1,
  action: "disable",
  details: "Disabled the account",
  created_at: "2026-01-01T00:00:00Z",
  ip_address: "203.0.113.9",
  admin_id: 2,
  admin_email: "staff@example.com",
  admin_name: "Staff",
  admin_avatar_url: null,
  target_user_id: 7,
  target_email: "ada@example.com",
  target_name: "Ada",
  target_avatar_url: null,
};

function render(canOpenUsers: boolean) {
  return renderToStaticMarkup(
    <AuditLog
      auditLogs={[entry]}
      auditPaging={false}
      auditPage={1}
      auditTotalPages={1}
      auditPageSize={10}
      setAuditPageSize={() => {}}
      fetchAudit={() => {}}
      auditStats={null}
      auditTotal={1}
      filters={EMPTY_AUDIT_FILTERS}
      onFiltersChange={() => {}}
      canExport={false}
      canOpenUsers={canOpenUsers}
      onNotify={() => {}}
    />,
  );
}

describe("audit log target link", () => {
  it("links to the account for a role that can open it", () => {
    expect(render(true)).toContain('href="/admin?tab=users&amp;user=7"');
  });

  it("is plain text for a role that cannot", () => {
    const html = render(false);
    expect(html).not.toContain("tab=users&amp;user=7");
    expect(html).toContain("Ada");
  });
});
