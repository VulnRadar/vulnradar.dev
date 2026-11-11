/**
 * Which checks-data entries are documentation for findings that carry a
 * different id.
 *
 * Every entry in dns.json, email.json and tls.json that has no live probe of
 * its own under that id is write-up for a finding the async layer builds in
 * code (lib/scanner/async-checks.ts), and that finding's id comes from its
 * title (`async-<slug>--<hash>`, see async-check-catalog.ts). Nobody who runs a
 * scan ever sees `spf-record` as a finding id, so a page, an API row or an
 * assistant answer that promises "the id stays the same between runs" for it
 * is promising something no scan can deliver.
 *
 * Two optional fields on the JSON entry say what is true instead:
 *
 *   emittedAs          the async check ids a scan actually reports for this
 *                      write-up (a finding id starts with `<id>--`)
 *   documentationOnly  nothing a scan reports corresponds to it at all
 *
 * Only these three files carry them. The module reads them directly rather
 * than through the registry so the SEO pages that need the answer do not pull
 * the scan detectors into their render path.
 */

import dns from "./checks-data/dns.json";
import email from "./checks-data/email.json";
import tls from "./checks-data/tls.json";

interface EmissionFields {
  id: string;
  emittedAs?: string[];
  documentationOnly?: boolean;
}

export interface CheckEmission {
  /** True when a finding carries this entry's own id. */
  emitted: boolean;
  /** The async check ids a scan reports for this write-up, in file order. */
  emittedAs: readonly string[];
  /** True when no scan reports anything that corresponds to this entry. */
  documentationOnly: boolean;
}

const BY_ID = new Map<string, EmissionFields>(
  [...dns, ...email, ...tls].map((entry) => {
    const fields = entry as EmissionFields;
    return [fields.id, fields];
  }),
);

const EMITTED_UNDER_OWN_ID: CheckEmission = {
  emitted: true,
  emittedAs: [],
  documentationOnly: false,
};

export function getCheckEmission(id: string): CheckEmission {
  const entry = BY_ID.get(id);
  const emittedAs = entry?.emittedAs ?? [];
  const documentationOnly = entry?.documentationOnly === true;
  if (emittedAs.length === 0 && !documentationOnly) return EMITTED_UNDER_OWN_ID;
  return { emitted: false, emittedAs, documentationOnly };
}
