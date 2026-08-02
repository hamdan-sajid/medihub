import { after, NextResponse } from "next/server";

/**
 * Start a packet run.
 *
 * The agent originally ran as a separate Hono service. It lives here because
 * both free-tier hosts we tried became unusable — Render now requires a card,
 * and Koyeb closed its free tier to new signups after being acquired. Vercel is
 * required by the project anyway, so folding the agent in removes a whole
 * service, its deploy, and the CORS configuration that goes with it.
 *
 * This only works because runs are asynchronous. The response carries a runId
 * and nothing else; all progress reaches the browser through Supabase Realtime.
 * `after` keeps the work going once the response has been sent, and inherits
 * this route's maxDuration.
 *
 * `apps/agent/src/server.ts` still exists and still works — useful for local
 * development, and for hosting the agent separately if the duration ceiling
 * ever becomes a problem.
 */
export const runtime = "nodejs";

/**
 * 300s is the Hobby ceiling. Observed runs land between 117s and 183s, so there
 * is roughly 40% headroom. A run that exceeds this is killed mid-flight and left
 * in `running` — see the stale-run note in DEPLOY.md.
 */
export const maxDuration = 300;

/**
 * Imported inside the handlers, not at module scope.
 *
 * The agent validates its environment when its modules load, and `next build`
 * evaluates this module while collecting page data — so a top-level import made
 * the build itself require runtime secrets, failing with "Failed to collect page
 * data" if any were absent. Build time has no business needing an API key.
 *
 * Deferring the import means the app builds without secrets and a missing
 * variable surfaces as a clear 500 on the first request instead.
 */
function loadAgent() {
  return import("agent");
}

export async function POST(request: Request) {
  let body: { encounterId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const encounterId = body.encounterId;
  if (!encounterId) {
    return NextResponse.json({ error: "encounterId is required." }, { status: 400 });
  }

  let db: Awaited<ReturnType<typeof loadAgent>>["db"];
  let executeRun: Awaited<ReturnType<typeof loadAgent>>["executeRun"];
  try {
    ({ db, executeRun } = await loadAgent());
  } catch (error) {
    // Almost always a missing environment variable. Say so plainly rather than
    // letting it surface as an opaque 500.
    const message = error instanceof Error ? error.message : String(error);
    console.error("[mediHub] agent failed to initialise:", error);
    return NextResponse.json(
      { error: `Agent is not configured: ${message}` },
      { status: 500 },
    );
  }

  const { data: encounter } = await db
    .from("encounters")
    .select("id")
    .eq("id", encounterId)
    .maybeSingle<{ id: string }>();

  if (!encounter) {
    return NextResponse.json({ error: "Unknown encounterId." }, { status: 404 });
  }

  const { data: run, error } = await db
    .from("runs")
    .insert({ encounter_id: encounterId, status: "queued" })
    .select("id")
    .single<{ id: string }>();

  if (error || !run) {
    return NextResponse.json(
      { error: error?.message ?? "Could not create run." },
      { status: 500 },
    );
  }

  // executeRun handles its own failures and records them on the run row, so a
  // rejection here would be genuinely unexpected — log it rather than let it
  // become an unhandled rejection.
  after(async () => {
    try {
      await executeRun(run.id, encounterId);
    } catch (err) {
      console.error(`[run ${run.id}] escaped executeRun:`, err);
    }
  });

  return NextResponse.json({ runId: run.id }, { status: 202 });
}

/** Health check. Also the quickest way to confirm a deployment's env vars. */
export async function GET() {
  try {
    const { env } = await loadAgent();
    return NextResponse.json({ ok: true, model: env.model });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
