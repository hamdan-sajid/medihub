import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { db } from "./db.js";
import { env } from "./env.js";
import { executeRun } from "./run.js";

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: (origin) => (env.allowedOrigins.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.get("/health", (c) => c.json({ ok: true, model: env.model }));

/**
 * Start a run and return immediately. Everything after this point reaches the
 * browser through Supabase Realtime, so a dropped connection, a refresh, or a
 * closed tab does not affect the run.
 */
app.post("/runs", async (c) => {
  let body: { encounterId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Body must be JSON." }, 400);
  }

  const encounterId = body.encounterId;
  if (!encounterId) return c.json({ error: "encounterId is required." }, 400);

  const { data: encounter } = await db
    .from("encounters")
    .select("id")
    .eq("id", encounterId)
    .maybeSingle<{ id: string }>();

  if (!encounter) return c.json({ error: "Unknown encounterId." }, 404);

  const { data: run, error } = await db
    .from("runs")
    .insert({ encounter_id: encounterId, status: "queued" })
    .select("id")
    .single<{ id: string }>();

  if (error || !run) {
    return c.json({ error: error?.message ?? "Could not create run." }, 500);
  }

  // Deliberately not awaited. The HTTP response is an acknowledgement, not the
  // result; an unhandled rejection here would otherwise take down the process.
  void executeRun(run.id, encounterId).catch((err) => {
    console.error(`[run ${run.id}] escaped executeRun:`, err);
  });

  return c.json({ runId: run.id }, 202);
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`mediHub agent listening on :${info.port} (model ${env.model})`);
});
