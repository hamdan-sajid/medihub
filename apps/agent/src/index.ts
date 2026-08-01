/**
 * Public surface of the agent package.
 *
 * The harness runs in two places from the same source: the standalone Hono
 * server in `server.ts` (handy for local development and for hosting the agent
 * separately), and a Next.js route handler in the web app, which is how it is
 * deployed. Neither owns the logic — both call `executeRun`.
 */
export { executeRun } from "./run.js";
export { db, loadEncounter, RunRecorder } from "./db.js";
export { env } from "./env.js";
export { buildModel } from "./model.js";
export type { ArtifactKind, StepKind, EncounterRow, PatientRow } from "./db.js";
