import type { Artifact, ArtifactKind, Run } from "./types";

/**
 * The artifacts a clinician actually signs off. The safety review is a report
 * about the other three, not a document sent to anyone, so it is not approvable.
 */
export const APPROVABLE_KINDS: ArtifactKind[] = ["soap", "handout", "followup"];

export interface ReviewProgress {
  approved: number;
  total: number;
  /** Every approvable artifact the run produced has been signed off. */
  complete: boolean;
  /** Some but not all. */
  partial: boolean;
}

/**
 * Approval lives on individual artifact rows, and only the latest version of
 * each kind can be approved. So progress is computed from the top version of
 * each approvable kind rather than counting rows — otherwise a run the agent
 * revised twice would look like it needed three times the sign-off.
 *
 * Deliberately derived rather than stored: `runs.status` describes what the
 * *agent* did, and `approved_at` is what the *clinician* did. Copying one into
 * the other gives two places to disagree.
 */
export function reviewProgress(artifacts: Artifact[]): ReviewProgress {
  let approved = 0;
  let total = 0;

  for (const kind of APPROVABLE_KINDS) {
    const versions = artifacts.filter((a) => a.kind === kind);
    if (versions.length === 0) continue;
    total++;
    const latest = versions.reduce((a, b) => (b.version > a.version ? b : a));
    if (latest.approved_at) approved++;
  }

  return {
    approved,
    total,
    complete: total > 0 && approved === total,
    partial: approved > 0 && approved < total,
  };
}

export type ReviewState =
  | "none"
  | "working"
  | "failed"
  | "needs_review"
  | "in_review"
  | "approved";

/** Single source of truth for the badge shown on both the list and the workspace. */
export function reviewState(
  run: Run | null | undefined,
  progress: ReviewProgress,
): ReviewState {
  if (!run) return "none";
  if (run.status === "failed") return "failed";
  if (run.status === "queued" || run.status === "running") return "working";
  if (progress.complete) return "approved";
  if (progress.partial) return "in_review";
  return "needs_review";
}
