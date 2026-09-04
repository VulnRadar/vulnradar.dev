/**
 * Every finding lib/scanner/async-checks.ts can emit, declared as data.
 *
 * The async layer is the one part of the scanner that does not live in
 * lib/scanner/checks-data/*.json: its findings are built in code, and each
 * one's id is derived from the finding TITLE, not from a registry entry
 * (`async-<slugified title>--<url hash>`, see makeVuln there). Those ids
 * are in no registry, so getCheckDef() returned undefined for all of them
 * and the admin Engine Feedback panel rendered every async row as
 * "Category: Unknown, Severity: Unknown" even though the check plainly has
 * both.
 *
 * This module is not a second copy of that metadata; it is the definition
 * the findings are built FROM. makeVuln() takes an AsyncCheckDef and
 * nothing else, and the only thing that produces one is `def()` below,
 * which registers the check here as a side effect of declaring it. A new
 * async check therefore cannot be written without a catalog entry -- it
 * would not compile -- so this lookup cannot fall behind the checks the
 * way a hand-maintained list of slugs would.
 *
 * The ids themselves are unchanged: `async-` + the same title slug
 * makeVuln always produced. Feedback rows already stored in
 * scan_finding_feedback keep aggregating against exactly the same check.
 */

import type { Category, Severity } from "@/lib/scanner/types";

/**
 * Present in the type, never at runtime: it exists only so an inline
 * object literal cannot stand in for a catalog entry at a makeVuln call
 * site. Every AsyncCheckDef has to come from `def()`, and `def()` is the
 * thing that registers it.
 */
declare const asyncCheckBrand: unique symbol;

export interface AsyncCheckDef {
  /**
   * What extractCheckId() (lib/scanner/check-accuracy.ts) recovers from
   * this check's finding ids, i.e. everything before the `--<hash>`.
   */
  readonly checkId: string;
  readonly title: string;
  readonly severity: Severity;
  readonly category: Category;
  readonly [asyncCheckBrand]: true;
}

/**
 * The id prefix every finding from this check carries. Kept here rather
 * than in async-checks.ts so the slug rule and the lookup that has to
 * reverse it can never disagree.
 */
