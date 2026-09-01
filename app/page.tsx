import { permanentRedirect } from "next/navigation";
import { ROUTES } from "@/lib/config/constants";

export default function HomePage() {
  // Middleware handles routing: signed out to /landing, signed in to
  // /dashboard. Anything that still reaches this component is signed out.
  //
  // permanentRedirect (308) rather than redirect (307), matching middleware.ts
  // for the same reason: "/" is the URL people type, link and share, and a
  // temporary redirect leaves Google evaluating "/" and "/landing" as two
  // competing URLs instead of consolidating onto the one that renders.
  permanentRedirect(ROUTES.LANDING);
}
