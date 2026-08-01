/**
 * Print the state of the most recent run: status, trace, and artifact versions.
 *
 *   npm run watch --workspace agent
 *
 * This reads exactly what the UI will read, so if it looks right here the
 * Realtime view has the data it needs.
 */
import { db } from "../db.js";

const { data: run } = await db
  .from("runs")
  .select("id, status, error, created_at, completed_at, encounter_id")
  .order("created_at", { ascending: false })
  .limit(1)
  .single<{
    id: string;
    status: string;
    error: string | null;
    created_at: string;
    completed_at: string | null;
    encounter_id: string;
  }>();

if (!run) {
  console.log("no runs yet");
  process.exit(0);
}

const elapsed = (
  (new Date(run.completed_at ?? Date.now()).getTime() -
    new Date(run.created_at).getTime()) /
  1000
).toFixed(0);

console.log(`run ${run.id}`);
console.log(`status: ${run.status}  elapsed: ${elapsed}s`);
if (run.error) console.log(`error: ${run.error.slice(0, 300)}`);

const { data: steps } = await db
  .from("run_steps")
  .select("seq, kind, title, detail")
  .eq("run_id", run.id)
  .order("seq")
  .returns<{ seq: number; kind: string; title: string; detail: Record<string, unknown> }[]>();

console.log(`\ntrace (${steps?.length ?? 0} steps)`);
for (const s of steps ?? []) {
  console.log(`${String(s.seq).padStart(3)}  ${s.kind.padEnd(9)}  ${s.title}`);
}

const { data: artifacts } = await db
  .from("artifacts")
  .select("kind, version, content")
  .eq("run_id", run.id)
  .order("kind")
  .order("version")
  .returns<{ kind: string; version: number; content: string }[]>();

console.log(`\nartifacts (${artifacts?.length ?? 0})`);
for (const a of artifacts ?? []) {
  console.log(`  ${a.kind} v${a.version} — ${a.content.length} chars`);
}

const showFull = process.argv.includes("--full");
if (showFull) {
  for (const a of artifacts ?? []) {
    console.log(`\n${"=".repeat(70)}\n### ${a.kind} v${a.version}\n${"=".repeat(70)}\n`);
    console.log(a.content);
  }
}
