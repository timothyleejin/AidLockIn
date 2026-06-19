"use client";

import { useEffect, useState } from "react";
import { Zap, MapPin, Trophy, CircleX, RotateCw, Loader2, Timer } from "lucide-react";
import { Topbar } from "@/components/app-shell/topbar";
import { Button } from "@/components/ui/button";
import { useAppState } from "@/components/app-shell/providers";
import { cn } from "@/lib/utils";
import type { AidType, AttemptResult } from "@/lib/types";

interface RaceStationResult {
  station: string;
  region: string;
  householdClaimCode: string;
  outcome: {
    result: AttemptResult;
    message: string;
    detail?: string;
    resourceLabel?: string;
  };
}

interface RaceDemoResult {
  bedLabel: string;
  stations: RaceStationResult[];
}

export default function RaceDemoPage() {
  const { eventId, refresh } = useAppState();
  const [shelterBedId, setShelterBedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [result, setResult] = useState<RaceDemoResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/aid-types?eventId=${eventId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: AidType[]) => {
        const bed = data.find((a) => a.code === "SHELTER_BED") ?? data.find((a) => a.resource_model === "UNIT");
        setShelterBedId(bed?.id ?? null);
      })
      .catch(() => {});
  }, [eventId]);

  async function runRace() {
    if (!eventId || !shelterBedId) return;
    setRunning(true);
    setResult(null);
    setError(null);
    const startedAt = performance.now();

    try {
      const res = await fetch("/api/race-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, aidTypeId: shelterBedId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Race demo failed");
      setElapsedMs(Math.round(performance.now() - startedAt));
      setResult(data);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRunning(false);
    }
  }

  const winner = result?.stations.find((s) => s.outcome.result === "APPROVED");
  const loser = result?.stations.find((s) => s.outcome.result !== "APPROVED");

  return (
    <div>
      <Topbar title="Race demo" />
      <div className="min-h-[calc(100vh-4rem)] bg-dark-bg px-6 py-10">
        <div className="mx-auto max-w-4xl">
          <div className="text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-dark-surface-2 px-3 py-1 text-xs font-semibold text-dark-ink-muted">
              <Zap className="h-3.5 w-3.5" /> Live concurrency proof — not an animation
            </span>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-dark-ink">
              Two regions. One last bed. One winner.
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-dark-ink-muted">
              Both stations below call the exact same allocation engine the field screen uses, fired at the same
              instant against the exact same database row. Aurora DSQL — not application code — decides who gets
              it.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <StationCard
              label="Station A"
              region="Tokyo"
              running={running}
              result={result?.stations[0]}
            />
            <StationCard
              label="Station B"
              region="Osaka"
              running={running}
              result={result?.stations[1]}
            />
          </div>

          <div className="mt-8 flex flex-col items-center gap-3">
            {!result && (
              <Button size="lg" disabled={!shelterBedId} loading={running} onClick={runRace}>
                <Zap className="h-4 w-4" /> Run the race
              </Button>
            )}
            {result && (
              <>
                <div className="flex items-center gap-2 text-sm text-dark-ink-muted">
                  {winner && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-dark-surface-2 px-3 py-1.5 text-dark-ink">
                      <Trophy className="h-4 w-4 text-warning" /> {winner.station} ({winner.region}) won{" "}
                      {result.bedLabel}
                    </span>
                  )}
                  {elapsedMs !== null && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-dark-surface-2 px-3 py-1.5">
                      <Timer className="h-3.5 w-3.5" /> resolved in {elapsedMs}ms
                    </span>
                  )}
                </div>
                <Button variant="secondary" loading={running} onClick={runRace}>
                  <RotateCw className="h-4 w-4" /> Run it again
                </Button>
              </>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
            {loser && (
              <p className="max-w-md text-center text-xs text-dark-ink-muted">
                {loser.station} wasn&apos;t blocked by a lock or a queue — its transaction was retried
                automatically and then denied cleanly once it saw {winner?.station ?? "the other station"} had
                already committed.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StationCard({
  label,
  region,
  running,
  result,
}: {
  label: string;
  region: string;
  running: boolean;
  result?: RaceStationResult;
}) {
  const approved = result?.outcome.result === "APPROVED";
  const resolved = !!result;

  return (
    <div
      className={cn(
        "rounded-2xl border p-6 transition",
        resolved && approved && "border-success bg-dark-surface-2",
        resolved && !approved && "border-dark-border bg-dark-surface",
        !resolved && "border-dark-border bg-dark-surface"
      )}
    >
      <div className="flex items-center gap-2 text-dark-ink-muted">
        <MapPin className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">{region}</span>
      </div>
      <h3 className="mt-1 text-lg font-semibold text-dark-ink">{label}</h3>

      {running && !resolved && (
        <div className="mt-6 flex items-center gap-2 text-dark-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Racing for the bed...</span>
        </div>
      )}

      {!running && !resolved && (
        <p className="mt-6 text-sm text-dark-ink-muted">Waiting to run the race.</p>
      )}

      {resolved && (
        <div className="mt-6">
          <div className={cn("flex items-center gap-2", approved ? "text-success" : "text-danger")}>
            {approved ? <Trophy className="h-5 w-5" /> : <CircleX className="h-5 w-5" />}
            <span className="text-base font-semibold">{approved ? "Approved" : "Already allocated"}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-dark-ink-muted">
            {result.outcome.detail ?? result.outcome.message}
          </p>
          <p className="mt-3 font-mono text-xs text-dark-ink-muted">{result.householdClaimCode}</p>
        </div>
      )}
    </div>
  );
}
