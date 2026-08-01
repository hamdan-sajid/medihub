# Deploying mediHub

One service on **Vercel**. Supabase is already hosted. Nothing else to sign up
for, no card required.

The agent runs inside the Next.js app as a route handler at `/api/runs`. It
started life as a separate Hono service and can still run that way — see
[Running the agent separately](#running-the-agent-separately) — but the deployed
shape is a single app.

> **Why one service.** Render's free tier now requires a payment method, and
> Koyeb closed its free tier to new signups after being acquired by Mistral in
> February 2026. Vercel is required by the project anyway. Folding the agent in
> removes a second deploy, a second URL, and the CORS configuration between them
> — which was the source of the most confusing bug in this build, because a
> rejected preflight looks exactly like a button that does nothing.
>
> This only works because runs are asynchronous. `POST /api/runs` returns a
> `runId` immediately and all progress reaches the browser through Supabase
> Realtime, so nothing depends on holding an HTTP connection open. On the
> original synchronous-streaming design it would not have been possible.

---

## 1. Push to GitHub

Create an **empty** repo (no README, no .gitignore — the repo has both), then:

```bash
git remote add origin https://github.com/<you>/medihub.git
git branch -M main
git push -u origin main
```

Then check the GitHub file list and confirm no `.env` or `.env.local` was
pushed. `.gitignore` covers them, but verify — a leaked `service_role` key gives
anyone full write access to the database, bypassing RLS entirely.

---

## 2. Database

If this is a fresh Supabase project, run in the SQL editor:

1. `supabase/schema.sql`
2. `supabase/seed.sql`

If you applied `schema.sql` before the in-app intake form existed, also run
`supabase/add-intake-policy.sql`.

---

## 3. Vercel

1. [vercel.com/new](https://vercel.com/new) → import the repo
2. **Root Directory: `apps/web`** — the one setting that matters. Vercel detects
   the npm workspace and installs from the repo root by itself.
3. Environment variables:

   | Variable | Value | Reaches the browser |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` | yes |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your **anon** key | yes |
   | `SUPABASE_URL` | `https://<project>.supabase.co` | no |
   | `SUPABASE_SERVICE_ROLE_KEY` | your **service_role** key | **no — never** |
   | `MEDIHUB_PROVIDER` | `google` | no |
   | `GOOGLE_API_KEY` | your AI Studio key | no |
   | `MEDIHUB_MODEL` | `gemini-3.5-flash-lite` | no |
   | `MEDIHUB_RPM` | `10` | no |

   The `anon` key is public by design and RLS constrains it. Anything without the
   `NEXT_PUBLIC_` prefix stays server-side — that is what keeps the
   `service_role` key and the model API key out of the browser bundle.

4. Deploy.

The build runs `tsc -p ../agent/tsconfig.json` first (the `prebuild` script) to
compile the agent package, then `next build`. `apps/agent/dist` is gitignored and
produced at deploy time.

---

## 4. Verify

```bash
# Agent is wired up and can see its model
curl https://<your-app>.vercel.app/api/runs
# {"ok":true,"model":"gemini-3.5-flash-lite"}

# Error path
curl -X POST https://<your-app>.vercel.app/api/runs \
  -H "Content-Type: application/json" -d '{}'
# {"error":"encounterId is required."}
```

Then in the browser: open the app, pick **James Okafor**, press **Generate
packet**, and watch the trace populate. A complete run takes about two minutes.

If the trace stays empty, check the Vercel function logs — a missing
`GOOGLE_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` fails at module load and shows up
there.

---

## Before recording the demo

**Check quota.** Google's free tier is per-model, per-day and the real limits are
well below the documented ones. Run one packet as a rehearsal — if it completes,
you have budget for the take.

**Tidy the demo data:**

```bash
npm run clean-runs --workspace agent   # deletes runs that never completed
```

Serverless functions have no idle spin-down, so unlike the earlier Render and
Koyeb plans there is no instance to warm first.

---

## Running the agent separately

The standalone server in `apps/agent/src/server.ts` still works, and is still the
better shape if runs ever outgrow the function duration limit.

```bash
npm run dev:agent          # :8787
```

Point the web app at it by setting `NEXT_PUBLIC_AGENT_URL`:

```
NEXT_PUBLIC_AGENT_URL=http://localhost:8787
```

The web app then posts there instead of `/api/runs`, and that server must list
the web app's origin in its own `ALLOWED_ORIGINS`. `render.yaml` is kept in the
repo for this path.

---

## Known deployment constraints

- **300 second ceiling.** Vercel Hobby caps function duration at 300s, including
  work scheduled with `after`. Observed runs are 117–183s, so there is roughly
  40% headroom — but a pathological run (many revision cycles, a slow provider)
  would be killed mid-flight and left in `running`. Pro raises this to 800s.
- **Interrupted runs are not recovered.** A killed function cannot write its own
  failure, so the run row stays `running` forever. Recovery would need either a
  LangGraph checkpointer with a resume path, or a sweep that fails runs with no
  recent step. Neither is built; `npm run clean-runs` deletes them by hand.
- **The rate limiter is per-instance.** `model.ts` paces requests within one
  process. Serverless can run several instances concurrently, each pacing
  independently, so simultaneous runs can together exceed the provider quota.
  Fine for a demo; a shared limiter backed by Postgres or Redis would be needed
  for real concurrency.
- **No auth.** Anyone with the URL sees every patient. Fine for a demo with
  synthetic data, not for a clinic.
- **Free-tier privacy.** Google's free tier may use submitted data to improve
  their products. All patient data here is synthetic. Real PHI would need a paid
  tier or a BAA-covered provider.
