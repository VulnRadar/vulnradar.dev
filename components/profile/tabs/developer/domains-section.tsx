"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/ui/utils";
import { copyToClipboard } from "@/lib/ui/clipboard";
import { API } from "@/lib/config/constants";
import {
  Plus,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Loader2,
  Copy,
  Check,
  ChevronDown,
} from "lucide-react";

type DomainStatus = "pending" | "verified" | "failed" | "reverify_failed";

interface DomainItem {
  id: number;
  domain: string;
  team_id: number | null;
  status: DomainStatus;
  verification_method: string;
  created_at: string;
  verified_at: string | null;
  last_checked_at: string | null;
  last_check_error: string | null;
  verificationRecordName: string;
  /** Only present on the create response (a fresh add or a re-add of an
   *  already-pending domain) -- the token itself is never returned by the
   *  list endpoint, same "shown when relevant, not stored client-side
   *  forever" contract as a webhook's signing secret. */
  verificationRecordValue?: string;
}

interface DomainsSectionProps {
  setError: (message: string | null) => void;
  setSuccess: (message: string | null) => void;
}

function statusMeta(status: DomainStatus) {
  switch (status) {
    case "verified":
      return {
        label: "Verified",
        icon: ShieldCheck,
        className:
          "bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.25)]",
      };
    case "reverify_failed":
      return {
        label: "Needs re-verification",
        icon: ShieldAlert,
        className:
          "bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.25)]",
      };
    case "failed":
      return {
        label: "Not verified",
        icon: ShieldQuestion,
        className: "bg-muted text-muted-foreground border-border",
      };
    case "pending":
    default:
      return {
        label: "Pending",
        icon: ShieldQuestion,
        className: "bg-muted text-muted-foreground border-border",
      };
  }
}

/**
 * Domains sub-section of the Developer tab. Self-contained (fetches and
 * owns its own list) rather than routed through the shell's shared state
 * like API Keys/Webhooks/Schedules: domain verification doesn't share any
 * state with those three, so lifting it to the shell would only add
 * prop-drilling with nothing to show for it. Its own delete confirmation
 * dialog follows for the same reason.
 */
