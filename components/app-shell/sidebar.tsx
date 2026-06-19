"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Home,
  LayoutDashboard,
  QrCode,
  Zap,
  Layers,
  CalendarPlus,
  ShieldAlert,
  ScrollText,
  BarChart3,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppState } from "./providers";
import type { DemoRole } from "@/lib/types";

const NAV_ITEMS: { href: string; label: string; icon: typeof Home; badgeKey?: "pendingOverrides" }[] = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/field", label: "Field allocate", icon: QrCode },
  { href: "/race-demo", label: "Race demo", icon: Zap },
  { href: "/pools", label: "Pools & policies", icon: Layers },
  { href: "/events/new", label: "New event", icon: CalendarPlus },
  { href: "/overrides", label: "Overrides", icon: ShieldAlert, badgeKey: "pendingOverrides" },
  { href: "/audit", label: "Audit log", icon: ScrollText },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

const ROLE_OPTIONS: { value: DemoRole; label: string }[] = [
  { value: "FIELD", label: "Field" },
  { value: "COORDINATOR", label: "Coordinator" },
  { value: "DONOR", label: "Donor" },
  { value: "ADMIN", label: "Admin" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { role, setRole, eventId, refreshKey } = useAppState();
  const [pendingOverrides, setPendingOverrides] = useState(0);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/stats?eventId=${eventId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setPendingOverrides(data.pendingOverrides ?? 0);
      })
      .catch(() => {});
  }, [eventId, refreshKey, pathname]);

  return (
    <aside className="flex h-full w-64 flex-shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-ink">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <div className="text-[15px] font-semibold leading-none text-ink">AidLockIn</div>
          <div className="text-xs text-ink-faint">Allocate once, everywhere</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const badge = item.badgeKey === "pendingOverrides" ? pendingOverrides : undefined;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition",
                active ? "bg-primary-tint text-primary" : "text-ink-muted hover:bg-surface-muted hover:text-ink"
              )}
            >
              <item.icon className="h-[18px] w-[18px]" />
              <span className="flex-1">{item.label}</span>
              {!!badge && (
                <span className="rounded-full bg-warning-tint px-1.5 py-0.5 text-xs font-semibold text-warning">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-4 py-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">View as</div>
        <div className="grid grid-cols-2 gap-1.5">
          {ROLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRole(opt.value)}
              className={cn(
                "rounded-lg px-2 py-1.5 text-xs font-medium transition",
                role === opt.value
                  ? "bg-primary text-primary-ink"
                  : "bg-surface-muted text-ink-muted hover:text-ink"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">Demo control · no real login</p>
      </div>
    </aside>
  );
}
