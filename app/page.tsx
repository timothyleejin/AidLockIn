"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, Zap, ScrollText, ArrowRight, Users, ShieldAlert, Boxes } from "lucide-react";
import { Topbar } from "@/components/app-shell/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAppState } from "@/components/app-shell/providers";
import { BrandLogo } from "@/components/app-shell/brand";
import { formatRelativeTime, cn } from "@/lib/utils";
import { ACTION_META, TONE_ICON_BG, TONE_ICON_TEXT } from "@/components/audit-meta";
import { StatTile } from "@/components/stat-tile";
import type { StatsResponse } from "@/lib/types";

const FEATURES = [
  {
    icon: ShieldCheck,
    title: "One entitlement, everywhere",
    body: "A household's claim is checked against a single unique record shared by every partner organization — not five separate spreadsheets that drift out of sync.",
  },
  {
    icon: Zap,
    title: "Race-safe by construction",
    body: "Two field stations can hit the same shelter bed at the exact same instant. The database — not application code — decides who wins, and the loser sees a clean denial in milliseconds.",
  },
  {
    icon: ScrollText,
    title: "Every decision, audited",
    body: "Approvals and denials are both written to a hash-chained log the moment they happen, so a donor or auditor can verify nothing was edited after the fact.",
  },
];

export default function OverviewPage() {
  const { eventId, refreshKey } = useAppState();
  const [stats, setStats] = useState<StatsResponse | null>(null);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/stats?eventId=${eventId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => {});
  }, [eventId, refreshKey]);

  return (
    <div>
      <Topbar title="Overview" />
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="alk-card relative overflow-hidden p-10">
          <div className="max-w-2xl">
            <BrandLogo variant="hero" />
            <span className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-primary-tint px-3 py-1 text-xs font-semibold text-primary">
              Aurora DSQL + Vercel
            </span>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-ink">
              Allocate scarce aid once. Prove it everywhere.
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
              AidLockIn gives every partner organization in a disaster response a shared, real-time view of what
              a household has already received — so the same family can&apos;t draw two food packs from two NGOs,
              and the last shelter bed can&apos;t go to two people at once.
            </p>
            <div className="mt-6 flex gap-3">
              <Link href="/field">
                <Button size="lg">
                  Open field allocate <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/race-demo">
                <Button variant="secondary" size="lg">
                  Watch the race demo
                </Button>
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title}>
              <CardContent>
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary-tint text-primary">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="text-[15px] font-semibold text-ink">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{f.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
          <StatTile icon={Users} label="Households helped" value={stats?.householdsHelped} />
          <StatTile icon={ShieldAlert} label="Duplicates prevented" value={stats?.duplicatesPrevented} />
          <StatTile icon={Boxes} label="Partner orgs" value={stats?.partnerOrgs} />
          <StatTile icon={ScrollText} label="Total allocations" value={stats?.totalAllocations} />
        </div>

        {stats && stats.recentActivity.length > 0 && (
          <Card className="mt-6">
            <CardContent className="p-0">
              <div className="border-b border-border px-5 py-4">
                <h3 className="text-[15px] font-semibold text-ink">Recent activity</h3>
              </div>
              <div className="divide-y divide-border">
                {stats.recentActivity.slice(0, 6).map((entry) => {
                  const meta = ACTION_META[entry.action];
                  return (
                    <div key={entry.id} className="flex items-center gap-3 px-5 py-3">
                      <div
                        className={cn(
                          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg",
                          TONE_ICON_BG[meta.tone],
                          TONE_ICON_TEXT[meta.tone]
                        )}
                      >
                        <meta.icon className="h-4 w-4" />
                      </div>
                      <p className="flex-1 truncate text-sm text-ink">{entry.detail}</p>
                      <span className="flex-shrink-0 text-xs text-ink-faint">
                        {formatRelativeTime(entry.created_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
