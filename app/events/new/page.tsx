"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { Topbar } from "@/components/app-shell/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppState } from "@/components/app-shell/providers";
import { cn } from "@/lib/utils";
import type { EventStatus, Organization } from "@/lib/types";

export default function NewEventPage() {
  const router = useRouter();
  const { identity, role, setEventId, reloadEvents } = useAppState();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [status, setStatus] = useState<EventStatus>("ACTIVE");
  const [selectedOrgIds, setSelectedOrgIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/organizations")
      .then((r) => (r.ok ? r.json() : []))
      .then(setOrganizations)
      .catch(() => {});
  }, []);

  function toggleOrg(id: string) {
    setSelectedOrgIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          region: region.trim() || null,
          status,
          partnerOrgIds: Array.from(selectedOrgIds),
          actorName: identity.name,
          actorRole: role,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create event");
      await reloadEvents();
      setEventId(data.id);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <Topbar title="New event" />
      <div className="mx-auto max-w-2xl px-6 py-8">
        <Card>
          <CardContent className="space-y-5">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Event name
              </label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Typhoon Nari · Kanto Response" />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Region
              </label>
              <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Kanto, Japan" />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Status
              </label>
              <div className="flex gap-2">
                <button
                  data-active={status === "ACTIVE"}
                  className="alk-chip-toggle"
                  onClick={() => setStatus("ACTIVE")}
                >
                  Active
                </button>
                <button
                  data-active={status === "CLOSED"}
                  className="alk-chip-toggle"
                  onClick={() => setStatus("CLOSED")}
                >
                  Closed
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Partner organizations
              </label>
              <div className="flex flex-wrap gap-2">
                {organizations.map((org) => (
                  <button
                    key={org.id}
                    data-active={selectedOrgIds.has(org.id)}
                    className={cn("alk-chip-toggle")}
                    onClick={() => toggleOrg(org.id)}
                  >
                    {org.name}
                    <span className="ml-1.5 text-ink-faint">· {org.org_type}</span>
                  </button>
                ))}
                {organizations.length === 0 && (
                  <p className="text-sm text-ink-faint">No organizations available yet.</p>
                )}
              </div>
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}

            <Button loading={submitting} disabled={!name.trim()} onClick={handleSubmit} className="w-full">
              <CalendarPlus className="h-4 w-4" /> Create event
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
