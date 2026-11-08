import { PublicPageShell } from "@/components/shared/public-page-shell";
import { BrandKit } from "@/components/brand/brand-kit";

// English only, like /security and /pricing: the public marketing pages are
// not translated, only the shared nav and footer around them are.
export default function BrandPage() {
  return (
    <PublicPageShell fullBleed>
      <BrandKit />
    </PublicPageShell>
  );
}
