import { tool } from "langchain";
import { z } from "zod";

/**
 * Readability scoring for patient education material.
 *
 * Flesch-Kincaid is defined for English only. Running it on Spanish text
 * produces a number, and that number is meaningless — it would make a hard
 * Spanish handout look easy. So Spanish is scored with Fernandez-Huerta, the
 * Spanish adaptation of Flesch, and anything else is scored structurally
 * (sentence and word length) with the limitation stated in the result.
 *
 * This tool exists to fail. When it fails it tells the agent exactly which
 * sentences and words to fix, which is what turns "write simply" into a loop
 * that actually converges.
 */

const ENGLISH_TARGET_GRADE = 6.0;
const SPANISH_TARGET_EASE = 70; // "fairly easy" on the Fernandez-Huerta scale

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /\p{L}/u.test(s));
}

function splitWords(text: string): string[] {
  return text.match(/[\p{L}\p{M}'’-]+/gu) ?? [];
}

/** Vowel-group counting. Accurate for Spanish, adequate for English. */
function countSyllablesSpanish(word: string): number {
  const groups = word.toLowerCase().match(/[aeiouáéíóúüàèìòù]+/g);
  return Math.max(1, groups?.length ?? 1);
}

function countSyllablesEnglish(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;

  const trimmed = w
    // silent trailing -e, but keep -le as its own syllable ("table", "little")
    .replace(/(?:[^laeiouy]es|[^laeiouy]e)$/, "")
    .replace(/^y/, "");

  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export interface ReadabilityResult {
  language: string;
  metric: string;
  value: number;
  target: string;
  passes: boolean;
  wordCount: number;
  sentenceCount: number;
  averageWordsPerSentence: number;
  longestSentences: { words: number; text: string }[];
  hardestWords: { syllables: number; word: string }[];
  guidance: string;
  limitation?: string;
}

export function scoreReadability(text: string, language: string): ReadabilityResult {
  const clean = stripMarkdown(text);
  const sentences = splitSentences(clean);
  const words = splitWords(clean);
  const lang = language.toLowerCase().slice(0, 2);

  if (words.length === 0 || sentences.length === 0) {
    return {
      language: lang,
      metric: "none",
      value: 0,
      target: "n/a",
      passes: false,
      wordCount: 0,
      sentenceCount: 0,
      averageWordsPerSentence: 0,
      longestSentences: [],
      hardestWords: [],
      guidance: "There is no readable text to score. Write the handout first.",
    };
  }

  const isSpanish = lang === "es";
  const syllablesOf = isSpanish ? countSyllablesSpanish : countSyllablesEnglish;
  const totalSyllables = words.reduce((sum, w) => sum + syllablesOf(w), 0);

  const wordsPerSentence = words.length / sentences.length;
  const syllablesPerWord = totalSyllables / words.length;

  const longestSentences = sentences
    .map((text) => ({ words: splitWords(text).length, text }))
    .sort((a, b) => b.words - a.words)
    .slice(0, 3)
    .filter((s) => s.words > 15);

  const seen = new Set<string>();
  const hardestWords = words
    .map((word) => ({ word, syllables: syllablesOf(word) }))
    .filter((w) => {
      const key = w.word.toLowerCase();
      if (w.syllables < 4 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.syllables - a.syllables)
    .slice(0, 8);

  let metric: string;
  let value: number;
  let target: string;
  let passes: boolean;
  let limitation: string | undefined;

  if (isSpanish) {
    // Fernandez-Huerta: higher is easier.
    value =
      Math.round((206.84 - 60 * syllablesPerWord - 1.02 * wordsPerSentence) * 10) / 10;
    metric = "Fernandez-Huerta ease (Spanish)";
    target = `>= ${SPANISH_TARGET_EASE}`;
    passes = value >= SPANISH_TARGET_EASE;
  } else if (lang === "en") {
    value =
      Math.round((0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59) * 10) / 10;
    metric = "Flesch-Kincaid grade level (English)";
    target = `<= ${ENGLISH_TARGET_GRADE}`;
    passes = value <= ENGLISH_TARGET_GRADE;
  } else {
    // No validated formula for this language. Fall back to structure alone and
    // say so, rather than reporting a confident number that means nothing.
    value = Math.round(wordsPerSentence * 10) / 10;
    metric = "average words per sentence (structural fallback)";
    target = "<= 14";
    passes = wordsPerSentence <= 14;
    limitation =
      `No validated readability formula is available for "${lang}". This score ` +
      `reflects sentence length only, not vocabulary difficulty. Keep sentences ` +
      `short and prefer everyday words.`;
  }

  const fixes: string[] = [];
  if (longestSentences.length > 0) {
    fixes.push(
      `Split these long sentences: ${longestSentences
        .map((s) => `"${s.text.slice(0, 70)}${s.text.length > 70 ? "…" : ""}" (${s.words} words)`)
        .join("; ")}`,
    );
  }
  if (hardestWords.length > 0) {
    fixes.push(
      `Replace or define these long words: ${hardestWords.map((w) => w.word).join(", ")}`,
    );
  }

  const guidance = passes
    ? `Passes. ${metric} is ${value}, target ${target}.`
    : `Does not pass. ${metric} is ${value}, target ${target}. ` +
      (fixes.length > 0
        ? fixes.join(" ")
        : "Shorten sentences and use more common words, then check again.");

  return {
    language: lang,
    metric,
    value,
    target,
    passes,
    wordCount: words.length,
    sentenceCount: sentences.length,
    averageWordsPerSentence: Math.round(wordsPerSentence * 10) / 10,
    longestSentences,
    hardestWords,
    guidance,
    ...(limitation ? { limitation } : {}),
  };
}

export const checkReadability = tool(
  async ({ text, language }) => JSON.stringify(scoreReadability(text, language), null, 2),
  {
    name: "check_readability",
    description:
      "Score patient-facing text for reading difficulty and get specific fixes. " +
      "Call this on the handout and the follow-up message before finalising them. " +
      "If `passes` is false, apply the suggested fixes and call it again. Do not " +
      "finalise patient-facing text that has not passed.",
    schema: z.object({
      text: z.string().describe("The full patient-facing text to score."),
      language: z
        .string()
        .describe("The patient's preferred language code, e.g. 'en' or 'es'."),
    }),
  },
);
