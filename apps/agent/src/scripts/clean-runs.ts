/**
 * Delete runs that never reached `needs_review`.
 *
 *   npm run clean-runs --workspace agent
 *
 * Failed and abandoned runs are useful while debugging and noise in a demo.
 * Cascades to run_steps and artifacts via the foreign keys.
 */
import { db } from "../db.js";

const { data, error } = await db
  .from("runs")
  .select("id, status")
  .returns<{ id: string; status: string }[]>();

if (error) {
  console.error("could not list runs:", error.message);
  process.exit(1);
}

const junk = (data ?? []).filter((r) => r.status !== "needs_review");
for (const run of junk) {
  const { error: delError } = await db.from("runs").delete().eq("id", run.id);
  if (delError) console.error(`  failed to delete ${run.id}: ${delError.message}`);
}

console.log(
  `deleted ${junk.length} incomplete run(s); kept ${(data ?? []).length - junk.length} complete`,
);
