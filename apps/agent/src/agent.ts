import { createDeepAgent } from "deepagents";
import { buildModel } from "./model.js";
import {
  EDUCATION_WRITER_INSTRUCTIONS,
  MAIN_INSTRUCTIONS,
  SAFETY_REVIEWER_INSTRUCTIONS,
} from "./prompts.js";
import { lookupIcd10 } from "./tools/icd10.js";
import { checkDrugInteractions } from "./tools/interactions.js";
import { checkReadability } from "./tools/readability.js";
import { createRecordTools, type RunContext } from "./tools/records.js";
import type { EncounterRow, PatientRow } from "./db.js";

/** Artifact filenames the harness expects in the virtual filesystem. */
export const ARTIFACT_FILES = {
  "soap.md": "soap",
  "handout.md": "handout",
  "followup.md": "followup",
  "safety.md": "safety_review",
} as const;

function age(dateOfBirth: string, visitDate: string): number {
  const dob = new Date(dateOfBirth);
  const visit = new Date(visitDate);
  let years = visit.getFullYear() - dob.getFullYear();
  const monthDelta = visit.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && visit.getDate() < dob.getDate())) years--;
  return years;
}

export async function buildAgent(ctx: RunContext) {
  const model = await buildModel();

  return createDeepAgent({
    model,
    name: "medihub",
    systemPrompt: MAIN_INSTRUCTIONS,
    tools: [
      lookupIcd10,
      checkDrugInteractions,
      checkReadability,
      ...createRecordTools(ctx),
    ],
    subagents: [
      {
        name: "safety-reviewer",
        description:
          "Reviews a drafted follow-up packet and reports unsupported claims, " +
          "omissions, missed red flags, and contradictions. Delegate to this " +
          `once all three drafts are written. It reads \`${SOURCE_FILE}\` and ` +
          "the drafts from the filesystem itself — you do not need to repeat " +
          "their contents in your prompt.",
        systemPrompt: SAFETY_REVIEWER_INSTRUCTIONS,
        // The reviewer gets the same reference tools the main agent used, so it
        // can verify an interaction or a code rather than assuming anything not
        // in the notes was invented. Without these it flagged a real,
        // tool-derived hyperkalemia warning as a hallucination — and the main
        // agent then deleted it.
        tools: [lookupIcd10, checkDrugInteractions],
        model,
      },
      {
        name: "education-writer",
        description:
          "Writes or rewrites patient education material at a low reading level " +
          "in the patient's language. Delegate when the handout needs a full " +
          "rewrite rather than a small edit.",
        systemPrompt: EDUCATION_WRITER_INSTRUCTIONS,
        tools: [checkReadability],
        model,
      },
    ],
  });
}

/** Filename of the seeded source document. The single source of truth. */
export const SOURCE_FILE = "encounter.md";

/**
 * The complete source material for one encounter: chart metadata plus the raw
 * notes, clearly separated so chart facts are not confused with what the
 * clinician wrote.
 *
 * This is seeded into the virtual filesystem rather than passed only in the
 * task message, so the safety reviewer reads exactly what the main agent read.
 * When the reviewer saw only the raw notes, it correctly reported the clinician
 * name as unsupported — it had no way to know the name came from the chart —
 * and the main agent then "fixed" a fact that was never wrong.
 */
export function buildSourceDocument(
  encounter: EncounterRow,
  patient: PatientRow,
): string {
  return [
    "# Encounter source material",
    "",
    "Everything in this file is verified chart data. Statements in the packet",
    "must trace to something here.",
    "",
    "## Patient (from the chart)",
    `- Name: ${patient.full_name}`,
    `- Age at visit: ${age(patient.date_of_birth, encounter.visit_date)}`,
    `- Preferred language: ${patient.preferred_language}`,
    "",
    "## Visit (from the chart)",
    `- Date: ${encounter.visit_date}`,
    `- Clinician: ${encounter.clinician}`,
    `- Chief complaint: ${encounter.chief_complaint ?? "not recorded"}`,
    "",
    "## Raw notes (as written by the clinician)",
    "",
    encounter.raw_notes,
  ].join("\n");
}

export function buildTaskMessage(encounter: EncounterRow, patient: PatientRow): string {
  return [
    "Prepare the post-visit follow-up packet for this encounter.",
    "",
    `The source material is in \`${SOURCE_FILE}\`. Read it first.`,
    "",
    `Write the handout and the follow-up message in "${patient.preferred_language}".`,
    "Write soap.md, handout.md, and followup.md, then delegate to the",
    "safety-reviewer subagent, fix every blocking finding, and call save_packet.",
  ].join("\n");
}
