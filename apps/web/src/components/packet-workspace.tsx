"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArtifactPanes } from "@/components/artifact-panes";
import { RunTrace } from "@/components/run-trace";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatVisitDate } from "@/lib/format";
import { reviewProgress, reviewState, type ReviewProgress } from "@/lib/review";
import { AGENT_URL, supabase } from "@/lib/supabase";
import type { Artifact, Encounter, Patient, Run, RunStep } from "@/lib/types";

interface Props {
  encounter: Encounter;
  patient: Patient | null;
  initialRun: Run | null;
  initialSteps: RunStep[];
  initialArtifacts: Artifact[];
}

const LANGUAGE_NAMES: Record<string, string> = { en: "English", es: "Spanish" };

export function PacketWorkspace({
  encounter,
  patient,
  initialRun,
  initialSteps,
  initialArtifacts,
}: Props) {
  const [run, setRun] = useState<Run | null>(initialRun);
  const [steps, setSteps] = useState<RunStep[]>(initialSteps);
  const [artifacts, setArtifacts] = useState<Artifact[]>(initialArtifacts);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const inFlight = run?.status === "queued" || run?.status === "running";

  /**
   * Subscribe to this run's rows. The agent writes progress to Postgres as it
   * works, so the browser needs no connection to the agent server at all — a
   * refresh, a dropped network, or a closed tab does not affect the run.
   */
  useEffect(() => {
    if (!run) return;

    const channel = supabase
      .channel(`run:${run.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "run_steps",
          filter: `run_id=eq.${run.id}`,
        },
        (payload) => {
          const step = payload.new as RunStep;
          setSteps((prev) =>
            prev.some((s) => s.id === step.id)
              ? prev
              : [...prev, step].sort((a, b) => a.seq - b.seq),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "artifacts",
          filter: `run_id=eq.${run.id}`,
        },
        (payload) => {
          const artifact = payload.new as Artifact;
          if (!artifact?.id) return;
          setArtifacts((prev) => {
            const next = prev.filter((a) => a.id !== artifact.id);
            return [...next, artifact].sort((a, b) => a.version - b.version);
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "runs",
          filter: `id=eq.${run.id}`,
        },
        (payload) => {
          const updated = payload.new as Run;
          setRun(updated);
          if (updated.status === "needs_review") {
            toast.success("Packet ready for review");
          } else if (updated.status === "failed") {
            toast.error("Run failed", { description: updated.error ?? undefined });
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [run?.id]);

  /**
   * Realtime can miss events across a reconnect. While a run is in flight, poll
   * as a backstop so the UI cannot get permanently stuck mid-run.
   */
  const resync = useCallback(async () => {
    if (!run) return;
    const [runResult, stepsResult, artifactsResult] = await Promise.all([
      supabase.from("runs").select("*").eq("id", run.id).maybeSingle<Run>(),
      supabase
        .from("run_steps")
        .select("*")
        .eq("run_id", run.id)
        .order("seq")
        .returns<RunStep[]>(),
      supabase
        .from("artifacts")
        .select("*")
        .eq("run_id", run.id)
        .order("version")
        .returns<Artifact[]>(),
    ]);
    if (runResult.data) setRun(runResult.data);
    if (stepsResult.data) setSteps(stepsResult.data);
    if (artifactsResult.data) setArtifacts(artifactsResult.data);
  }, [run?.id]);

  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(resync, 5000);
    return () => clearInterval(timer);
  }, [inFlight, resync]);

  async function startRun() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`${AGENT_URL}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encounterId: encounter.id }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Agent returned ${res.status}`);
      }

      const { runId } = (await res.json()) as { runId: string };
      setSteps([]);
      setArtifacts([]);
      setRun({
        id: runId,
        encounter_id: encounter.id,
        status: "queued",
        error: null,
        created_at: new Date().toISOString(),
        completed_at: null,
      });
      toast.info("Agent started", {
        description: "Progress appears live as it works.",
      });
    } catch (error) {
      // Shown inline as well as in a toast. A toast is easy to miss, and a
      // button that appears to do nothing is the worst failure mode there is.
      const message = error instanceof Error ? error.message : String(error);
      console.error("[mediHub] could not start run:", error);
      setStartError(
        `${message}. Agent URL is ${AGENT_URL} — check that the agent server is ` +
          `running (npm run dev:agent) and that this page's origin is in ALLOWED_ORIGINS.`,
      );
      toast.error("Could not start the agent", { description: message });
    } finally {
      setStarting(false);
    }
  }

  const language = patient?.preferred_language ?? "en";
  const elapsed = useElapsed(run, inFlight);
  const progress = useMemo(() => reviewProgress(artifacts), [artifacts]);

  return (
    <div className="mt-4">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {patient?.full_name ?? "Unknown patient"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {encounter.chief_complaint ?? "No chief complaint recorded"} ·{" "}
            {formatVisitDate(encounter.visit_date)} · {encounter.clinician} ·{" "}
            {LANGUAGE_NAMES[language] ?? language} handout
          </p>
        </div>

        <div className="flex items-center gap-3">
          <StatusBadge run={run} elapsed={elapsed} progress={progress} />
          <Button onClick={startRun} disabled={starting || inFlight}>
            {inFlight
              ? "Working…"
              : run
                ? "Regenerate packet"
                : "Generate packet"}
          </Button>
        </div>
      </header>

      {startError && (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Could not start the agent</AlertTitle>
          <AlertDescription className="break-words">{startError}</AlertDescription>
        </Alert>
      )}

      {run?.status === "failed" && run.error && (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>The run failed</AlertTitle>
          <AlertDescription className="break-words">{run.error}</AlertDescription>
        </Alert>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="space-y-6">
          <ArtifactPanes
            artifacts={artifacts}
            inFlight={inFlight}
            hasRun={Boolean(run)}
          />
          <SourceNotes encounter={encounter} />
        </div>
        <RunTrace steps={steps} run={run} />
      </div>
    </div>
  );
}

function SourceNotes({ encounter }: { encounter: Encounter }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Source notes as written by the clinician
        </CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-4 font-mono text-xs leading-relaxed">
          {encounter.raw_notes}
        </pre>
      </CardContent>
    </Card>
  );
}

function StatusBadge({
  run,
  elapsed,
  progress,
}: {
  run: Run | null;
  elapsed: string | null;
  progress: ReviewProgress;
}) {
  switch (reviewState(run, progress)) {
    case "none":
      return (
        <Badge variant="outline" className="font-normal text-muted-foreground">
          No packet yet
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "working":
      return (
        <Badge className="animate-pulse">
          Working{elapsed ? ` · ${elapsed}` : ""}
        </Badge>
      );
    case "approved":
      return (
        <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
          Approved
        </Badge>
      );
    case "in_review":
      return (
        <Badge variant="outline">
          {progress.approved} of {progress.total} approved
        </Badge>
      );
    default:
      return <Badge variant="secondary">Ready for review</Badge>;
  }
}

/** Live elapsed time while a run is in flight. */
function useElapsed(run: Run | null, inFlight: boolean) {
  const started = useMemo(
    () => (run ? new Date(run.created_at).getTime() : 0),
    [run?.created_at],
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [inFlight]);

  if (!run || !inFlight) return null;
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
