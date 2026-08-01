# mediHub

**Post-visit follow-up copilot for a small outpatient clinic.**

A clinician drops in the messy notes from a visit. mediHub turns them into a
reviewable follow-up packet:

| Artifact | What it is |
|---|---|
| **Visit summary** | Structured SOAP note with ICD-10 codes and interaction alerts |
| **Patient handout** | Plain-language education, 6th-grade reading level, in the patient's language |
| **Follow-up message** | Short draft message to the patient |
| **Safety review** | An independent reviewer agent's findings on the three drafts above |

Nothing is ever sent to a patient. Every artifact is a draft a clinician reviews,
edits, and approves.

---

## Quickstart

### Prerequisites

- **Node 20+** and **Git**
- A **Supabase** project (free tier)
- A **Google AI Studio** API key (free, no card): https://aistudio.google.com/apikey

### 1. Install

```bash
git clone <your-repo-url> medihub
cd medihub
npm install
```

### 2. Database

In the Supabase SQL editor, run these two files in order:

1. `supabase/schema.sql` — tables, RLS policies, Realtime publication
2. `supabase/seed.sql` — 3 patients, 4 encounters, 44 ICD-10 codes, 18 interaction pairs

### 3. Environment

```bash
cp apps/agent/.env.example apps/agent/.env
cp apps/web/.env.example apps/web/.env.local
```

Fill in `apps/agent/.env`:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
MEDIHUB_PROVIDER=google
GOOGLE_API_KEY=<your key>
```

And `apps/web/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_AGENT_URL=http://localhost:8787
```

The `service_role` key bypasses RLS and lives **only** in the agent's `.env`.
The browser gets the `anon` key, which RLS restricts to reads plus artifact
approval.

### 4. Check everything is wired

```bash
npm run doctor --workspace agent
```

Verifies Supabase reachability, every table's row count, model generation, and
tool calling. Run this first — it turns three possible failures into one clear
message.

### 5. Run it

Two terminals:

```bash
# terminal 1 — agent server on :8787
npm run dev:agent

# terminal 2 — web app on :3000
npm run dev:web
```

Open http://localhost:3000.

---

## Testing it

### Through the UI

1. Open http://localhost:3000 and pick **James Okafor**.
2. Press **Generate packet** and watch the trace populate on the right.
3. When it finishes (~2 minutes on the free tier), check the four tabs.

**What to look for:**

- **James Okafor** is the interesting case. His notes bury two dangers:
  - *"mentions he got some tightness in the chest walking up the hill"* — a red
    flag written as a throwaway aside, which the patient explicitly downplays.
  - Spironolactone added on top of lisinopril — a **major** interaction risking
    hyperkalemia.

  A correct packet escalates the chest pain prominently and carries the
  interaction warning with its potassium recheck. Both should appear in the
  visit summary and the handout.

- **Maria Alvarez** exercises the Spanish path. Her handout should be in
  Spanish, and readability is scored with Fernández-Huerta rather than
  Flesch-Kincaid (which is meaningless for Spanish).

- **Version history.** Where an artifact shows `v1 / v2 / v3`, click through
  them. The agent scored its own draft with `check_readability`, failed, and
  rewrote it. v1 → v2 is usually a visible simplification.

- **Refresh mid-run.** Nothing is lost. The agent writes to Postgres and the
  browser subscribes; it holds no run state.

### From the terminal

```bash
# Run the harness end-to-end with no server or UI. Prints the full trace
# and every artifact. Defaults to the James Okafor encounter.
npm run try --workspace agent
npm run try --workspace agent -- <encounterId>

# Inspect the most recent run
npm run watch --workspace agent
npx tsx apps/agent/src/scripts/watch.ts --full   # includes artifact contents

# Adversarial test of the safety reviewer (see below)
npm run test-reviewer --workspace agent

# Delete runs that never completed, to tidy up demo data
npm run clean-runs --workspace agent
```

### Adding your own visits

**In the app:** press **New visit** on the home page. Pick an existing patient or
add a new one, paste the raw notes, and press **Add visit** — you land on the
encounter page ready to generate a packet. There's a **Use an example** button
that fills in a realistic messy note if you want something to try immediately.

This needs one RLS policy that `schema.sql` gained after the initial release. If
you applied the schema before then, run `supabase/add-intake-policy.sql` once;
otherwise adding a patient fails with a row-level security error (the form tells
you so explicitly).

Choosing an **existing** patient is the more interesting path — the agent reads
their previous visits through `get_patient_history`, which can change the
follow-up interval or reveal that a problem is recurring rather than new.

**In SQL,** for adding several at once:

```sql
insert into patients (full_name, date_of_birth, preferred_language)
values ('Aisha Khan', '1979-04-02', 'en')
returning id;