export function asyncCheckId(title: string): string {
  return `async-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

const byCheckId = new Map<string, AsyncCheckDef>();

function def(
  title: string,
  severity: Severity,
  category: Category,
): AsyncCheckDef {
  const checkId = asyncCheckId(title);
  const existing = byCheckId.get(checkId);
  if (existing) {
    // Two titles that slugify to the same id would silently merge two
    // different checks' feedback into one row on the admin panel, which is
    // the same class of bug find-duplicate-ids.mjs guards against for the
    // JSON registry.
    throw new Error(
      `Duplicate async check id "${checkId}" ("${existing.title}" vs "${title}")`,
    );
  }
  const entry = { checkId, title, severity, category } as AsyncCheckDef;
  byCheckId.set(checkId, entry);
  return entry;
}

/**
 * A check whose severity or category is decided per finding rather than
 * once in the catalog: a weak DKIM key escalates below 1024 bits, and the
 * TLS certificate checks report under `ssl` or `tls` depending on which
 * category the scan asked for. The id is unaffected (it comes from the
 * title alone), so the catalog keeps the canonical value and this returns
 * a one-off copy for the finding being built. Deliberately does NOT
 * register: the canonical entry is already the one the admin panel shows.
 */
export function asyncCheckVariant(
  base: AsyncCheckDef,
  overrides: { severity?: Severity; category?: Category },
): AsyncCheckDef {
  return { ...base, ...overrides };
}

/** The async counterpart to getCheckDef() in lib/scanner/registry.ts. */
export function getAsyncCheckDef(checkId: string): AsyncCheckDef | undefined {
  return byCheckId.get(checkId);
}

/** Every async check, in the order async-checks.ts emits them. */
export const ASYNC_CHECKS = {
  // Email authentication: SPF, DMARC, DKIM, BIMI, MTA-STS, TLS-RPT
  missingSpfRecord: def("Missing SPF Record", "medium", "configuration"),
  weakSpfRecordAll: def("Weak SPF Record (+all)", "high", "configuration"),
  spfRecordUsesSoftFailAll: def(
    "SPF Record Uses Soft Fail (~all)",
    "low",
    "configuration",
  ),
  spfUsesDeprecatedPtrMechanism: def(
    "SPF Uses Deprecated ptr: Mechanism",
    "low",
    "configuration",
  ),
  spfRedirectLoop: def("SPF Redirect Loop", "high", "email"),
  spfExceeds10DnsLookupLimit: def(
    "SPF Exceeds 10 DNS Lookup Limit",
    "high",
    "email",
  ),
  missingDmarcRecord: def("Missing DMARC Record", "medium", "configuration"),
  dmarcPolicySetToNone: def("DMARC Policy Set to None", "low", "configuration"),
  dmarcPolicySetToQuarantine: def(
    "DMARC Policy Set to Quarantine",
    "info",
    "configuration",
  ),
  dmarcMissingAggregateReportAddressRua: def(
    "DMARC Missing Aggregate Report Address (rua)",
    "info",
    "configuration",
  ),
  dmarcPctBelow100: def("DMARC pct= Below 100", "low", "configuration"),
  dmarcSubdomainPolicyWeakerThanDomainPolicy: def(
    "DMARC Subdomain Policy Weaker Than Domain Policy",
    "medium",
    "email",
  ),
  noDkimRecordsFound: def("No DKIM Records Found", "low", "configuration"),
  dkimPublicKeyUsesAWeakRsaKeySize: def(
    "DKIM Public Key Uses a Weak RSA Key Size",
    "medium",
    "email",
  ),

  // DNS records and zone hygiene
  dnssecNotEnabled: def("DNSSEC Not Enabled", "info", "configuration"),
  caaRecordMissing: def("CAA Record Missing", "medium", "configuration"),
  caaRecordRestrictsWildcardCertificatesOnly: def(
    "CAA Record Restricts Wildcard Certificates Only",
    "low",
    "dns",
  ),
  caaRecordPresentButRestrictsNoCertificateAuthority: def(
    "CAA Record Present But Restricts No Certificate Authority",
    "medium",
    "dns",
  ),
  singleAuthoritativeNameserver: def(
    "Single Authoritative Nameserver",
    "high",
    "configuration",
  ),
  mtaStsRecordMissing: def("MTA-STS Record Missing", "info", "email"),
  mtaStsPolicyFileMissing: def(
    "MTA-STS Policy File Missing",
    "medium",
    "email",
  ),
  mtaStsPolicyFileMalformed: def(
    "MTA-STS Policy File Malformed",
    "medium",
    "email",
  ),
  mtaStsModeNotEnforcing: def("MTA-STS Mode Not Enforcing", "medium", "email"),
  mtaStsPolicyFileUnreachable: def(
    "MTA-STS Policy File Unreachable",
    "medium",
    "email",
  ),
  tlsRptRecordMissing: def("TLS-RPT Record Missing", "info", "email"),
  tlsRptRecordMissingRuaReportingUri: def(
    "TLS-RPT Record Missing rua= Reporting URI",
    "low",
    "email",
  ),
  bimiLogoUrlDoesNotMeetBimiRequirements: def(
    "BIMI Logo URL Does Not Meet BIMI Requirements",
    "low",
    "email",
  ),
  mxRecordMissing: def("MX Record Missing", "medium", "configuration"),
  noBackupMxServer: def("No Backup MX Server", "low", "dns"),
  mxHostnameIsACnameRfcViolation: def(
    "MX Hostname Is a CNAME (RFC Violation)",
    "medium",
    "email",
  ),
  soaRefreshIntervalTooHigh: def("SOA Refresh Interval Too High", "low", "dns"),
  soaSerialLooksStaleDateBasedConvention: def(
    "SOA Serial Looks Stale (Date-Based Convention)",
    "info",
    "dns",
  ),
  dnsResolvesToPrivateInternalAddress: def(
    "DNS Resolves to Private/Internal Address",
    "info",
    "dns",
  ),
  dnssecDsRecordMissing: def("DNSSEC DS Record Missing", "medium", "dns"),
  dnskeyRecordMissing: def("DNSKEY Record Missing", "medium", "dns"),
  tlsaDaneRecordMissing: def("TLSA (DANE) Record Missing", "info", "dns"),
  potentialSubdomainTakeoverViaDanglingCname: def(
    "Potential Subdomain Takeover via Dangling CNAME",
    "high",
    "dns",
  ),
  danglingCnameRecord: def("Dangling CNAME Record", "medium", "dns"),
  dnsZoneTransferAxfrAllowedFromPublicIps: def(
    "DNS Zone Transfer (AXFR) Allowed from Public IPs",
    "high",
    "dns",
  ),

  // TLS certificate and protocol (checkTLSCert)
  expiredTlsCertificate: def("Expired TLS Certificate", "critical", "ssl"),
  selfSignedTlsCertificate: def("Self-Signed TLS Certificate", "high", "ssl"),
  incompleteTlsCertificateChain: def(
    "Incomplete TLS Certificate Chain",
    "medium",
    "ssl",
  ),
  tlsCertificateExpiringSoon: def(
    "TLS Certificate Expiring Soon",
    "high",
    "ssl",
  ),
  tlsCertificateExpiringWithin30Days: def(
    "TLS Certificate Expiring Within 30 Days",
    "medium",
    "ssl",
  ),
  subjectAlternativeNameSanMissing: def(
    "Subject Alternative Name (SAN) Missing",
    "high",
    "ssl",
  ),
  expiredCertificateInCaChain: def(
    "Expired Certificate in CA Chain",
    "high",
    "ssl",
  ),
  weakTlsCertificateKeySize: def(
    "Weak TLS Certificate Key Size",
    "high",
    "ssl",
  ),
  ecdsaKeySizeBelowP256: def("ECDSA Key Size Below P-256", "info", "ssl"),
  weakTlsProtocolVersion: def("Weak TLS Protocol Version", "high", "ssl"),
  tls13NotSupported: def("TLS 1.3 Not Supported", "info", "ssl"),

  // Live HTTP probes: CORS, methods, host header, GraphQL
  arbitraryCorsOriginReflectionWithCredentials: def(
    "Arbitrary CORS Origin Reflection with Credentials",
    "critical",
    "headers",
  ),
  arbitraryCorsOriginReflection: def(
    "Arbitrary CORS Origin Reflection",
    "high",
    "headers",
  ),
  httpTraceMethodEnabled: def(
    "HTTP TRACE Method Enabled",
    "medium",
    "configuration",
  ),
  httpTraceAdvertisedInAllowHeader: def(
    "HTTP TRACE Advertised in Allow Header",
    "low",
    "configuration",
  ),
  httpConnectMethodExposed: def(
    "HTTP CONNECT Method Exposed",
    "medium",
    "configuration",
  ),
  hostHeaderInjectionRisk: def(
    "Host Header Injection Risk",
    "high",
    "host-validation",
  ),
  graphqlIntrospectionEnabled: def(
    "GraphQL Introspection Enabled",
    "medium",
    "information-disclosure",
  ),

  // robots.txt / security.txt
  sensitivePathsExposedInRobotsTxt: def(
    "Sensitive Paths Exposed in robots.txt",
    "medium",
    "information-disclosure",
  ),
  missingSecurityTxt: def("Missing security.txt", "info", "configuration"),

  // Probe deadline expired: the lookup never answered (makeProbeIncompleteVuln)
  mtaStsCheckDidNotComplete: def(
    "MTA-STS Check Did Not Complete",
    "info",
    "email",
  ),
  tlsRptCheckDidNotComplete: def(
    "TLS-RPT Check Did Not Complete",
    "info",
    "email",
  ),

  // Exposed-file / exposed-panel probes (checkExposedFiles)
  gitRepositoryConfigExposed: def(
    "Git Repository Config Exposed",
    "critical",
    "information-disclosure",
  ),
  gitHeadFileExposed: def(
    "Git HEAD File Exposed",
    "high",
    "information-disclosure",
  ),
  environmentFileExposed: def(
    "Environment File Exposed",
    "critical",
    "information-disclosure",
  ),
  environmentFileExposedEnvLocal: def(
    "Environment File Exposed (.env.local)",
    "critical",
    "information-disclosure",
  ),
  htpasswdFileExposed: def(
    "htpasswd File Exposed",
    "critical",
    "information-disclosure",
  ),
  phpinfoPageExposed: def(
    "phpinfo() Page Exposed",
    "high",
    "information-disclosure",
  ),
  phpinfoPageExposedInfoPhp: def(
    "phpinfo() Page Exposed (info.php)",
    "high",
    "information-disclosure",
  ),
  dockerComposeFileExposed: def(
    "Docker Compose File Exposed",
    "medium",
    "information-disclosure",
  ),
  phpmyadminAdminPanelExposed: def(
    "phpMyAdmin Admin Panel Exposed",
    "high",
    "information-disclosure",
  ),
  adminerDatabaseAdminPanelExposed: def(
    "Adminer Database Admin Panel Exposed",
    "high",
    "information-disclosure",
  ),
  databaseDumpFileExposed: def(
    "Database Dump File Exposed",
    "critical",
    "information-disclosure",
  ),
  terraformStateFileExposed: def(
    "Terraform State File Exposed",
    "critical",
    "information-disclosure",
  ),
  wordpressUserEnumerationViaRestApi: def(
    "WordPress User Enumeration via REST API",
    "medium",
    "information-disclosure",
  ),
  prometheusMetricsEndpointExposed: def(
    "Prometheus Metrics Endpoint Exposed",
    "medium",
    "information-disclosure",
  ),
  npmConfigurationFileExposedNpmrc: def(
    "npm Configuration File Exposed (.npmrc)",
    "critical",
    "information-disclosure",
  ),
  productionEnvironmentFileExposedEnvProduction: def(
    "Production Environment File Exposed (.env.production)",
    "critical",
    "information-disclosure",
  ),
  iisWebConfigFileExposed: def(
    "IIS web.config File Exposed",
    "high",
    "information-disclosure",
  ),
  debugLogFilePubliclyAccessible: def(
    "Debug Log File Publicly Accessible",
    "medium",
    "information-disclosure",
  ),
  npmLockfileExposedPackageLockJson: def(
    "npm Lockfile Exposed (package-lock.json)",
    "low",
    "information-disclosure",
  ),
  jenkinsCiPanelExposed: def(
    "Jenkins CI Panel Exposed",
    "high",
    "information-disclosure",
  ),
  hashicorpConsulUiExposed: def(
    "HashiCorp Consul UI Exposed",
    "high",
    "information-disclosure",
  ),
  minioObjectStorageConsoleExposed: def(
    "MinIO Object Storage Console Exposed",
    "high",
    "information-disclosure",
  ),
  rabbitmqManagementInterfaceExposed: def(
    "RabbitMQ Management Interface Exposed",
    "medium",
    "information-disclosure",
  ),

  // Publicly listable object-storage buckets, one per provider
  publiclyListableAwsS3Bucket: def(
    "Publicly Listable AWS S3 Bucket",
    "high",
    "information-disclosure",
  ),
  publiclyListableGoogleCloudStorageBucket: def(
    "Publicly Listable Google Cloud Storage Bucket",
    "high",
    "information-disclosure",
  ),
  publiclyListableAzureBlobStorageBucket: def(
    "Publicly Listable Azure Blob Storage Bucket",
    "high",
    "information-disclosure",
  ),
} as const;
