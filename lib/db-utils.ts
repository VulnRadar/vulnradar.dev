import pool from "./db"

export async function getAdminEmails(): Promise<string[]> {
  try {
    const result = await pool.query("SELECT email FROM users WHERE role = 'admin'")
    return result.rows.map((row: any) => row.email)
  } catch (error) {
    console.error("Failed to fetch admin emails:", error)
    return []
  }
}