insert into encounters (patient_id, visit_date, clinician, chief_complaint, raw_notes)
values (
  '<the id returned above>',
  '2026-08-02',
  'Dr. Osei',
  'burning on urination',
  $$62F c/o burning when passing urine x 3 days...$$
);
```

Use `$$…$$` quoting for the notes so apostrophes and line breaks don't need
escaping.

**Write the notes badly on purpose.** Abbreviations, fragments, inconsistent
units, a red flag buried in an aside. Clean notes make the agent look better
than it is — the whole point is handling what clinicians actually write.

### The safety reviewer regression test

`npm run test-reviewer` hands the reviewer a packet with **three planted
defects** and **two legitimate safety statements**, then checks what it does:

| | Expected |
|---|---|
| `lisinopril 40mg` when notes say 20mg | flagged blocking |
| Fabricated `A1c 9.2%` and a diabetes diagnosis | flagged blocking |
| Chest-pain escalation missing from the packet | flagged |
| Hyperkalemia interaction warning (from the tool) | **not** flagged |
| "pain radiating to arm, jaw, or back" (clinic protocol) | **not** flagged |

This test exists because the reviewer failed the last two. See
[Failure modes](#failure-modes-found-while-building).

---

## Architecture

```
Browser ──POST /runs──▶ Agent server (Node, :8787)
   ▲                          │
   │                          │ writes steps + artifacts as it works
   └──── Realtime ──── Supabase Postgres ◀────┘
```

The only call from the frontend to the agent is `POST /runs`, which returns a
`runId` immediately. Everything after that reaches the browser through Supabase
Realtime.

**Why this shape:** a deep agent run takes minutes. Streaming it over a single
HTTP request means a refresh or a dropped connection loses the work. Writing
progress to Postgres instead makes runs survive disconnects, gives the clinical
audit trail you need anyway, and removes all streaming plumbing between the two
services — the same rows drive the live view and the permanent record.

```
apps/
├── web/                      Next.js 16 + Tailwind + shadcn  →  Vercel
│   └── src/
│       ├── app/              encounter list, packet workspace
│       ├── components/       packet-workspace, run-trace, artifact-panes
│       └── lib/              supabase client (anon key), types
└── agent/                    Node + Hono + LangGraph          →  Render
    └── src/
        ├── prompts.ts        domain knowledge for all three agents
        ├── agent.ts          createDeepAgent + subagents
        ├── run.ts            streams the run, persists trace + artifacts
        ├── model.ts          provider abstraction + rate gate
        ├── server.ts         POST /runs
        ├── tools/            5 custom tools
        └── scripts/          doctor, try, watch, test-reviewer, clean-runs
