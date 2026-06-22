"use client";

import { useEffect, useMemo, useState } from "react";
import { Users, ShieldAlert, Boxes, ScrollText, ShieldCheck, ShieldX, Download } from "lucide-react";
import { Topbar } from "@/components/app-shell/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/stat-tile";
import { useAppState } from "@/components/app-shell/providers";
import { getAidTypeIcon } from "@/components/icons";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { AuditEventRow, StatsResponse } from "@/lib/types";
import type { DuplicatePattern } from "@/lib/patterns";

export default function ReportsPage() {
  const { eventId, refreshKey } = useAppState();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEventRow[]>([]);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [patterns, setPatterns] = useState<DuplicatePattern[]>([]);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/stats?eventId=${eventId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => {});
    fetch(`/api/patterns?eventId=${eventId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setPatterns)
      .catch(() => {});
    fetch(`/api/audit?eventId=${eventId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setAuditEvents(data.events);
        setVerified(data.verified);
      })
      .catch(() => {});
  }, [eventId, refreshKey]);

  const byOrg = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of auditEvents) {
      if (entry.action !== "ALLOCATION_APPROVED" || !entry.organization_name) continue;
      counts.set(entry.organization_name, (counts.get(entry.organization_name) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [auditEvents]);

  const maxOrgCount = Math.max(1, ...byOrg.map((o) => o.count));

  return (
    <div>
      <Topbar title="Reports" />
      <div className="mx-auto max-w-4xl px-6 py-8">
        <Card className="mb-6">
          <CardContent>
            <h2 className="text-lg font-semibold text-ink">Impact report</h2>
            <p className="mt-1 text-sm text-ink-muted">
              A donor- and government-facing summary of what this response has delivered, with every number
              traceable back to the underlying audit chain.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <StatTile icon={Users} label="Households helped" value={stats?.householdsHelped} />
          <StatTile icon={ShieldAlert} label="Duplicates prevented" value={stats?.duplicatesPrevented} />
          <StatTile icon={Boxes} label="Partner orgs" value={stats?.partnerOrgs} />
          <StatTile icon={ScrollText} label="Total allocations" value={stats?.totalAllocations} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardContent>
              <h3 className="mb-4 text-[15px] font-semibold text-ink">Allocations by partner organization</h3>
              <div className="space-y-3">
                {byOrg.map((org) => (
                  <div key={org.name}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-ink">{org.name}</span>
                      <span className="text-xs text-ink-faint">{org.count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(org.count / maxOrgCount) * 100}%` }} />
                    </div>
                  </div>
                ))}
                {byOrg.length === 0 && <p className="text-sm text-ink-faint">No allocations recorded yet.</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <h3 className="mb-4 text-[15px] font-semibold text-ink">Allocations by aid type</h3>
              <div className="space-y-3">
                {stats?.byAidType.map((row) => {
                  const Icon = getAidTypeIcon(row.icon);
                  return (
                    <div key={row.aidTypeName} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-ink">
                        <Icon className="h-4 w-4 text-ink-muted" /> {row.aidTypeName}
                      </span>
                      <span className="font-medium text-ink">{row.approved}</span>
                    </div>
                  );
                })}
                {!stats?.byAidType.length && <p className="text-sm text-ink-faint">Nothing to report yet.</p>}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-6">
          <CardContent>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-warning" />
              <h3 className="text-[15px] font-semibold text-ink">Repeat duplicate-claim patterns</h3>
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              Households the duplicate guard blocked more than once. Each block already happened — this
              flags the repeats for a coordinator to review.
            </p>
            <div className="mt-4 space-y-2">
              {patterns.map((p) => (
                <div
                  key={p.householdClaimCode}
                  className="flex items-center justify-between rounded-lg border border-warning-border bg-warning-tint px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono font-medium text-ink">{p.householdClaimCode}</span>
                    <span className="text-xs text-ink-muted">
                      across {p.aidTypesAttempted} aid type{p.aidTypesAttempted === 1 ? "" : "s"} ·{" "}
                      last {formatRelativeTime(p.lastAttemptAt)}
                    </span>
                  </div>
                  <span className="rounded-full bg-warning px-2 py-0.5 text-xs font-semibold text-white">
                    {p.deniedDuplicateCount} blocked
                  </span>
                </div>
              ))}
              {patterns.length === 0 && (
                <p className="text-sm text-ink-faint">No repeat duplicate patterns detected.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardContent className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-xl",
                  verified ? "bg-success-tint text-success" : "bg-danger-tint text-danger"
                )}
              >
                {verified ? <ShieldCheck className="h-5 w-5" /> : <ShieldX className="h-5 w-5" />}
              </div>
              <div>
                <h4 className="text-sm font-semibold text-ink">
                  {verified === null ? "Checking audit chain..." : verified ? "Audit chain verified" : "Audit chain verification failed"}
                </h4>
                <p className="text-xs text-ink-faint">
                  Every approval and denial above is backed by a hash-chained, append-only log.
                </p>
              </div>
            </div>
            {eventId && (
              <a href={`/api/export?eventId=${eventId}`}>
                <Button variant="secondary" size="sm">
                  <Download className="h-3.5 w-3.5" /> Export full log
                </Button>
              </a>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
