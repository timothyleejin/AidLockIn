"use client";

import { useEffect, useState } from "react";
import { Download, ShieldCheck, ShieldX } from "lucide-react";
import { Topbar } from "@/components/app-shell/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { useAppState } from "@/components/app-shell/providers";
import { formatRelativeTime, shortHash, cn } from "@/lib/utils";
import { ACTION_META, TONE_ICON_BG, TONE_ICON_TEXT } from "@/components/audit-meta";
import type { AuditEventRow } from "@/lib/types";

type Filter = "ALL" | "APPROVED" | "DENIED" | "OVERRIDES";

export default function AuditPage() {
  const { eventId, refreshKey } = useAppState();
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/audit?eventId=${eventId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setEvents(data.events);
        setVerified(data.verified);
      })
      .catch(() => {});
  }, [eventId, refreshKey]);

  const filtered = events.filter((e) => {
    if (filter === "ALL") return true;
    if (filter === "APPROVED") return e.action === "ALLOCATION_APPROVED";
    if (filter === "DENIED") return e.action.startsWith("ALLOCATION_DENIED");
    return e.action.startsWith("OVERRIDE");
  });

  return (
    <div>
      <Topbar title="Audit log" />
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Tabs<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "ALL", label: "All", count: events.length },
              { value: "APPROVED", label: "Approved" },
              { value: "DENIED", label: "Denied" },
              { value: "OVERRIDES", label: "Overrides" },
            ]}
          />
          <div className="flex items-center gap-2">
            {verified !== null && (
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
                  verified ? "bg-success-tint text-success" : "bg-danger-tint text-danger"
                )}
              >
                {verified ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldX className="h-3.5 w-3.5" />}
                {verified ? "Verified · unbroken chain" : "Chain verification failed"}
              </span>
            )}
            {eventId && (
              <a href={`/api/export?eventId=${eventId}`}>
                <Button variant="secondary" size="sm">
                  <Download className="h-3.5 w-3.5" /> Export
                </Button>
              </a>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Actor</th>
                    <th className="px-4 py-3">Household</th>
                    <th className="px-4 py-3">Detail</th>
                    <th className="px-4 py-3">Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((entry) => {
                    const meta = ACTION_META[entry.action];
                    return (
                      <tr key={entry.id}>
                        <td className="px-4 py-3 text-ink-faint">{entry.audit_no}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-faint">
                          {formatRelativeTime(entry.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                              TONE_ICON_BG[meta.tone],
                              TONE_ICON_TEXT[meta.tone]
                            )}
                          >
                            <meta.icon className="h-3 w-3" /> {meta.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink">
                          {entry.actor_name}
                          {entry.organization_name && (
                            <span className="text-ink-faint"> · {entry.organization_name}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink">
                          {entry.household_claim_code ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-ink-muted">{entry.detail}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-faint">
                          {shortHash(entry.hash)}
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-ink-faint">
                        No entries for this filter yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
