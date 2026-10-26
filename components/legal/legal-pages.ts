import {
  Scale,
  Shield,
  AlertTriangle,
  FileText,
  Accessibility,
  Copyright,
  type LucideIcon,
} from "lucide-react";

export interface LegalNavPage {
  href: string;
  /** The full name, shown from sm up. */
  label: string;
  /**
   * What the chip says below sm, written out rather than derived. It used to
   * be the first word of `label`, which turned "Acceptable Use" into
   * "Acceptable", a word that names nothing.
   */
  shortLabel: string;
  icon: LucideIcon;
}

export const LEGAL_NAV_PAGES: readonly LegalNavPage[] = [
  {
    href: "/legal/terms",
    label: "Terms of Service",
    shortLabel: "Terms",
    icon: Scale,
  },
  {
    href: "/legal/privacy",
    label: "Privacy Policy",
    shortLabel: "Privacy",
    icon: Shield,
  },
  {
    href: "/legal/disclaimer",
    label: "Disclaimer",
    shortLabel: "Disclaimer",
    icon: AlertTriangle,
  },
  {
    href: "/legal/acceptable-use",
    label: "Acceptable Use",
    shortLabel: "Acceptable use",
    icon: FileText,
  },
  {
    href: "/legal/accessibility",
    label: "Accessibility",
    shortLabel: "Accessibility",
    icon: Accessibility,
  },
  {
    href: "/legal/dmca",
    label: "DMCA Policy",
    shortLabel: "DMCA",
    icon: Copyright,
  },
];
