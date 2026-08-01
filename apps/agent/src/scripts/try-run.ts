/**
 * Run the harness end to end from the terminal, with no server and no UI.
 *
 *   npm run agent:try -- <encounterId>
 *
 * Defaults to the James Okafor encounter, which is the useful one to test:
 * the notes bury an exertional chest-pain red flag in a throwaway sentence and
 * add spironolactone on top of lisinopril. A packet that misses either is
 * unsafe, so this is the case that tells you whether the harness works.
 */
import { db } from "../db.js";
import { executeRun } from "../run.js";

const DEFAULT_ENCOUNTER = "aaaaaaaa-0000-4000-8000-000000000002";

const encounterId = process.argv[2] ?? DEFAULT_ENCOUNTER;

const { data: run, error } = await db
  .from("runs")
  .insert({ encounter_id: encounterId, status: "queued" })
  .select("id")
  .single<{ id: string }>();

if (error || !run) {
  console.error("Could not create run:", error?.message);
  process.exit(1);
}

console.log(`run ${run.id} — encounter ${encounterId}\n`);

const startedAt = Date.now();
await executeRun(run.id, encounterId);
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

const { data: steps } = await db
  .from("run_steps")
  .select("seq, kind, title")
  .eq("run_id", run.id)
  .order("seq")
  .returns<{ seq: number; kind: string; title: string }[]>();

console.log(`\n--- trace (${steps?.length ?? 0} steps, ${elapsed}s) ---`);
for (const step of steps ?? []) {
  console.log(`${String(step.seq).padStart(3)}  ${step.kind.padEnd(9)}  ${step.title}`);
}

const { data: artifacts } = await db
  .from("artifacts")
  .select("kind, version, content")
  .eq("run_id", run.id)
  .order("kind")
  .order("version")
  .returns<{ kind: string; version: number; content: string }[]>();

console.log(`\n--- artifacts (${artifacts?.length ?? 0}) ---`);
for (const artifact of artifacts ?? []) {
  console.log(`\n### ${artifact.kind} v${artifact.version}\n`);
  console.log(artifact.content);
}

const { data: final } = await db
  .from("runs")
  .select("status, error")
  .eq("id", run.id)
  .single<{ status: string; error: string | null }>();

console.log(`\n--- status: ${final?.status}${final?.error ? ` (${final.error})` : ""} ---`);
process.exit(0);
