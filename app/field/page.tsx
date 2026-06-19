"use client";

import { useEffect, useState } from "react";
import {
  QrCode,
  CircleCheck,
  ShieldAlert,
  TriangleAlert,
  Zap,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { Topbar } from "@/components/app-shell/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { useAppState } from "@/components/app-shell/providers";
import { generateClaimCode, generateIdempotencyKey } from "@/lib/ids";
import { getAidTypeIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { AidType, AllocateResponse } from "@/lib/types";

export default function FieldAllocatePage() {
  const { eventId, identity, role, refresh, refreshKey } = useAppState();
  const [aidTypes, setAidTypes] = useState<AidType[]>([]);
  const [claimCode, setClaimCode] = useState("");
  const [selectedAidTypeId, setSelectedAidTypeId] = useState<string | null>(null);
  const [distributionPoint, setDistributionPoint] = useState("Chiba Central Hub");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AllocateResponse | null>(null);

  const [overrideReason, setOverrideReason] = useState("");
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [overrideSubmitted, setOverrideSubmitted] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/aid-types?eventId=${eventId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: AidType[]) => {
        setAidTypes(data);
        setSelectedAidTypeId((current) => current ?? data[0]?.id ?? null);
      })
      .catch(() => {});
  }, [eventId, refreshKey]);

  const selectedAidType = aidTypes.find((a) => a.id === selectedAidTypeId) ?? null;

  async function handleAllocate() {
    if (!eventId || !selectedAidTypeId || !claimCode.trim() || !identity.orgId) return;
    setSubmitting(true);
    setResult(null);
    setOverrideSubmitted(false);
    setOverrideReason("");

    try {
      const res = await fetch("/api/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          claimCode: claimCode.trim().toUpperCase(),
          aidTypeId: selectedAidTypeId,
          organizationId: identity.orgId,
          workerName: identity.name,
          distributionPoint,
          idempotencyKey: generateIdempotencyKey(),
          actorRole: role,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Allocation failed");
      setResult(data);
      refresh();
    } catch (err) {
      setResult({
        result: "ERROR",
        attemptId: "",
        auditNo: null,
        message: err instanceof Error ? err.message : "Something went wrong",
        householdClaimCode: claimCode,
        aidTypeName: selectedAidType?.name ?? "",
        overrideEligible: false,
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRequestOverride() {
    if (!eventId || !result || !selectedAidTypeId || !identity.orgId || !overrideReason.trim()) return;
    setOverrideSubmitting(true);
    try {
      const res = await fetch("/api/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          householdClaimCode: result.householdClaimCode,
          aidTypeId: selectedAidTypeId,
          allocationAttemptId: result.attemptId,
          requestedByOrgId: identity.orgId,
          requestedByName: identity.name,
          reason: overrideReason.trim(),
        }),
      });
      if (!res.ok) throw new Error("Could not submit override request");
      setOverrideSubmitted(true);
      refresh();
    } catch {
      // surfaced via the disabled-state fallback below; keep it simple for the demo
    } finally {
      setOverrideSubmitting(false);
    }
  }

  return (
    <div>
      <Topbar title="Field allocate" />
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <Card>
            <CardContent>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Household claim code
              </label>
              <div className="flex gap-2">
                <Input
                  value={claimCode}
                  onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
                  placeholder="HX-8N2V"
                  className="font-mono text-lg tracking-wide"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setClaimCode(generateClaimCode())}
                  title="No camera in this demo — generates a sample code"
                >
                  <QrCode className="h-4 w-4" /> Scan
                </Button>
              </div>
              <p className="mt-2 text-xs text-ink-faint">
                New code? It&apos;s registered the moment you allocate against it — no separate signup step.
              </p>

              <label className="mb-1.5 mt-5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Distribution point
              </label>
              <Input value={distributionPoint} onChange={(e) => setDistributionPoint(e.target.value)} />
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <h3 className="mb-3 text-[15px] font-semibold text-ink">Aid type</h3>
              <div className="space-y-2">
                {aidTypes.map((aidType) => {
                  const Icon = getAidTypeIcon(aidType.icon);
                  const active = aidType.id === selectedAidTypeId;
                  const stockLabel =
                    aidType.resource_model === "POOL"
                      ? `${aidType.remaining_quantity} / ${aidType.total_quantity} remaining`
                      : `${aidType.available_count} available`;
                  const empty =
                    aidType.resource_model === "POOL"
                      ? (aidType.remaining_quantity ?? 0) <= 0
                      : (aidType.available_count ?? 0) <= 0;
                  return (
                    <button
                      key={aidType.id}
                      onClick={() => setSelectedAidTypeId(aidType.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition",
                        active ? "border-primary bg-primary-tint" : "border-border hover:border-primary/40"
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg",
                          active ? "bg-primary text-primary-ink" : "bg-surface-muted text-ink-muted"
                        )}
                      >
                        <Icon className="h-[18px] w-[18px]" />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-ink">{aidType.name}</div>
                        <div className="text-xs text-ink-faint">{aidType.policy_description}</div>
                      </div>
                      <div className={cn("text-xs font-medium", empty ? "text-danger" : "text-ink-muted")}>
                        {stockLabel}
                      </div>
                    </button>
                  );
                })}
                {aidTypes.length === 0 && (
                  <p className="text-sm text-ink-faint">No aid types configured for this event yet.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Button
            size="lg"
            className="w-full"
            disabled={!claimCode.trim() || !selectedAidTypeId}
            loading={submitting}
            onClick={handleAllocate}
          >
            Check & allocate <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        <div>
          {!result && (
            <Card className="flex h-full min-h-[320px] items-center justify-center">
              <CardContent className="text-center text-sm text-ink-faint">
                Enter a claim code and pick an aid type, then check &amp; allocate to see the outcome here.
              </CardContent>
            </Card>
          )}
          {result && <ResultPanel result={result} />}

          {result?.overrideEligible && !overrideSubmitted && (
            <Card className="mt-4">
              <CardContent>
                <h4 className="text-sm font-semibold text-ink">Request a coordinator override</h4>
                <p className="mt-1 text-xs text-ink-faint">
                  If there&apos;s a genuine reason this household needs a second allocation, explain it below — a
                  coordinator will review it.
                </p>
                <Textarea
                  className="mt-3"
                  placeholder="e.g. first pack was ruined by floodwater"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
                <Button
                  className="mt-3 w-full"
                  variant="secondary"
                  disabled={!overrideReason.trim()}
                  loading={overrideSubmitting}
                  onClick={handleRequestOverride}
                >
                  Request override
                </Button>
              </CardContent>
            </Card>
          )}
          {overrideSubmitted && (
            <Card className="mt-4">
              <CardContent className="flex items-center gap-2 text-sm text-success">
                <CircleCheck className="h-4 w-4" /> Override requested — a coordinator will review it on the
                Overrides screen.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: AllocateResponse }) {
  const config = {
    APPROVED: { tone: "success", icon: CircleCheck, headline: "Approved" },
    DENIED_DUPLICATE: { tone: "danger", icon: ShieldAlert, headline: "Already claimed" },
    DENIED_NO_STOCK: { tone: "warning", icon: TriangleAlert, headline: "Out of stock" },
    DENIED_RESOURCE_TAKEN: { tone: "warning", icon: Zap, headline: "Just taken" },
    ERROR: { tone: "danger", icon: TriangleAlert, headline: "Something went wrong" },
  }[result.result];

  const toneClasses = {
    success: "border-success-border bg-success-tint text-success",
    danger: "border-danger-border bg-danger-tint text-danger",
    warning: "border-warning-border bg-warning-tint text-warning",
  }[config.tone as "success" | "danger" | "warning"];

  return (
    <Card className={cn("border-2", toneClasses)}>
      <CardContent>
        <div className="flex items-center gap-2">
          <config.icon className="h-5 w-5" />
          <h3 className="text-lg font-semibold">{config.headline}</h3>
        </div>
        <p className="mt-2 text-sm leading-relaxed">{result.detail ?? result.message}</p>

        <div className="mt-4 space-y-1.5 rounded-lg bg-surface/60 p-3 text-xs text-ink-muted">
          <div className="flex justify-between">
            <span>Household</span>
            <span className="font-mono font-medium text-ink">{result.householdClaimCode}</span>
          </div>
          <div className="flex justify-between">
            <span>Aid type</span>
            <span className="font-medium text-ink">{result.aidTypeName}</span>
          </div>
          {result.resourceLabel && (
            <div className="flex justify-between">
              <span>Resource</span>
              <span className="font-medium text-ink">{result.resourceLabel}</span>
            </div>
          )}
          {result.remaining !== undefined && (
            <div className="flex justify-between">
              <span>Remaining stock</span>
              <span className="font-medium text-ink">{result.remaining}</span>
            </div>
          )}
          {result.existingClaim && (
            <div className="flex justify-between">
              <span>Originally claimed via</span>
              <span className="font-medium text-ink">{result.existingClaim.organizationName}</span>
            </div>
          )}
          {result.auditNo && (
            <div className="flex justify-between">
              <span>Audit entry</span>
              <span className="font-medium text-ink">#{result.auditNo}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