supabase/
├── schema.sql
└── seed.sql
```

### Model providers

Swappable via one env var, because the harness shouldn't care:

| `MEDIHUB_PROVIDER` | Default model | Cost |
|---|---|---|
| `google` (default) | `gemini-3.5-flash-lite` | free tier |
| `groq` | `openai/gpt-oss-120b` | free tier |
| `anthropic` | `claude-sonnet-5` | paid |

---

## What the agents actually do

Three agents, defined in `apps/agent/src/prompts.ts`.

### 1. `medihub` — the main agent

Built with `createDeepAgent` from `deepagents`. It gets a todo list, a virtual
filesystem, and five custom tools.

Before it starts, `run.ts` seeds `encounter.md` into the filesystem: verified
chart data (name, age, language, visit date, clinician) **plus** the raw notes,
in clearly separated sections. This is the single source of truth.

Then it works roughly like this:

1. **Plans** — writes a todo list covering all four artifacts.
2. **Reads `encounter.md`**, then calls `get_patient_history` — prior visits
   often change the follow-up interval or reveal a problem is recurring.
3. **Gathers evidence** — `lookup_icd10` for each diagnosis,
   `check_drug_interactions` on the full medication list.
4. **Writes `soap.md`**, then `handout.md`, then `followup.md`.
5. **Scores its own writing** — calls `check_readability` on patient-facing text
   and rewrites until it passes. This is a real loop: the tool returns a grade
   plus the specific long sentences and multi-syllable words to fix, and the
   agent iterates. Handout v1 → v2 is usually a visible simplification.
6. **Delegates to `safety-reviewer`**.
7. **Acts on the findings** — blocking findings must be fixed and the artifact
   rewritten. One override: it may never delete a safety warning or escalation
   instruction in response to a finding.
8. **Calls `save_packet`** — marks the run `needs_review` and records red flags,
   uncertainties, and the follow-up interval.

If it finishes without calling `save_packet`, `run.ts` marks the run **failed**.
A packet that skipped its safety review must never present as ready.

### 2. `safety-reviewer` — the critic

The reason this is a subagent rather than a self-check: it reads the drafts
**cold**, in a fresh context, with no access to the main agent's reasoning. It
cannot be talked into agreeing with itself.

It reads `encounter.md` and the three drafts from the filesystem, and has the
`lookup_icd10` and `check_drug_interactions` tools so it can **verify** a claim
rather than assume anything absent from the notes was invented.

It checks for: unsupported claims (statement by statement — most of the effort
goes here), omissions, missed red flags, contradictions, reading level, and
out-of-scope advice. It writes `safety.md` and returns JSON with a severity per
finding.

### 3. `education-writer` — handout specialist

Available for a full handout rewrite, with `check_readability`. **In practice
the main agent has never delegated to it** — it prefers to revise the handout
itself, which works fine. It's currently dead weight and would be the first
thing to either cut or force into the workflow.

### The five custom tools

| Tool | What it does |
|---|---|
| `lookup_icd10` | Searches the clinic's code set. Ranks by how much of the query each code covers, because clinicians write "new T2DM", not ICD-10 descriptions. |
| `check_drug_interactions` | Strips dose/route/frequency ("lisinopril 20mg daily" → "lisinopril") and checks every pair against the clinic's reference table. |
| `check_readability` | Flesch-Kincaid for English, Fernández-Huerta for Spanish, structural fallback otherwise. Returns the grade **plus the specific sentences and words to fix** — that's what makes the revision loop converge. |
| `get_patient_history` | Prior encounters. Built per-run, closed over `patientId`, so the model cannot read another patient's chart by hallucinating an ID. |
| `save_packet` | Finalises the run and records red flags and uncertainties. |

---

## Failure modes found while building

Every one of these was found by running the thing, not by reading the code.

**Artifacts silently never persisted.** The filesystem reports `/soap.md`; the
lookup table keyed on `soap.md`. Every artifact failed to match and was dropped
with no error anywhere.

**The rate limiter made things worse.** The provider SDK's retry lives *below*
the pacing wrapper, so one paced call fanned out into seven real requests
back-to-back — a faster way to exhaust a per-minute quota than not pacing at
all. Retries now go through the same gate, and a 429 penalises the shared
limiter using the server's own `retryDelay`.

**Advertised free-tier limits are fiction.** Docs say 250 requests/day.
`gemini-3.6-flash` actually enforces **20/day** on a new key — less than one
complete run. Treat published quotas as marketing.

**The safety reviewer flagged real warnings as hallucinations.** Given only the
raw notes, it reported the clinician's name as unsupported (it came from chart
metadata) and — much worse — reported the tool-derived hyperkalemia warning and
the standard red-flag escalation language as invented. The main agent dutifully
**deleted both**. The reviewer had stripped the two most important safety
features out of the packet.

Fixed structurally rather than by prompt patching: one seeded source document
both agents read, the reviewer given the reference tools so it can verify rather
than assume, an explicit source hierarchy (notes, tool output, clinic protocol),
and a hard rule that acting on a finding may never remove a safety warning.
`npm run test-reviewer` is the regression test.

**The safety review was persisted by luck.** The reviewer was told to *return*
JSON, never to *write* `safety.md`. One run wrote it, the next didn't, same code.
Now it's explicitly instructed to write the file **and** `run.ts` captures its
reply as a fallback — the audit record can't be silently missing.

---

## Known limitations

- **Free-tier latency.** A run takes ~2 minutes, mostly client-side pacing to
  stay under the quota. On a paid tier, raise `MEDIHUB_RPM`.
- **Free-tier privacy.** Google's free tier may use submitted data to improve
  their products. All patient data here is synthetic. Real PHI would need a paid
  tier or a BAA-covered provider.
- **Reference data is tiny.** 44 ICD-10 codes and 18 interaction pairs, enough
  to demonstrate the loop. `check_drug_interactions` says so in its own output:
  absence of a result is not clearance.
- **No auth.** Anyone with the URL can see every patient. Fine for a demo,
  obviously not for a clinic.
- **`education-writer` is unused.** See above.
- **Reviewer noise.** It sometimes reports a legitimate statement as "advisory"
  with "no fix required", which is clutter rather than a finding.
