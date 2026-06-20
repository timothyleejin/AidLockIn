"use client";

import { ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAppState } from "./providers";

const ROLE_LABELS: Record<string, string> = {
  FIELD: "Field worker",
  COORDINATOR: "Coordinator",
  DONOR: "Donor",
  ADMIN: "Admin",
};

export function Topbar({ title }: { title: string }) {
  const { events, eventId, setEventId, identity, role } = useAppState();
  const [open, setOpen] = useState(false);
  const currentEvent = events.find((e) => e.id === eventId);

  const initials = identity.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);

  return (
    <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-border bg-surface px-6">
      <div className="flex items-center gap-4">
        <h1 className="text-[17px] font-semibold text-ink">{title}</h1>
        {currentEvent && (
          <div className="relative">
            <button
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-2 rounded-full border border-border bg-surface-muted px-3 py-1.5 text-sm font-medium text-ink-muted hover:text-ink"
            >
              {currentEvent.name}
              <ChevronsUpDown className="h-3.5 w-3.5" />
            </button>
            {open && (
              <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
                {events.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => {
                      setEventId(ev.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "block w-full rounded-lg px-3 py-2 text-left text-sm",
                      ev.id === eventId ? "bg-primary-tint text-primary" : "text-ink hover:bg-surface-muted"
                    )}
                  >
                    <div className="font-medium">{ev.name}</div>
                    <div className="text-xs text-ink-faint">{ev.region ?? "—"} · {ev.status}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {currentEvent && currentEvent.status === "ACTIVE" && (
          <div className="flex items-center gap-1.5 rounded-full bg-success-tint px-3 py-1.5 text-xs font-medium text-success">
            <span className="alk-live-dot h-1.5 w-1.5 rounded-full bg-success" />
            Live · {currentEvent.partner_count ?? 0} partners
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 rounded-full border border-border bg-surface-muted px-3 py-1.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-tint text-xs font-semibold text-primary">
          {initials}
        </div>
        <div className="text-xs">
          <div className="font-medium text-ink">{ROLE_LABELS[role]} · {identity.name}</div>
          <div className="text-ink-faint">{identity.orgName}{identity.orgType !== "ADMIN" ? ` · ${identity.orgType}` : ""}</div>
        </div>
      </div>
    </header>
  );
}
