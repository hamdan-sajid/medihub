import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Copy .env.example to .env.local and fill it in.",
  );
}

/**
 * Anon-key client, safe in the browser: RLS allows reads plus artifact review,
 * and the policy on `artifacts` prevents overwriting the agent's own output.
 * The service_role key lives only on the agent server.
 */
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } },
});

/**
 * Where to start a run.
 *
 * By default the agent runs inside this app at /api/runs, so the request is
 * same-origin and there is no CORS involved at all. Setting NEXT_PUBLIC_AGENT_URL
 * points it at a standalone agent server instead (apps/agent/src/server.ts),
 * which is still supported — that server must then allow this origin via its
 * ALLOWED_ORIGINS.
 */
const externalAgent = process.env.NEXT_PUBLIC_AGENT_URL?.trim();

export const RUNS_ENDPOINT = externalAgent
  ? `${externalAgent.replace(/\/$/, "")}/runs`
  : "/api/runs";

export const AGENT_IS_EXTERNAL = Boolean(externalAgent);
