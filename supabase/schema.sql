-- mediHub — post-visit follow-up copilot
-- Apply in the Supabase SQL editor, then run seed.sql.

-- ---------------------------------------------------------------------------
-- Clinical records
-- ---------------------------------------------------------------------------

create table patients (
  id                 uuid primary key default gen_random_uuid(),
  full_name          text not null,
  date_of_birth      date not null,
  preferred_language text not null default 'en',
  created_at         timestamptz not null default now()
);

create table encounters (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients (id) on delete cascade,
  visit_date    date not null,
  clinician     text not null,
  chief_complaint text,
  -- The messy free-text the clinician actually pastes in. This is the input.
  raw_notes     text not null,
  created_at    timestamptz not null default now()
);

create index encounters_patient_idx on encounters (patient_id, visit_date desc);

-- ---------------------------------------------------------------------------
-- Agent runs. The UI subscribes to these two tables over Realtime.
-- ---------------------------------------------------------------------------

create type run_status as enum ('queued', 'running', 'needs_review', 'failed');

create table runs (
  id           uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references encounters (id) on delete cascade,
  status       run_status not null default 'queued',
  error        text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

create index runs_encounter_idx on runs (encounter_id, created_at desc);

-- One row per meaningful thing the agent does. This is the live trace the
-- reviewer watches, and the audit trail a clinical product needs.
create type step_kind as enum ('plan', 'tool_call', 'subagent', 'artifact', 'revision', 'note');

create table run_steps (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references runs (id) on delete cascade,
  seq        int not null,
  kind       step_kind not null,
  title      text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

create index run_steps_run_idx on run_steps (run_id, seq);

-- ---------------------------------------------------------------------------
-- Artifacts. Versioned, because the safety reviewer sends drafts back.
-- ---------------------------------------------------------------------------

create type artifact_kind as enum ('soap', 'handout', 'followup', 'safety_review');

create table artifacts (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references runs (id) on delete cascade,
  kind       artifact_kind not null,
  version    int not null default 1,
  content    text not null,
  -- readability grade, ICD-10 codes, flags raised, etc.
  metadata   jsonb not null default '{}'::jsonb,
  -- Clinician edits land here; content stays as the agent wrote it.
  edited_content text,
  approved_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, kind, version)
);

create index artifacts_run_idx on artifacts (run_id, kind, version desc);

-- ---------------------------------------------------------------------------
-- Reference data backing the custom tools
-- ---------------------------------------------------------------------------

create table icd10_codes (
  code        text primary key,
  description text not null,
  category    text not null
);

-- Trigram search so lookup_icd10 tolerates loose clinical phrasing.
create extension if not exists pg_trgm;
create index icd10_description_idx on icd10_codes using gin (description gin_trgm_ops);

create table drug_interactions (
  id          uuid primary key default gen_random_uuid(),
  drug_a      text not null,
  drug_b      text not null,
  severity    text not null check (severity in ('minor', 'moderate', 'major')),
  description text not null,
  unique (drug_a, drug_b)
);

create index drug_interactions_a_idx on drug_interactions (drug_a);
create index drug_interactions_b_idx on drug_interactions (drug_b);

-- ---------------------------------------------------------------------------
-- Realtime: the browser watches runs, steps, and artifacts.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table runs;
alter publication supabase_realtime add table run_steps;
alter publication supabase_realtime add table artifacts;

-- Realtime only emits full row payloads for updates with a replica identity.
alter table runs replica identity full;
alter table artifacts replica identity full;

-- ---------------------------------------------------------------------------
-- RLS. This is a public demo: the browser reads everything and may approve or
-- edit artifacts. Only the agent (service role, which bypasses RLS) writes
-- runs, steps, and artifact content.
-- ---------------------------------------------------------------------------

alter table patients          enable row level security;
alter table encounters        enable row level security;
alter table runs              enable row level security;
alter table run_steps         enable row level security;
alter table artifacts         enable row level security;
alter table icd10_codes       enable row level security;
alter table drug_interactions enable row level security;

create policy anon_read on patients          for select to anon using (true);
create policy anon_read on encounters        for select to anon using (true);
create policy anon_read on runs              for select to anon using (true);
create policy anon_read on run_steps         for select to anon using (true);
create policy anon_read on artifacts         for select to anon using (true);
create policy anon_read on icd10_codes       for select to anon using (true);
create policy anon_read on drug_interactions for select to anon using (true);

-- Demo users can add a patient and paste in a new encounter from the UI. On a
-- real clinic deployment intake would sit behind auth and these would be scoped
-- to an authenticated role.
create policy anon_insert on encounters for insert to anon with check (true);
create policy anon_intake on patients   for insert to anon with check (true);

-- Clinician review: edit and approve, but never rewrite the agent's own output.
create policy anon_review on artifacts for update to anon
  using (true)
  with check (content = (select a.content from artifacts a where a.id = artifacts.id));
