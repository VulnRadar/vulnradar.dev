import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL environment variable is not set. Add it to your .env.local file or Vercel project settings.",
  );
}

// rejectUnauthorized was `false` even when
// DATABASE_SSL=true, which allowed any on-path attacker to MITM the DB
// connection. CA bundle can be overridden via DATABASE_SSL_CA for
// self-signed certs. The plain `false` (no SSL) path is unchanged for
// local-dev convenience.
const useSSL = process.env.DATABASE_SSL === "true";
const ssl: false | { rejectUnauthorized: boolean; ca?: string } = useSSL
  ? {
      rejectUnauthorized: true,
      ...(process.env.DATABASE_SSL_CA
        ? { ca: process.env.DATABASE_SSL_CA }
        : {}),
    }
  : false;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error(
    "[VulnRadar] Unexpected database pool error:",
    err instanceof Error ? err.message : "non-Error thrown",
  );
});

export default pool;
