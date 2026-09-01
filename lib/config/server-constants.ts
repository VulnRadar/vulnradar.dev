import "server-only";

// SERVER-ONLY CONSTANTS
//
// Config values that read a secret, or a variable that only exists on the
// server, and that more than one server module needs. `import "server-only"`
// turns an import from a client component into a build error rather than
// something you find later by reading a compiled chunk, which is how
// AUDIT-012#fe-15 was found: the committed build's
// `static/chunks/9711-3989d97c24edd68e.js` was part of the /layout entry, so
// it shipped on all 311 routes, and it contained
//
//   i.env.SMTP_HOST, i.env.SMTP_PORT, i.env.SMTP_USER, i.env.SMTP_PASS,
//   i.env.SMTP_FROM || i.env.SMTP_USER;
//   i.env.BROWSERBASE_API_KEY && i.env.BROWSERBASE_PROJECT_ID;
//
// as bare expression statements. Nothing leaked: `i` is Next's client process
// shim and only NEXT_PUBLIC_* variables are inlined into it, so every one of
// those evaluated to undefined. What shipped was the code and the variable
// names, one careless NEXT_PUBLIC_ rename away from being a real disclosure
// of the SMTP password and the Browserbase key.
//
// The SMTP half of that chunk is not here. It has exactly one consumer,
// lib/email/email.ts, and that module builds the nodemailer transport, so it
// can never reach a client bundle either way; the credentials are declared
// there now. Routing them through this module instead would have put
// `server-only` in the import graph of 160 test files, which have to
// neutralize the marker (`vi.mock("server-only", () => ({}))`) because the
// package's default entry throws outside a react-server context.
//
// Values that read `process.env.NEXT_PUBLIC_*` do not belong here: those are
// public by construction and go in lib/config/client-constants.ts.

// BROWSERBASE / LIVE BROWSER VIEWER
//
// Whether this deployment has Browserbase credentials at all. The routes
// under app/api/v3/browser/sessions/ refuse the request when it is false, so
// a deployment without the feature returns a clean 503 instead of failing
// inside the SDK. The TTL ceilings that cap a session are plain numbers and
// stay in lib/config/constants.ts.

export const BROWSERBASE_ENABLED = !!(
  process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID
);
