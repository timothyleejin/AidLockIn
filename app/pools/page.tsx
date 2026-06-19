"use client";

import { useEffect, useState } from "react";
import { Plus, ChevronDown, ChevronUp } from "lucide-react";
import { Topbar } from "@/components/app-shell/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useAppState } from "@/components/app-shell/providers";
import { getAidTypeIcon, AID_TYPE_ICON_OPTIONS } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { AidType, ResourceModel, WindowType } from "@/lib/types";

export default function PoolsPage() {
  const { eventId, identity, role, refresh, refreshKey } = useAppState();
  const [aidTypes, setAidTypes] = useState<AidType[]>([]);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/aid-types?eventId=${eventId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setAidTypes)
      .catch(() => {});
  }, [eventId, refreshKey]);

  return (
    <div>
      <Topbar title="Pools & policies" />
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {aidTypes.map((aidType) => (
            <AidTypeCard key={aidType.id} aidType={aidType} />
          ))}
        </div>

        <Card className="mt-6">
          <button
            onClick={() => setFormOpen((o) => !o)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <span className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <Plus className="h-4 w-4" /> Add aid type
            </span>
            {formOpen ? <ChevronUp className="h-4 w-4 text-ink-faint" /> : <ChevronDown className="h-4 w-4 text-ink-faint" />}
          </button>
          {formOpen && eventId && (
            <CardContent className="border-t border-border">
              <NewAidTypeForm
                eventId={eventId}
                actorName={identity.name}
                actorRole={role}
                onCreated={() => {
                  setFormOpen(false);
                  refresh();
                }}
              />
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}

function AidTypeCard({ aidType }: { aidType: AidType }) {
  const Icon = getAidTypeIcon(aidType.icon);
  const isPool = aidType.resource_model === "POOL";
  const pct = isPool && aidType.total_quantity
    ? Math.round(((aidType.remaining_quantity ?? 0) / aidType.total_quantity) * 100)
    : 0;

  return (
    <Card>
      <CardContent>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-tint text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-ink">{aidType.name}</h3>
            <p className="text-xs text-ink-faint">{aidType.policy_description}</p>
          </div>
        </div>

        {isPool ? (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium text-ink">
                {aidType.remaining_quantity} remaining
              </span>
              <span className="text-xs text-ink-faint">of {aidType.total_quantity}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
              <div
                className={cn("h-full rounded-full", pct > 25 ? "bg-primary" : "bg-danger")}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-ink-faint">
              {aidType.available_count} available · {aidType.allocated_count} allocated
            </div>
            <div className="flex flex-wrap gap-1.5">
              {aidType.available_units?.map((u) => (
                <span
                  key={u.id}
                  className="rounded-full border border-success-border bg-success-tint px-2.5 py-1 text-xs font-medium text-success"
                >
                  {u.label}
                </span>
              ))}
              {Array.from({ length: aidType.allocated_count ?? 0 }).map((_, i) => (
                <span
                  key={`allocated-${i}`}
                  className="rounded-full border border-border bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-faint"
                >
                  allocated
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NewAidTypeForm({
  eventId,
  actorName,
  actorRole,
  onCreated,
}: {
  eventId: string;
  actorName: string;
  actorRole: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(AID_TYPE_ICON_OPTIONS[0].key);
  const [resourceModel, setResourceModel] = useState<ResourceModel>("POOL");
  const [windowType, setWindowType] = useState<WindowType>("DAYS");
  const [windowValue, setWindowValue] = useState("7");
  const [totalQuantity, setTotalQuantity] = useState("100");
  const [distributionPoint, setDistributionPoint] = useState("Chiba Central Hub");
  const [unitLabels, setUnitLabels] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/aid-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          name: name.trim(),
          code: name.trim(),
          icon,
          resourceModel,
          windowType,
          windowValue: windowType === "HOURS" || windowType === "DAYS" ? Number(windowValue) : null,
          totalQuantity: resourceModel === "POOL" ? Number(totalQuantity) : undefined,
          distributionPoint: resourceModel === "POOL" ? distributionPoint : undefined,
          unitLabels: resourceModel === "UNIT" ? unitLabels.split(",").map((l) => l.trim()).filter(Boolean) : undefined,
          actorName,
          actorRole,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Could not create aid type");
      }
      setName("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2">
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Blankets" />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">Icon</label>
        <Select value={icon} onChange={(e) => setIcon(e.target.value)}>
          {AID_TYPE_ICON_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Resource type
        </label>
        <Select value={resourceModel} onChange={(e) => setResourceModel(e.target.value as ResourceModel)}>
          <option value="POOL">Pool (fungible count)</option>
          <option value="UNIT">Named units</option>
        </Select>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Duplicate window
        </label>
        <div className="flex gap-2">
          <Select value={windowType} onChange={(e) => setWindowType(e.target.value as WindowType)} className="flex-1">
            <option value="HOURS">Every N hours</option>
            <option value="DAYS">Every N days</option>
            <option value="EVENT">Once per event</option>
            <option value="ACTIVE">One active at a time</option>
          </Select>
          {(windowType === "HOURS" || windowType === "DAYS") && (
            <Input
              type="number"
              value={windowValue}
              onChange={(e) => setWindowValue(e.target.value)}
              className="w-20"
            />
          )}
        </div>
      </div>

      {resourceModel === "POOL" ? (
        <>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Total quantity
            </label>
            <Input type="number" value={totalQuantity} onChange={(e) => setTotalQuantity(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Distribution point
            </label>
            <Input value={distributionPoint} onChange={(e) => setDistributionPoint(e.target.value)} />
          </div>
        </>
      ) : (
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Unit labels (comma separated)
          </label>
          <Textarea
            value={unitLabels}
            onChange={(e) => setUnitLabels(e.target.value)}
            placeholder="Bed B1, Bed B2, Bed B3"
          />
        </div>
      )}

      {error && <p className="sm:col-span-2 text-sm text-danger">{error}</p>}

      <div className="sm:col-span-2">
        <Button loading={submitting} disabled={!name.trim()} onClick={handleSubmit}>
          Create aid type
        </Button>
      </div>
    </div>
  );
}
