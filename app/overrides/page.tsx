"use client";

import { useEffect, useState } from "react";
import { CircleCheck, CircleX, Clock } from "lucide-react";
import { Topbar } from "@/components/app-shell/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { useAppState } from "@/components/app-shell/providers";
import { formatRelativeTime } from "@/lib/utils";
import type { OverrideRequestRow } from "@/lib/types";

export default function OverridesPage() {
  const { eventId, identity, role, refresh, refreshKey } = useAppState();
  const [requests, setRequests] = useState<OverrideRequestRow[]>([]);
  const canDecide = role === "COORDINATOR" || role === "ADMIN";

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/overrides?eventId=${eventId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setRequests)
      .catch(() => {});
  }, [eventId, refreshKey]);

  const pending = requests.filter((r) => r.status === "PENDING");
  const resolved = requests.filter((r) => r.status !== "PENDING");

  return (
    <div>
      <Topbar title="Overrides" />
      <div className="mx-auto max-w-3xl px-6 py-8 space-y-8">
        {!canDecide && (
          <Card className="border-primary-tint-strong bg-primary-tint">
            <CardContent className="text-sm text-primary">
              Viewing as {role.toLowerCase()}. Switch to Coordinator in the sidebar to approve or reject requests.
            </CardContent>
          </Card>
        )}

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">
            Pending ({pending.length})
          </h2>
          <div className="space-y-3">
            {pending.map((req) => (
              <PendingCard
                key={req.id}
                request={req}
                canDecide={canDecide}
                decidedByName={identity.name}
                onDecided={refresh}
              />
            ))}
            {pending.length === 0 && (
              <Card>
                <CardContent className="text-sm text-ink-faint">No pending overrides right now.</CardContent>
              </Card>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">
            Resolved ({resolved.length})
          </h2>
          <div className="space-y-3">
            {resolved.map((req) => (
              <ResolvedCard key={req.id} request={req} />
            ))}
            {resolved.length === 0 && (
              <Card>
                <CardContent className="text-sm text-ink-faint">Nothing resolved yet.</CardContent>
              </Card>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function PendingCard({
  request,
  canDecide,
  decidedByName,
  onDecided,
}: {
  request: OverrideRequestRow;
  canDecide: boolean;
  decidedByName: string;
  onDecided: () => void;
}) {
  const [distributionPoint, setDistributionPoint] = useState("Chiba Central Hub");
  const [decisionNote, setDecisionNote] = useState("");
  const [submitting, setSubmitting] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [resolvedLocally, setResolvedLocally] = useState(false);

  async function decide(decision: "APPROVED" | "REJECTED") {
    setSubmitting(decision);
    try {
      const res = await fetch("/api/overrides/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: request.id,
          decision,
          decidedByName,
          decisionNote: decisionNote.trim() || undefined,
          distributionPoint,
        }),
      });
      if (!res.ok) throw new Error("Decision failed");
      setResolvedLocally(true);
      onDecided();
    } catch {
      // demo-scale: surfaced implicitly by the card staying in pending state
    } finally {
      setSubmitting(null);
    }
  }

  if (resolvedLocally) return null;

  return (
    <Card>
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-ink">{request.household_claim_code}</span>
              <Badge tone="primary">{request.aid_type_name}</Badge>
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              Requested by {request.requested_by_name} · {request.requested_by_org_name} ·{" "}
              {formatRelativeTime(request.created_at)}
            </p>
          </div>
          <Clock className="h-4 w-4 flex-shrink-0 text-warning" />
        </div>

        <blockquote className="mt-3 rounded-lg border-l-2 border-primary bg-surface-muted px-3 py-2 text-sm italic text-ink-muted">
          &ldquo;{request.reason}&rdquo;
        </blockquote>

        {canDecide && (
          <div className="mt-4 space-y-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                value={distributionPoint}
                onChange={(e) => setDistributionPoint(e.target.value)}
                placeholder="Distribution point if approved"
              />
              <Textarea
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder="Decision note (optional)"
                className="min-h-0 h-11 py-2.5"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="success"
                className="flex-1"
                loading={submitting === "APPROVED"}
                disabled={submitting !== null}
                onClick={() => decide("APPROVED")}
              >
                <CircleCheck className="h-4 w-4" /> Approve
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                loading={submitting === "REJECTED"}
                disabled={submitting !== null}
                onClick={() => decide("REJECTED")}
              >
                <CircleX className="h-4 w-4" /> Reject
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResolvedCard({ request }: { request: OverrideRequestRow }) {
  const approved = request.status === "APPROVED";
  return (
    <Card>
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-ink">{request.household_claim_code}</span>
              <Badge tone="neutral">{request.aid_type_name}</Badge>
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              Requested by {request.requested_by_name} · {request.requested_by_org_name}
            </p>
          </div>
          <Badge tone={approved ? "success" : "danger"}>
            {approved ? <CircleCheck className="h-3 w-3" /> : <CircleX className="h-3 w-3" />}
            {request.status}
          </Badge>
        </div>
        <blockquote className="mt-3 rounded-lg border-l-2 border-border bg-surface-muted px-3 py-2 text-sm italic text-ink-muted">
          &ldquo;{request.reason}&rdquo;
        </blockquote>
        {request.decision_note && (
          <p className="mt-2 text-xs text-ink-muted">
            <span className="font-medium text-ink">{request.decided_by_name}:</span> {request.decision_note}
          </p>
        )}
        {request.decided_at && (
          <p className="mt-1 text-xs text-ink-faint">{formatRelativeTime(request.decided_at)}</p>
        )}
      </CardContent>
    </Card>
  );
}
