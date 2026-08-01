import { tool } from "langchain";
import { z } from "zod";
import { db } from "../db.js";

/** Words that match half the code book and so tell us nothing about intent. */
const STOP_WORDS = new Set([
  "the", "and", "with", "without", "of", "in", "to", "a", "an", "for",
  "unspecified", "other", "type", "disease", "disorder", "patient", "new",
]);

interface CodeRow {
  code: string;
  description: string;
  category: string;
}

/**
 * Clinicians do not write ICD-10 descriptions. They write "new T2DM" and
 * "uncontrolled HTN". So this searches on any content word and ranks by how
 * much of the query each code actually covers, rather than demanding one
 * phrase match the whole description.
 */
export const lookupIcd10 = tool(
  async ({ query, limit }) => {
    const trimmed = query.trim();

    // An exact code was passed rather than a description.
    if (/^[A-Z]\d{2}(\.\d{1,4})?$/i.test(trimmed)) {
      const { data } = await db
        .from("icd10_codes")
        .select("*")
        .ilike("code", trimmed)
        .returns<CodeRow[]>();
      if (data && data.length > 0) {
        return JSON.stringify({ query, matches: data }, null, 2);
      }
    }

    const terms = trimmed
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

    if (terms.length === 0) {
      return JSON.stringify({
        query,
        matches: [],
        note: "Query had no searchable terms. Use a clinical description such as 'type 2 diabetes' or an exact code such as 'E11.9'.",
      });
    }

    const { data, error } = await db
      .from("icd10_codes")
      .select("*")
      .or(terms.map((t) => `description.ilike.%${t}%`).join(","))
      .returns<CodeRow[]>();

    if (error) return JSON.stringify({ query, error: error.message, matches: [] });

    const ranked = (data ?? [])
      .map((row) => {
        const description = row.description.toLowerCase();
        const hits = terms.filter((t) => description.includes(t));
        return {
          ...row,
          matchedTerms: hits.length,
          // Prefer codes that cover the query without dragging in extra concepts.
          score: hits.length - description.split(/\s+/).length * 0.01,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ score, ...rest }) => rest);

    return JSON.stringify(
      {
        query,
        matches: ranked,
        note:
          ranked.length === 0
            ? "No match in the clinic's code set. Record the diagnosis in words and leave the code for the clinician."
            : "matchedTerms shows how many of your search terms each code covers. If the best match covers only part of the query, present it as a suggestion rather than asserting it.",
      },
      null,
      2,
    );
  },
  {
    name: "lookup_icd10",
    description:
      "Look up ICD-10 diagnosis codes from the clinic's code set by clinical " +
      "description (e.g. 'type 2 diabetes', 'uncontrolled hypertension') or by " +
      "exact code. Use this for every diagnosis in the Assessment section. Never " +
      "write a code from memory — if it is not returned here, it is not in the set.",
    schema: z.object({
      query: z.string().describe("A clinical description or an exact ICD-10 code."),
      limit: z.number().int().min(1).max(10).default(5)
        .describe("Maximum codes to return."),
    }),
  },
);
