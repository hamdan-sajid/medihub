# Deploying mediHub

Two services: the Next.js app on **Vercel** (required by the brief), the agent
server on **Koyeb**.
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

## 2. Agent server → Koyeb

Koyeb's free instance needs no card. (Render's free tier now asks for one, which
is why this is the primary path; `render.yaml` is still in the repo if you'd
rather use Render.)

1. [app.koyeb.com](https://app.koyeb.com) → sign in with GitHub
2. **Create Service** → **GitHub** → select this repo, branch `main`
3. **Builder: Buildpack**, and override both commands:

   | Setting | Value |
   |---|---|
   | Build command | `npm ci --workspace agent --include-workspace-root && npm run build --workspace agent` |
   | Run command | `npm run start --workspace agent` |

   The `--workspace agent --include-workspace-root` flags matter: a plain
   `npm ci` also installs Next.js and every web dependency the agent never uses.
   Scoped, it's 137 MB; unscoped it's several times that, on a 512 MB instance.

4. **Instance: Free**. Region must be Frankfurt or Washington DC — the free tier
   is not offered elsewhere.
5. **Exposed port: 8000**, health check path `/health`. Koyeb injects `PORT` and
   `env.ts` reads it, so do not set `PORT` yourself.
6. Environment variables:

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | `https://<project>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | your `service_role` key (mark as **secret**) |
   | `GOOGLE_API_KEY` | your AI Studio key (mark as **secret**) |
   | `MEDIHUB_PROVIDER` | `google` |
   | `ALLOWED_ORIGINS` | `http://localhost:3000` for now — corrected in step 4 |

7. Deploy, then verify:

```bash
curl https://<your-service>.koyeb.app/health
# {"ok":true,"model":"gemini-3.5-flash-lite"}
```

Note the URL.

> Koyeb's free instance scales to zero after **1 hour** idle and cannot be
> configured otherwise. Warm it before a demo — see the pre-recording section.

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
   | `NEXT_PUBLIC_AGENT_URL` | `https://<your-service>.koyeb.app` |

   The `anon` key is public by design — it ships to the browser and RLS
   constrains it. The `service_role` key must never appear here.

4. Deploy. Note the production URL.

---

## 4. Close the loop

Back in Koyeb → your service → **Settings → Environment variables**, set:

```
ALLOWED_ORIGINS=https://<your-app>.vercel.app
```

Save and redeploy. Koyeb restarts the service. **This step is not optional** — without it
every request from the deployed frontend is rejected by CORS, and in the browser
that looks like the Generate button doing nothing at all.

If you want Vercel preview deployments to work too, add those origins as well
(comma-separated). Preview URLs change per deploy, so it is usually simpler to
demo from production.

---

## 5. Verify the deployment

```bash
# Agent is awake and can see its model
curl https://<your-service>.koyeb.app/health

# CORS allows the deployed frontend
curl -i -X OPTIONS https://<your-service>.koyeb.app/runs \
  -H "Origin: https://<your-app>.vercel.app" \
  -H "Access-Control-Request-Method: POST" | grep -i access-control-allow-origin
```

The second command must echo your Vercel origin. An empty value means step 4
didn't take.

Then in the browser: open the Vercel URL, pick an encounter, press **Generate
packet**, and confirm the trace populates live.

---

## Before recording the demo

**Warm the agent.** Koyeb's free instance scales to zero after an hour idle, and
scale-to-zero cannot be disabled. The first request after idling waits on a cold
start, which looks broken on camera.

```bash
curl https://<your-service>.koyeb.app/health
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

- **Cold starts.** The free Koyeb instance scales to zero after an hour. A run
  started against a cold instance still completes — the HTTP request only kicks
  it off — but the first click waits on the wake-up.
- **Runs do not survive a restart.** A run lives in the agent process. If the
  instance restarts or scales to zero mid-run, the run is orphaned in `running` forever. Recovering it would
  need either a LangGraph checkpointer with a resume path, or a startup sweep
  that fails runs with no recent step. Neither is built.
- **No auth.** Anyone with the URL sees every patient. Fine for a demo with
  synthetic data, not for a clinic.
- **One process, one rate limiter.** The pacing in `model.ts` is per-process, so
  two instances would each pace independently and together exceed the quota. Irrelevant on the free single-instance plan; relevant the moment you
  scale out.
