/**
 * Preflight check: is Supabase reachable, is the schema applied, and does the
 * configured model answer and call tools?
 *
 *   npm run doctor --workspace agent
 *
 * Worth running before recording a demo and after every deploy — a cold Render
 * instance and a revoked key look identical from the UI.
 */
import { tool } from "langchain";
import { z } from "zod";
import { db } from "../db.js";
import { env } from "../env.js";
import { buildModel } from "../model.js";

let failures = 0;
const ok = (msg: string) => console.log(`  ok    ${msg}`);
const bad = (msg: string) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};

console.log(`\nmediHub doctor — provider=${env.provider} model=${env.model} rpm=${env.requestsPerMinute}\n`);

// --- Supabase ---------------------------------------------------------------
console.log("supabase");
const EXPECTED: Record<string, number> = {
  patients: 3,
  encounters: 4,
  icd10_codes: 44,
  drug_interactions: 18,
};

const { error: reachError } = await db.from("patients").select("id").limit(1);
if (reachError) {
  bad(`schema not applied — ${reachError.message}`);
  console.log("        apply supabase/schema.sql then supabase/seed.sql in the SQL editor");
} else {
  for (const [table, expected] of Object.entries(EXPECTED)) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
    if (error) bad(`${table}: ${error.message}`);
    else if ((count ?? 0) === 0) bad(`${table}: empty — seed.sql not applied`);
    else if ((count ?? 0) < expected) bad(`${table}: ${count} rows, expected ${expected}`);
    else ok(`${table}: ${count} rows`);
  }
  for (const table of ["runs", "run_steps", "artifacts"]) {
    const { error } = await db.from(table).select("*", { count: "exact", head: true });
    if (error) bad(`${table}: ${error.message}`);
    else ok(`${table}: present`);
  }
}

// --- Model ------------------------------------------------------------------
console.log("\nmodel");
const probe = tool(async ({ city }) => `18C in ${city}`, {
  name: "get_weather",
  description: "Get the current weather for a city.",
  schema: z.object({ city: z.string() }),
});

try {
  const model = await buildModel();
  const reply = await model.invoke([{ role: "user", content: "Reply with exactly: OK" }]);
  ok(`generation — ${JSON.stringify(String(reply.content).trim().slice(0, 20))}`);

  const bound = await model
    .bindTools!([probe])
    .invoke([{ role: "user", content: "Weather in Lahore? Use the tool." }]);
  const calls = (bound as { tool_calls?: { name: string }[] }).tool_calls ?? [];
  if (calls.length > 0) ok(`tool calling — called ${calls.map((c) => c.name).join(", ")}`);
  else bad("tool calling — model did not call the tool; the harness will not work");
} catch (error) {
  bad(`${error instanceof Error ? error.message : String(error)}`);
}

console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) failed\n`);
