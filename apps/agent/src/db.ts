import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

export const db = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

export type ArtifactKind = "soap" | "handout" | "followup" | "safety_review";
export type StepKind =
  | "plan"
  | "tool_call"
  | "subagent"
  | "artifact"
  | "revision"
  | "note";

export interface EncounterRow {
  id: string;
  patient_id: string;
  visit_date: string;
  clinician: string;
  chief_complaint: string | null;
  raw_notes: string;
}

export interface PatientRow {
  id: string;
  full_name: string;
  date_of_birth: string;
  preferred_language: string;
}

/**
 * Sequence counter per run. The `unique (run_id, seq)` constraint means two
 * concurrent writers would collide, so steps are appended through a single
 * awaited chain per run rather than fired off in parallel.
 */
export class RunRecorder {
  #seq = 0;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(readonly runId: string) {}

  /** Append a step. Fire-and-forget from the caller's perspective, but ordered. */
  step(kind: StepKind, title: string, detail: Record<string, unknown> = {}) {
    const seq = this.#seq++;
    this.#chain = this.#chain.then(async () => {
      const { error } = await db
        .from("run_steps")
        .insert({ run_id: this.runId, seq, kind, title, detail });
      // A failed trace write must never kill a run that is otherwise working.
      if (error) console.error(`[run ${this.runId}] step insert failed:`, error.message);
    });
    return this.#chain;
  }

  /** Wait for every queued step write to land. */
  async flush() {
    await this.#chain;
  }
}

export async function loadEncounter(encounterId: string) {
  const { data, error } = await db
    .from("encounters")
    .select("*, patients(*)")
    .eq("id", encounterId)
    .single<EncounterRow & { patients: PatientRow }>();

  if (error) throw new Error(`Encounter ${encounterId} not found: ${error.message}`);
  return { encounter: data, patient: data.patients };
}
