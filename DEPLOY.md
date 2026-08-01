# Deploying mediHub

Two services: the Next.js app on **Vercel**, the agent server on **Render**.
Both free tier. Supabase is already hosted.

There is a chicken-and-egg problem — the agent needs to allow the web app's
origin, and the web app needs the agent's URL. So deploy the agent first, then
the web app, then come back and update one variable on the agent.

---

## 1. Push to GitHub

Create an **empty** repo on GitHub (no README, no .gitignore — the repo already
has both), then:

```bash
git remote add origin https://github.com/<you>/medihub.git
git branch -M main
git push -u origin main
```

Confirm `.env` files did **not** get pushed. `.gitignore` covers them, but check
the GitHub file list anyway — a leaked `service_role` key gives anyone full
write access to your database, bypassing RLS entirely.

---

## 2. Agent server → Render

**Option A — Blueprint (reads `render.yaml`, less to get wrong):**

1. [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect the repo. Render reads `render.yaml` and prompts for the secrets.
3. Fill in:

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | `https://<project>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | your `service_role` key |
   | `GOOGLE_API_KEY` | your AI Studio key |
   | `ALLOWED_ORIGINS` | `http://localhost:3000` for now — corrected in step 4 |

**Option B — manual web service:**

Same values, plus:

- **Root directory:** leave blank (build from the repo root so workspaces resolve)
- **Build command:** `npm ci && npm run build --workspace agent`
- **Start command:** `npm run start --workspace agent`
- **Health check path:** `/health`

Do **not** set `PORT` — Render injects it and `env.ts` reads it.

When it's live, check it:

```bash
curl https://<your-service>.onrender.com/health
# {"ok":true,"model":"gemini-3.5-flash-lite"}
```

Note the URL.

---

## 3. Web app → Vercel

1. [vercel.com/new](https://vercel.com/new) → import the repo
2. **Root Directory: `apps/web`** — this is the one setting that matters. Vercel
   detects the npm workspace and installs from the repo root automatically.
3. Environment variables:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your **anon** key |
   | `NEXT_PUBLIC_AGENT_URL` | `https://<your-service>.onrender.com` |

   The `anon` key is public by design — it ships to the browser and RLS
   constrains it. The `service_role` key must never appear here.

4. Deploy. Note the production URL.

---

## 4. Close the loop

Back in Render → your service → **Environment**, set:

```
ALLOWED_ORIGINS=https://<your-app>.vercel.app
```

Save. Render restarts automatically. **This step is not optional** — without it
every request from the deployed frontend is rejected by CORS, and in the browser
that looks like the Generate button doing nothing at all.

If you want Vercel preview deployments to work too, add those origins as well
(comma-separated). Preview URLs change per deploy, so it is usually simpler to
demo from production.

---

## 5. Verify the deployment

```bash
# Agent is awake and can see its model
curl https://<your-service>.onrender.com/health

# CORS allows the deployed frontend
curl -i -X OPTIONS https://<your-service>.onrender.com/runs \
  -H "Origin: https://<your-app>.vercel.app" \
  -H "Access-Control-Request-Method: POST" | grep -i access-control-allow-origin
```

The second command must echo your Vercel origin. An empty value means step 4
didn't take.

Then in the browser: open the Vercel URL, pick an encounter, press **Generate
packet**, and confirm the trace populates live.

---

## Before recording the demo

**Warm the agent.** Render's free tier spins down after ~15 minutes idle, and a
cold start takes roughly 50 seconds. The first request after idling will look
broken on camera.

```bash
curl https://<your-service>.onrender.com/health
```

**Check quota.** Google's free tier is per-model, per-day and the real limits are
lower than documented. Run one packet as a rehearsal — if it completes, you have
budget for the take.

**Tidy the demo data:**

```bash
npm run clean-runs --workspace agent   # deletes runs that never completed
```

---

## Known deployment constraints

- **Cold starts.** Free Render spins down. A run started against a cold instance
  still completes — the HTTP request only kicks it off — but the first click
  waits on the wake-up.
- **Runs do not survive a restart.** A run lives in the agent process. If Render
  restarts mid-run, the run is orphaned in `running` forever. Recovering it would
  need either a LangGraph checkpointer with a resume path, or a startup sweep
  that fails runs with no recent step. Neither is built.
- **No auth.** Anyone with the URL sees every patient. Fine for a demo with
  synthetic data, not for a clinic.
- **One process, one rate limiter.** The pacing in `model.ts` is per-process, so
  two Render instances would each pace independently and together exceed the
  quota. Irrelevant on the free single-instance plan; relevant the moment you
  scale out.
