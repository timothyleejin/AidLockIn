"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, ShieldAlert, Boxes, ScrollText, ArrowRight } from "lucide-react";
import { Topbar } from "@/components/app-shell/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/stat-tile";
import { useAppState } from "@/components/app-shell/providers";
import { getAidTypeIcon } from "@/components/icons";
import { formatRelativeTime, cn } from "@/lib/utils";
import { ACTION_META, TONE_ICON_BG, TONE_ICON_TEXT } from "@/components/audit-meta";
import type { StatsResponse } from "@/lib/types";

export default function DashboardPage() {
  const { eventId, refreshKey } = useAppState();
  const [stats, setStats] = useState<StatsResponse | null>(null);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/stats?eventId=${eventId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => {});
  }, [eventId, refreshKey]);

  const maxApproved = Math.max(1, ...(stats?.byAidType.map((a) => a.approved + a.denied) ?? [1]));

  return (
    <div>
      <Topbar title="Dashboard" />
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <StatTile icon={Users} label="Households helped" value={stats?.householdsHelped} />
          <StatTile icon={ShieldAlert} label="Duplicates prevented" value={stats?.duplicatesPrevented} />
          <StatTile icon={Boxes} label="Partner orgs" value={stats?.partnerOrgs} />
          <StatTile icon={ScrollText} label="Total allocations" value={stats?.totalAllocations} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardContent>
              <h3 className="mb-4 text-[15px] font-semibold text-ink">Allocations by aid type</h3>
              <div className="space-y-4">
                {stats?.byAidType.map((row) => {
                  const Icon = getAidTypeIcon(row.icon);
                  const total = row.approved + row.denied;
                  const approvedPct = total ? (row.approved / maxApproved) * 100 : 0;
                  const deniedPct = total ? (row.denied / maxApproved) * 100 : 0;
                  return (
                    <div key={row.aidTypeName}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 font-medium text-ink">
                          <Icon className="h-4 w-4 text-ink-muted" /> {row.aidTypeName}
                        </span>
                        <span className="text-xs text-ink-faint">
                          {row.approved} allocated · {row.denied} denied
                        </span>
                      </div>
                      <div className="flex h-2 overflow-hidden rounded-full bg-surface-muted">
                        <div className="bg-success" style={{ width: `${approvedPct}%` }} />
                        <div className="bg-danger" style={{ width: `${deniedPct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {!stats?.byAidType.length && (
                  <p className="text-sm text-ink-faint">No allocations recorded for this event yet.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h3 className="text-[15px] font-semibold text-ink">Recent activity</h3>
                <Link href="/audit" className="flex items-center gap-1 text-xs font-medium text-primary">
                  Full log <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="max-h-[400px] divide-y divide-border overflow-y-auto">
                {stats?.recentActivity.map((entry) => {
                  const meta = ACTION_META[entry.action];
                  return (
                    <div key={entry.id} className="flex items-start gap-3 px-5 py-3">
                      <div
                        className={cn(
                          "mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg",
                          TONE_ICON_BG[meta.tone],
                          TONE_ICON_TEXT[meta.tone]
                        )}
                      >
                        <meta.icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm leading-snug text-ink">{entry.detail}</p>
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {entry.actor_name} · {formatRelativeTime(entry.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {!stats?.recentActivity.length && (
                  <p className="px-5 py-6 text-sm text-ink-faint">Nothing logged yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {!!stats?.pendingOverrides && (
          <Card className="mt-6 border-warning-border bg-warning-tint">
            <CardContent className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-warning">
                  {stats.pendingOverrides} override{stats.pendingOverrides === 1 ? "" : "s"} awaiting a decision
                </h4>
                <p className="text-xs text-warning/80">
                  Field workers are waiting on a coordinator to review these.
                </p>
              </div>
              <Link href="/overrides">
                <Button variant="secondary" size="sm">
                  Review <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
