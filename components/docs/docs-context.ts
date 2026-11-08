"use client";

import { createContext, useContext } from "react";
import type { TocItem } from "./docs-types";

export interface DocsContextType {
  activeSection: string;
  setActiveSection: (section: string) => void;
  /** The current page's contents, straight from the registry. */
  tocItems: TocItem[];
  openSearch: () => void;
}

export const DocsContext = createContext<DocsContextType>({
  activeSection: "",
  setActiveSection: () => {},
  tocItems: [],
  openSearch: () => {},
});

export function useDocsContext() {
  return useContext(DocsContext);
}
