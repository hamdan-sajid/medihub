export type RunStatus = "queued" | "running" | "needs_review" | "failed";

export type StepKind =
  | "plan"
  | "tool_call"
  | "subagent"
  | "artifact"
  | "revision"
  | "note";

export type ArtifactKind = "soap" | "handout" | "followup" | "safety_review";

export const ARTIFACT_LABELS: Record<ArtifactKind, string> = {
  soap: "Visit summary",
  handout: "Patient handout",
  followup: "Follow-up message",
  safety_review: "Safety review",
};

/** Display order, which is also the order the agent produces them in. */
export const ARTIFACT_ORDER: ArtifactKind[] = [
  "soap",
  "handout",
  "followup",
  "safety_review",
];

export interface Patient {
  id: string;
  full_name: string;
  date_of_birth: string;
  preferred_language: string;
}

export interface Encounter {
  id: string;
  patient_id: string;
  visit_date: string;
  clinician: string;
  chief_complaint: string | null;
  raw_notes: string;
}

export interface Run {
  id: string;
  encounter_id: string;
  status: RunStatus;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface RunStep {
  id: string;
  run_id: string;
  seq: number;
  kind: StepKind;
  title: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface Artifact {
  id: string;
  run_id: string;
  kind: ArtifactKind;
  version: number;
  content: string;
  metadata: Record<string, unknown>;
  edited_content: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface SafetyFinding {
  artifact?: string;
  severity?: "blocking" | "advisory";
  quote?: string;
  problem?: string;
  fix?: string;
}

/**
 * The reviewer is asked for JSON but is a language model, so it sometimes
 * returns prose or wraps JSON in a fence. Parse defensively and fall back to
 * showing the raw text rather than rendering nothing.
 */
export function parseSafetyReview(
  content: string,
): { findings: SafetyFinding[]; verdict?: string } | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? content).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as {
      findings?: SafetyFinding[];
      verdict?: string;
    };
    if (!Array.isArray(parsed.findings)) return null;
    return { findings: parsed.findings, verdict: parsed.verdict };
  } catch {
    return null;
  }
}
