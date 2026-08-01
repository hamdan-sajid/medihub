-- Adds the RLS policy the in-app intake form needs.
--
-- schema.sql already lets anon insert encounters. Adding a patient needs its own
-- policy, so run this once if you applied schema.sql before the intake form
-- existed. Applying it twice is harmless — it drops first.
--
-- This is a public demo. On a real clinic deployment, intake would sit behind
-- authentication and this policy would be scoped to an authenticated role.

drop policy if exists anon_intake on patients;
create policy anon_intake on patients for insert to anon with check (true);
