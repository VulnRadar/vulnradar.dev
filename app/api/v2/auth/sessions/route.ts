import { NextResponse } from "next/server"
import { getSession, deleteAllSessions } from "@/lib/auth"

export async function DELETE() {
  try {
    const session = await getSession()
    if (!session?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Delete all sessions for this user (including current one)
    await deleteAllSessions(session.userId)

    // Clear the current session cookie
    const response = NextResponse.json({ success: true, message: "All sessions revoked" })
    response.cookies.set("session", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    })

    return response
  } catch (error) {
    console.error("[Sessions] Error revoking sessions:", error)
    return NextResponse.json({ error: "Failed to revoke sessions" }, { status: 500 })
  }
}
