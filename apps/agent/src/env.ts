import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve .env against this package rather than the current working directory,
// so `npm run` from the monorepo root behaves the same as running in-package.
// Works from src/ under tsx and from dist/ after a build — both are one level
// below the package root. Platform-provided vars already in the environment
// win, which is what we want on Render.
// Bundlers rewrite import.meta.url, and hosted environments have no .env file
// at all — both are fine, the platform supplies the variables directly. A
// failure here must not stop the module loading.
try {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  config({ path: resolve(packageRoot, ".env"), quiet: true });
} catch {
  config({ quiet: true });
}

/**
 * Read an optional variable, treating blank as unset. Hosting platforms often
 * inject empty strings for unset keys, and `?? default` would let "" through as
 * a real value — producing an empty model name rather than the default.
 */
function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function required(name: string): string {
  const value = optional(name);
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

export type Provider = "google" | "anthropic" | "groq";

const PROVIDERS: Provider[] = ["google", "anthropic", "groq"];

/** Sensible model and free-tier request-per-minute defaults per provider. */
const PROVIDER_DEFAULTS: Record<Provider, { model: string; rpm: number; keyVar: string }> = {
  // Google AI Studio's free tier. Published limits are not what the key
  // enforces: gemini-3.6-flash allows only 20 requests per DAY, which is less
  // than one complete run. flash-lite has a workable allowance and is the only
  // Gemini model verified to finish a full packet on this tier.
  //
  // Pinned rather than `gemini-flash-lite-latest`: an alias that silently moves
  // to a new model would change agent behaviour with nothing in the diff.
  // Older models (2.0, and 2.5 on new keys) 404 outright — run `npm run doctor`
  // if a model stops resolving.
  google: { model: "gemini-3.5-flash-lite", rpm: 10, keyVar: "GOOGLE_API_KEY" },
  anthropic: { model: "claude-sonnet-5", rpm: 60, keyVar: "ANTHROPIC_API_KEY" },
  // Groq's free tier is generous on requests but tight on tokens per minute,
  // which is the opposite of Google's constraint. This harness carries a heavy
  // context, so TPM is the limit that bites here — see MEDIHUB_RPM.
  groq: { model: "openai/gpt-oss-120b", rpm: 20, keyVar: "GROQ_API_KEY" },
};

const provider = (optional("MEDIHUB_PROVIDER") ?? "google").toLowerCase() as Provider;
if (!PROVIDERS.includes(provider)) {
  throw new Error(
    `MEDIHUB_PROVIDER must be one of ${PROVIDERS.join(", ")} — got "${provider}".`,
  );
}

const defaults = PROVIDER_DEFAULTS[provider];

export const env = {
  supabaseUrl: required("SUPABASE_URL"),
  /** Service role: bypasses RLS. Never ships to the browser. */
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),

  provider,
  /** Only the selected provider's key is required, so the others can stay unset. */
  apiKey: required(defaults.keyVar),
  model: optional("MEDIHUB_MODEL") ?? defaults.model,
  /**
   * Client-side pacing. On a free tier the agent will otherwise fire a burst of
   * calls, get 429ed, and spend its retry budget on backoff instead of work.
   */
  requestsPerMinute: Number(optional("MEDIHUB_RPM") ?? defaults.rpm),

  port: Number(optional("PORT") ?? 8787),
  /**
   * Comma-separated list of origins allowed to POST /runs.
   *
   * Both loopback spellings are allowed by default: a browser on
   * 127.0.0.1:3000 sends a different Origin than one on localhost:3000, and
   * only allowing one produces a CORS rejection that looks, from the UI, like
   * the button simply doing nothing.
   */
  allowedOrigins: (
    optional("ALLOWED_ORIGINS") ??
    "http://localhost:3000,http://127.0.0.1:3000,http://[::1]:3000"
  )
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
};
