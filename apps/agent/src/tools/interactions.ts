import { tool } from "langchain";
import { z } from "zod";
import { db } from "../db.js";

interface InteractionRow {
  drug_a: string;
  drug_b: string;
  severity: "minor" | "moderate" | "major";
  description: string;
}

/**
 * Medications arrive from the notes as written: "lisinopril 20mg daily",
 * "metformin 500 XR nightly". Strip dose, route, and frequency down to the
 * ingredient so the lookup has something to match on.
 */
function normaliseDrugName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\d+\s*(mg|mcg|g|ml|units?|iu)\b/g, " ")
    .replace(/\b(xr|er|sr|la|cr|od|bd|bid|tid|qid|prn|daily|nightly|nocte|mane|po|iv|im|sc|inh|puffs?|tabs?|caps?|mdi)\b/g, " ")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const checkDrugInteractions = tool(
  async ({ medications }) => {
    const normalised = medications
      .map((m) => ({ original: m, name: normaliseDrugName(m) }))
      .filter((m) => m.name.length > 2);

    if (normalised.length < 2) {
      return JSON.stringify({
        checked: normalised.map((m) => m.original),
        interactions: [],
        note: "Fewer than two identifiable medications. No pairwise check performed.",
      });
    }

    // The table is small enough to scan in full, which makes matching far more
    // forgiving than trying to build an exact-match query per pair.
    const { data, error } = await db
      .from("drug_interactions")
      .select("*")
      .returns<InteractionRow[]>();

    if (error) {
      return JSON.stringify({ error: error.message, interactions: [] });
    }

    const found: (InteractionRow & { matched: [string, string] })[] = [];

    for (const row of data ?? []) {
      for (let i = 0; i < normalised.length; i++) {
        for (let j = i + 1; j < normalised.length; j++) {
          const a = normalised[i]!;
          const b = normalised[j]!;
          const forward = a.name.includes(row.drug_a) && b.name.includes(row.drug_b);
          const reverse = a.name.includes(row.drug_b) && b.name.includes(row.drug_a);
          if (forward || reverse) {
            found.push({ ...row, matched: [a.original, b.original] });
          }
        }
      }
    }

    const order = { major: 0, moderate: 1, minor: 2 } as const;
    found.sort((x, y) => order[x.severity] - order[y.severity]);

    return JSON.stringify(
      {
        checked: normalised.map((m) => m.original),
        interactions: found,
        note:
          found.length === 0
            ? "No interaction found in the clinic's reference set. This set is small and is not a complete interaction database — absence of a result is not clearance."
            : "Record every major and moderate interaction in the Plan, including the specific monitoring the description calls for.",
      },
      null,
      2,
    );
  },
  {
    name: "check_drug_interactions",
    description:
      "Check a patient's medication list for known interactions against the " +
      "clinic's reference set. Call this whenever the notes list two or more " +
      "active medications, including ones being newly started. Pass medications " +
      "exactly as written in the notes — dose and frequency are stripped for you.",
    schema: z.object({
      medications: z
        .array(z.string())
        .min(1)
        .describe("Medications as written in the notes, e.g. ['lisinopril 20mg daily', 'spironolactone 25mg daily']."),
    }),
  },
);
