/**
 * Per-worker setup for the integration tier.
 *
 * This file runs before the test module is imported, which matters because
 * lib/database/db.ts builds its Pool from process.env.DATABASE_URL at module
 * scope: once a suite has imported anything that reaches it, the connection
 * string is already baked in.
 *
 * The assignment is unconditional on purpose. If a developer's real
 * DATABASE_URL were left in place, a tier that runs the boot DDL, inserts
 * fixtures and exercises lib/database/cleanup.ts's retention deletes would be
 * pointed straight at their working database. When the gate is off the value
 * is a deliberately unroutable placeholder: every suite is skipped, so nothing
 * ever connects, but the module-scope check in db.ts still finds a string and
 * does not throw at import time.
 */
const integrationUrl = process.env.INTEGRATION_DATABASE_URL;

process.env.DATABASE_URL =
  integrationUrl ?? "postgresql://integration:disabled@127.0.0.1:1/disabled";

// The test database is local (a CI services: container, or a scratch cluster),
// so TLS is off unless the runner explicitly asks for it.
process.env.DATABASE_SSL = process.env.INTEGRATION_DATABASE_SSL ?? "false";

// A fixed, non-secret key so anything that decrypts an api_keys/TOTP column
// behaves deterministically across runs. Never a real deployment's key: this
// is 32 bytes of 0x11, and the database it unlocks is thrown away.
process.env.API_KEY_ENCRYPTION_KEY ??=
  "1111111111111111111111111111111111111111111111111111111111111111";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
