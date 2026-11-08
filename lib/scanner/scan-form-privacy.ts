/**
 * What the scan form's "Keep this scan private" switch shows and sends.
 *
 * An authenticated scan sees whatever the logged-in area of the target renders,
 * so POST /scan/authenticated and an authenticated crawl publish one only when
 * the request explicitly asks. Sending `!keepPrivate` asked on behalf of every
 * public-by-default account that had never touched the switch, which is the one
 * thing those routes exist to rule out. So while a login is attached the switch
 * reads as on and the field is omitted, until the person turns it off themselves.
 */
export interface ScanFormPrivacy {
  /** What the switch shows. Null while the account default is still unknown. */
  keepPrivate: boolean | null;
  /** Omitted when nobody has decided, so the server's own default applies. */
  isPublic: boolean | undefined;
}

export function scanFormPrivacy(input: {
  hasLogin: boolean;
  chosen: boolean;
  keepPrivate: boolean | null;
}): ScanFormPrivacy {
  if (input.hasLogin && !input.chosen) {
    return { keepPrivate: true, isPublic: undefined };
  }
  return {
    keepPrivate: input.keepPrivate,
    isPublic: input.keepPrivate === null ? undefined : !input.keepPrivate,
  };
}
