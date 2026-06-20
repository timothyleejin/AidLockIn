"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DemoRole, DisasterEvent, Organization } from "@/lib/types";

interface Identity {
  name: string;
  orgId: string | null;
  orgName: string;
  orgType: string;
}

interface AppState {
  role: DemoRole;
  setRole: (role: DemoRole) => void;
  identity: Identity;
  events: DisasterEvent[];
  eventId: string | null;
  setEventId: (id: string) => void;
  organizations: Organization[];
  loading: boolean;
  /** Bump after any mutation so dependent views know to refetch. */
  refreshKey: number;
  refresh: () => void;
  reloadEvents: () => Promise<void>;
}

const AppStateContext = createContext<AppState | null>(null);

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}

const ROLE_NAMES: Record<DemoRole, string> = {
  FIELD: "A. Yusuf",
  COORDINATOR: "M. Tanaka",
  DONOR: "Donor Partner",
  ADMIN: "System Admin",
};

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<DemoRole>("FIELD");
  const [events, setEvents] = useState<DisasterEvent[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const reloadEvents = useCallback(async () => {
    const res = await fetch("/api/events");
    if (!res.ok) return;
    const data: DisasterEvent[] = await res.json();
    setEvents(data);
    setEventId((current) => current ?? data.find((e) => e.status === "ACTIVE")?.id ?? data[0]?.id ?? null);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await reloadEvents();
      const orgRes = await fetch("/api/organizations");
      if (orgRes.ok) setOrganizations(await orgRes.json());
      setLoading(false);
    })();
  }, [reloadEvents]);

  const identity = useMemo<Identity>(() => {
    const name = ROLE_NAMES[role];
    if (role === "ADMIN") return { name, orgId: null, orgName: "AidLockIn HQ", orgType: "ADMIN" };
    if (role === "DONOR") {
      const org = organizations.find((o) => o.org_type === "DONOR") ?? organizations[0];
      return { name, orgId: org?.id ?? null, orgName: org?.name ?? "Donor", orgType: org?.org_type ?? "DONOR" };
    }
    if (role === "COORDINATOR") {
      const org = organizations.find((o) => o.org_type === "GOV") ?? organizations[0];
      return { name, orgId: org?.id ?? null, orgName: org?.name ?? "Coordination", orgType: org?.org_type ?? "GOV" };
    }
    const org = organizations.find((o) => o.org_type === "NGO") ?? organizations[0];
    return { name, orgId: org?.id ?? null, orgName: org?.name ?? "Field Org", orgType: org?.org_type ?? "NGO" };
  }, [role, organizations]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const value: AppState = {
    role,
    setRole,
    identity,
    events,
    eventId,
    setEventId,
    organizations,
    loading,
    refreshKey,
    refresh,
    reloadEvents,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