export function DomainsSection({ setError, setSuccess }: DomainsSectionProps) {
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDomain, setNewDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DomainItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(API.DOMAINS);
        const data = await res.json();
        if (!cancelled && res.ok) {
          setDomains(data.domains ?? []);
        }
      } catch {
        // Non-fatal: the section just shows an empty list, same as
        // WebhooksSection's own silent-fail-to-empty on a load error.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAddDomain() {
    if (!newDomain.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(API.DOMAINS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: newDomain.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setDomains((prev) => {
          const withoutDuplicate = prev.filter((d) => d.id !== data.id);
          return [
            {
              id: data.id,
              domain: data.domain,
              team_id: null,
              status: data.status,
              verification_method: "dns_txt",
              created_at: data.createdAt ?? new Date().toISOString(),
              verified_at: null,
              last_checked_at: null,
              last_check_error: null,
              verificationRecordName: data.verificationRecordName,
              verificationRecordValue: data.verificationRecordValue,
            },
            ...withoutDuplicate,
          ];
        });
        setExpandedId(data.id);
        setNewDomain("");
        setSuccess(
          data.alreadyExists
            ? "That domain is already on your list."
            : "Domain added. Publish the DNS record below to verify it.",
        );
      } else {
        setError(data.error || "Failed to add domain.");
      }
    } catch {
      setError("Failed to add domain.");
    }
    setAdding(false);
  }

  async function handleVerifyNow(domain: DomainItem) {
    setVerifyingId(domain.id);
    setError(null);
    try {
      const res = await fetch(`${API.DOMAINS}/${domain.id}/verify`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setDomains((prev) =>
          prev.map((d) =>
            d.id === domain.id
              ? {
                  ...d,
                  status: data.status,
                  verified_at: data.verified
                    ? new Date().toISOString()
                    : d.verified_at,
                  last_checked_at: new Date().toISOString(),
                  last_check_error: data.verified ? null : (data.error ?? null),
                }
              : d,
          ),
        );
        if (data.verified) {
          setSuccess(`${domain.domain} is verified.`);
          setExpandedId(null);
        } else {
          setError(
            data.error ||
              "Verification failed. Check the DNS record and try again.",
          );
        }
      } else {
        setError(data.error || "Failed to check verification.");
      }
    } catch {
      setError("Failed to check verification.");
    }
    setVerifyingId(null);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`${API.DOMAINS}?id=${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setDomains((prev) => prev.filter((d) => d.id !== deleteTarget.id));
        setSuccess(`${deleteTarget.domain} removed.`);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to remove domain.");
      }
    } catch {
      setError("Failed to remove domain.");
    }
    setDeleting(false);
    setDeleteTarget(null);
  }

  async function handleCopy(field: string, value: string) {
    if (await copyToClipboard(value)) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Verified domains
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5 max-w-prose leading-relaxed">
          Prove you control a domain by publishing a DNS TXT record. Verifying a
          domain covers every subdomain under it, and is required before Active
          Probing (real SQLi/XSS/SSTI canary payloads submitted to the target)
          can run against it.
        </p>
      </div>

      <Card className="border-border/50 bg-card/50">
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2 p-4 rounded-lg border border-border bg-secondary/30">
            <div className="flex-1 min-w-0">
              <Label htmlFor="domain-input" className="sr-only">
                Domain
              </Label>
              <Input
                id="domain-input"
                placeholder="example.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddDomain();
                }}
                className="bg-card h-10 w-full"
              />
            </div>
            <Button
              disabled={!newDomain.trim() || adding}
              onClick={handleAddDomain}
              className="shrink-0"
            >
              {adding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              <span className="ml-1.5">Add domain</span>
            </Button>
          </div>

          {loading ? (
            <div className="py-6 flex justify-center">
              <Loader2
                className="h-5 w-5 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
            </div>
          ) : domains.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2 max-w-prose leading-relaxed">
              No domains yet. Add one above to unlock Active Probing against it
              (and everything under it) once you've proven you control it.
            </p>
          ) : (
            <div className="rounded-lg border border-border divide-y divide-border/60 overflow-hidden">
              {domains.map((d) => {
                const meta = statusMeta(d.status);
                const StatusIcon = meta.icon;
                const isExpanded = expandedId === d.id;
                const needsRecord = d.status !== "verified";

                return (
                  <div key={d.id}>
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                      <StatusIcon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          d.status === "verified"
                            ? "text-[hsl(var(--success))]"
                            : "text-muted-foreground",
                        )}
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground truncate">
                            {d.domain}
                          </p>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] px-1.5 py-0",
                              meta.className,
                            )}
                          >
                            {meta.label}
                          </Badge>
                        </div>
                        {d.status === "verified" && d.verified_at && (
                          <p className="text-xs text-muted-foreground">
                            Verified{" "}
                            {new Date(d.verified_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {needsRecord && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-xs"
                            onClick={() =>
                              setExpandedId(isExpanded ? null : d.id)
                            }
                          >
                            DNS record
                            <ChevronDown
                              className={cn(
                                "h-3.5 w-3.5 transition-transform",
                                isExpanded && "rotate-180",
                              )}
                              aria-hidden="true"
                            />
                          </Button>
                        )}
                        {needsRecord && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-primary hover:text-primary hover:bg-primary/10"
                            disabled={verifyingId === d.id}
                            onClick={() => handleVerifyNow(d)}
                          >
                            {verifyingId === d.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              "Verify now"
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteTarget(d)}
                          title="Remove domain"
                          aria-label={`Remove domain ${d.domain}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {isExpanded && needsRecord && (
                      <div className="px-4 pb-4 pt-1 bg-muted/20 flex flex-col gap-3">
                        {d.last_check_error && (
                          <p className="text-xs text-destructive">
                            {d.last_check_error}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Add a TXT record at this name:
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 min-w-0 rounded-md border border-border bg-card px-2.5 py-2 font-mono text-xs text-foreground overflow-x-auto whitespace-nowrap">
                            {d.verificationRecordName}
                          </code>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() =>
                              handleCopy(
                                `name-${d.id}`,
                                d.verificationRecordName,
                              )
                            }
                            title="Copy record name"
                            aria-label="Copy record name"
                          >
                            {copiedField === `name-${d.id}` ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                        {d.verificationRecordValue ? (
                          <>
                            <p className="text-xs text-muted-foreground">
                              With this value:
                            </p>
                            <div className="flex items-center gap-2">
                              <code className="flex-1 min-w-0 rounded-md border border-border bg-card px-2.5 py-2 font-mono text-xs text-foreground overflow-x-auto whitespace-nowrap">
                                {d.verificationRecordValue}
                              </code>
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                onClick={() =>
                                  handleCopy(
                                    `value-${d.id}`,
                                    d.verificationRecordValue!,
                                  )
                                }
                                title="Copy record value"
                                aria-label="Copy record value"
                              >
                                {copiedField === `value-${d.id}` ? (
                                  <Check className="h-3.5 w-3.5" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">
                            The record value was only shown when this domain was
                            added. If you lost it, remove and re-add the domain
                            for a fresh one.
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          DNS changes can take a few minutes to propagate. Click
                          &quot;Verify now&quot; once it&apos;s live.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.domain}?</AlertDialogTitle>
            <AlertDialogDescription>
              Active Probing will no longer be allowed against this domain (or
              its subdomains) until it&apos;s verified again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              className="gap-2"
            >
              {deleting && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Remove domain
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
