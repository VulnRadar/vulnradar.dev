import { redirect } from "next/navigation"

export default function HomePage() {
  // Middleware handles routing:
  // - Unauthenticated users → /landing
  // - Authenticated users → /dashboard
  redirect("/landing")
}

