import { tool } from "langchain";
import { z } from "zod";
import { db, type RunRecorder } from "../db.js";

export interface RunContext {
  runId: string;
  encounterId: string;
  patientId: string;
  recorder: RunRecorder;
}

interface PriorEncounter {
  id: string;
  visit_date: string;
  clinician: string;
  chief_complaint: string | null;
  raw_notes: string;
}

/**
 * Patient-record tools are built per run so they are scoped to one patient.
 * The model never passes a patient id, so it cannot read another patient's
 * chart by hallucinating one — the scoping is structural, not prompted.
 */
export function createRecordTools(ctx: RunContext) {
  const getPatientHistory = tool(
    async ({ limit }) => {
      const { data, error } = await db
        .from("encounters")
        .select("id, visit_date, clinician, chief_complaint, raw_notes")
        .eq("patient_id", ctx.patientId)
        .neq("id", ctx.encounterId)
        .order("visit_date", { ascending: false })
        .limit(limit)
        .returns<PriorEncounter[]>();

      if (error) return JSON.stringify({ error: error.message, encounters: [] });

      return JSON.stringify(
        {
          priorEncounters: data ?? [],
          note:
            (data ?? []).length === 0
              ? "No prior visits on record. Treat this as a first encounter and say so where it matters."
              : "Prior notes are context, not licence. Do not carry a diagnosis or medication into this packet unless the current notes confirm it is still active.",
        },
        null,
        2,
      );
    },
    {
      name: "get_patient_history",
      description:
        "Retrieve this patient's previous visit notes. Call this before drafting. " +
        "Prior visits often change the follow-up interval, reveal that a problem " +
        "is recurring rather than new, or surface a medication the current notes " +
        "assume you already know about.",
      schema: z.object({
        limit: z.number().int().min(1).max(10).default(5)
          .describe("How many prior encounters to retrieve, most recent first."),
      }),
    },
  );

  const savePacket = tool(
    async ({ summary, redFlags, uncertainties, followUpInterval }) => {
      const { error } = await db
        .from("runs")
        .update({ status: "needs_review", completed_at: new Date().toISOString() })
        .eq("id", ctx.runId);

      if (error) return `Failed to finalise the packet: ${error.message}`;

      await ctx.recorder.step("note", "Packet finalised for clinician review", {
        summary,
        redFlags,
        uncertainties,
        followUpInterval,
      });
      await ctx.recorder.flush();

      return (
        "Packet saved and marked for clinician review. " +
        `${redFlags.length} red flag(s) and ${uncertainties.length} uncertainty(ies) recorded. ` +
        "Your work on this encounter is complete — stop here."
      );
    },
    {
      name: "save_packet",
      description:
        "Finalise the packet and hand it to the clinician for review. Call this " +
        "exactly once, as your last action, after the safety reviewer has passed " +
        "and every blocking finding has been fixed.",
      schema: z.object({
        summary: z.string().describe("Two or three sentences on what this visit was about and what the packet contains."),
        redFlags: z.array(z.string())
          .describe("Symptoms or findings needing urgent clinician attention. Empty array if none."),
        uncertainties: z.array(z.string())
          .describe("Anything the notes left ambiguous or missing that the clinician should confirm. Empty array if none."),
        followUpInterval: z.string()
          .describe("The follow-up interval as documented, or 'not documented' if the notes do not state one."),
      }),
    },
  );

  return [getPatientHistory, savePacket];
}
