import { Pool } from "pg"

if (!process.env.DATABASE_URL) {
  console.error(
    "[VulnRadar] DATABASE_URL environment variable is not set. Please add it to your .env.local file or Vercel project settings.",
  )
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

pool.on("error", (err) => {
  console.error("[VulnRadar] Unexpected database pool error:", err)
})

export default pool

