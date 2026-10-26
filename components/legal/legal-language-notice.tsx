import { useLocale, useTranslations } from "next-intl";
import { Callout } from "@/components/shared/callout";
import { showsLegalLanguageNotice } from "./legal-language";

/**
 * Which version of these words is the one that counts, for a reader who is not
 * reading English.
 *
 * The site can be read in six languages and the legal pages are agreements, so
 * the answer has to be on the page itself. It renders under the page's H1
 * (LegalPageHeader, and the /legal index) rather than in LegalShell above it,
 * because the shell cannot know where the title is: for every reader it used to
 * sit between the document nav and the title and push the H1 down the screen.
 *
 * The hooks rather than the async getTranslations, for the reason
 * components/scanner/footer.tsx gives: this renders from server pages and the
 * hook reads the same request config there.
 */
export function LegalLanguageNotice({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations("legal");
  if (!showsLegalLanguageNotice(locale)) return null;

  return (
    <Callout variant="info" title={t("languageTitle")} className={className}>
      {t("languageNotice")}
    </Callout>
  );
}
