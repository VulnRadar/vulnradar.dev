import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildTemplateCorpus } from "./_template-corpus";

/**
 * Renders every template through the real shell, exactly as nodemailer would
 * receive it.
 *
 * The assertions run always. The files are written only when
 * WRITE_EMAIL_PREVIEWS=1, because a test run that dirties the working tree on
 * every invocation is a test run nobody trusts:
 *
 *   WRITE_EMAIL_PREVIEWS=1 npx vitest run tests/lib/email/email-previews.test.ts
 *
 * That drops one file per template into audits/email-previews/ plus an
 * index.html linking them, which is the only way to actually look at this work
 * without a mail client.
 */

const sendMailMock = vi.fn();
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}));
vi.mock("@/lib/database/db", () => ({
  default: { query: async () => ({ rows: [] }) },
}));

const OUT_DIR = path.join(process.cwd(), "audits", "email-previews");
const WRITE = process.env.WRITE_EMAIL_PREVIEWS === "1";

/** The ceiling in lib/email/email.ts, above which no rendered copy is kept. */
const EMAIL_LOG_HTML_MAX_CHARS = 100_000;

interface Rendered {
  name: string;
  subject: string;
  html: string;
  text: string;
  hasUnsubscribe: boolean;
}

async function renderAll(): Promise<Rendered[]> {
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "user@example.com";
  process.env.SMTP_PASS = "app-password";
  const email = await import("@/lib/email/email");
  const corpus = buildTemplateCorpus(email);

  const out: Rendered[] = [];
  for (const t of corpus) {
    // Half the corpus is preference-gated in production and half is not, and
    // the footer says something different for each. Alternating means the
    // previews show both footers rather than only one of them.
    const gated = out.length % 2 === 0;
    sendMailMock.mockClear();
    await email.sendEmail({
      to: "sam@example.dev",
      subject: t.subject,
      text: t.text,
      html: t.html,
      preheader: t.preheader,
      ...(gated
        ? { unsubscribeToken: "11111111-2222-3333-4444-555555555555" }
        : {}),
    });
    const sent = sendMailMock.mock.calls[0][0];
    out.push({
      name: t.name,
      subject: t.subject,
      html: sent.html,
      text: sent.text,
      hasUnsubscribe: gated,
    });
  }
  return out;
}

describe("rendered email previews", () => {
  beforeEach(() => {
    vi.resetModules();
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ messageId: "test" });
  });

  it("renders every template into a standalone, self-contained document", async () => {
    const rendered = await renderAll();
    expect(rendered.length).toBeGreaterThanOrEqual(55);

    for (const r of rendered) {
      // Standalone: a file you can open in a browser with no server.
      expect(r.html.startsWith("<!DOCTYPE html>"), r.name).toBe(true);
      expect(r.html, r.name).toContain("</html>");
      // Self-contained: no stylesheet or script to fetch. The only remote
      // reference in the document is the logo <img>, which every mail client
      // blocks by default anyway.
      expect(r.html, r.name).not.toContain("<link");
      expect(r.html, r.name).not.toContain("<script");
      expect(r.html.toLowerCase(), r.name).not.toContain("javascript:");
      // The document title is the subject, so a client that shows one shows
      // something useful.
      expect(r.html, r.name).toContain("<title>");
    }
  });

  it("stays under the size email_logs will actually store", async () => {
    const rendered = await renderAll();
    for (const r of rendered) {
      expect(
        r.html.length,
        `${r.name} renders ${r.html.length} chars`,
      ).toBeLessThan(EMAIL_LOG_HTML_MAX_CHARS);
    }
  });

  it("writes the previews when asked", async () => {
    if (!WRITE) {
      expect(WRITE).toBe(false);
      return;
    }
    const rendered = await renderAll();
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const f of fs.readdirSync(OUT_DIR)) {
      if (f.endsWith(".html")) fs.rmSync(path.join(OUT_DIR, f));
    }
    for (const r of rendered) {
      fs.writeFileSync(path.join(OUT_DIR, `${r.name}.html`), r.html, "utf8");
    }
    fs.writeFileSync(
      path.join(OUT_DIR, "index.html"),
      buildIndex(rendered),
      "utf8",
    );
    expect(fs.readdirSync(OUT_DIR).length).toBe(rendered.length + 1);
  });
});

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A plain contact sheet: subject, preheader and a link, per template. */
function buildIndex(rendered: Rendered[]): string {
  const rows = rendered
    .map((r) => {
      const pre = /<div style="display: none[^>]*>([^<]*)/.exec(r.html);
      const preview = pre
        ? pre[1].replace(/(&#8199;|&#65279;)+/g, "").trim()
        : "";
      return `<tr>
        <td><a href="./${r.name}.html">${esc(r.name)}</a></td>
        <td>${esc(r.subject)}</td>
        <td class="pre">${esc(preview)}</td>
        <td class="n">${r.hasUnsubscribe ? "yes" : "no"}</td>
        <td class="n">${(r.html.length / 1024).toFixed(1)}k</td>
      </tr>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<title>VulnRadar email previews</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 32px auto; max-width: 1100px; padding: 0 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { color: #555; margin: 0 0 24px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #666; }
  td.pre { color: #666; }
  td.n { text-align: right; white-space: nowrap; color: #666; }
  a { color: #065ac1; }
</style></head><body>
<h1>Email previews</h1>
<p>Generated by tests/lib/email/email-previews.test.ts with WRITE_EMAIL_PREVIEWS=1.
Each file is the exact document nodemailer is handed. Open one and switch your
OS between light and dark to see both palettes.</p>
<table>
  <tr><th>Template</th><th>Subject</th><th>Preheader</th><th>Unsub</th><th>Size</th></tr>
  ${rows}
</table>
</body></html>`;
}
