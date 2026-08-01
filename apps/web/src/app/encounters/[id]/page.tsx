import Link from "next/link";
import { notFound } from "next/navigation";
import { PacketWorkspace } from "@/components/packet-workspace";
import { supabase } from "@/lib/supabase";
import type { Artifact, Encounter, Patient, Run, RunStep } from "@/lib/types";

export const dynamic = "force-dynamic";

type EncounterRow = Encounter & { patients: Patient | null };

export default async function EncounterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: encounter } = await supabase
    .from("encounters")
    .select("*, patients(*)")
    .eq("id", id)
    .maybeSingle<EncounterRow>();

  if (!encounter) notFound();

  // Latest run for this encounter, with its trace and artifacts. The client
  // component takes over from here via Realtime.
  const { data: run } = await supabase
    .from("runs")
    .select("id, encounter_id, status, error, created_at, completed_at")
    .eq("encounter_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Run>();

  let steps: RunStep[] = [];
  let artifacts: Artifact[] = [];

  if (run) {
    const [stepsResult, artifactsResult] = await Promise.all([
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
    steps = stepsResult.data ?? [];
    artifacts = artifactsResult.data ?? [];
  }

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
      <Link
        href="/"
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← All visits
      </Link>
      <PacketWorkspace
        encounter={encounter}
        patient={encounter.patients}
        initialRun={run ?? null}
        initialSteps={steps}
        initialArtifacts={artifacts}
      />
    </main>
  );
}
