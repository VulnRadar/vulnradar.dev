"use client";

import { createContext, useContext } from "react";
import type { TocItem } from "./docs-types";

export interface DocsContextType {
  activeSection: string;
  setActiveSection: (section: string) => void;
  /** The current page's contents, straight from the registry. */
  tocItems: TocItem[];
  /**
   * Does nothing. /docs/api/playground still calls it from before the contents
   * lived in the registry, until that page's next owner removes the call.
   */
  setTocItems: (items: TocItem[]) => void;
  openSearch: () => void;
}

export const ignoreTocItems = () => {};

export const DocsContext = createContext<DocsContextType>({
  activeSection: "",
  setActiveSection: () => {},
  tocItems: [],
  setTocItems: ignoreTocItems,
  openSearch: () => {},
});

export function useDocsContext() {
  return useContext(DocsContext);
}
