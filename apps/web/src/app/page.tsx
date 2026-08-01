import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatVisitDate } from "@/lib/format";
import { reviewProgress, reviewState } from "@/lib/review";
import { supabase } from "@/lib/supabase";
import type { Artifact, Encounter, Patient, Run } from "@/lib/types";

// Always read fresh: a run started seconds ago should show on the list.
export const dynamic = "force-dynamic";

type EncounterRow = Encounter & { patients: Patient | null };

const LANGUAGE_NAMES: Record<string, string> = { en: "English", es: "Spanish" };

export default async function Home() {
  const { data: encounters, error } = await supabase
    .from("encounters")
    .select("*, patients(*)")
    .order("visit_date", { ascending: false })
    .returns<EncounterRow[]>();

  const { data: runs } = await supabase
    .from("runs")
    .select("id, encounter_id, status, error, created_at, completed_at")
    .order("created_at", { ascending: false })
    .returns<Run[]>();

  // Most recent run per encounter.
  const latestRun = new Map<string, Run>();
  for (const run of runs ?? []) {
    if (!latestRun.has(run.encounter_id)) latestRun.set(run.encounter_id, run);
  }

  // Approval state lives on artifact rows, so the list needs them too — without
  // this, a fully approved packet still reads "Ready for review" here.
  const runIds = [...latestRun.values()].map((r) => r.id);
  const { data: artifacts } = runIds.length
    ? await supabase
        .from("artifacts")
        .select("id, run_id, kind, version, approved_at")
        .in("run_id", runIds)
        .returns<Artifact[]>()
    : { data: [] as Artifact[] };

  const artifactsByRun = new Map<string, Artifact[]>();
  for (const artifact of artifacts ?? []) {
    const list = artifactsByRun.get(artifact.run_id) ?? [];
    list.push(artifact);
    artifactsByRun.set(artifact.run_id, list);
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
      <header className="mb-10 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">mediHub</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Turns the messy notes from a clinic visit into a reviewable follow-up
            packet — visit summary, patient handout, follow-up message, and an
            independent safety review. Nothing is sent to a patient; a clinician
            reviews everything.
          </p>
        </div>
        <Button asChild>
          <Link href="/encounters/new">New visit</Link>
        </Button>
      </header>

      {error ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Could not load encounters: {error.message}
          </CardContent>
        </Card>
      ) : (encounters ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No encounters yet. Apply <code>supabase/seed.sql</code> to load the
            demo data.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Recent visits
          </h2>
          {(encounters ?? []).map((encounter) => {
            const run = latestRun.get(encounter.id);
            const language = encounter.patients?.preferred_language ?? "en";
            return (
              <Link
                key={encounter.id}
                href={`/encounters/${encounter.id}`}
                className="block"
              >
                <Card className="transition-colors hover:border-foreground/20 hover:bg-accent/40">
                  <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {encounter.patients?.full_name ?? "Unknown patient"}
                        </span>
                        {language !== "en" && (
                          <Badge variant="secondary" className="font-normal">
                            {LANGUAGE_NAMES[language] ?? language}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {encounter.chief_complaint ?? "No chief complaint recorded"}
                        {" · "}
                        {formatVisitDate(encounter.visit_date)}
                        {" · "}
                        {encounter.clinician}
                      </p>
                    </div>
                    <RunBadge
                      run={run}
                      artifacts={run ? (artifactsByRun.get(run.id) ?? []) : []}
                    />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}

function RunBadge({ run, artifacts }: { run?: Run; artifacts: Artifact[] }) {
  const progress = reviewProgress(artifacts);

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
      return <Badge className="animate-pulse">Working…</Badge>;
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
