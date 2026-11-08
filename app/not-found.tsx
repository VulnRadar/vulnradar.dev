import type { Metadata } from "next";
import { NotFoundView } from "@/components/shared/not-found-view";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return <NotFoundView />;
}
