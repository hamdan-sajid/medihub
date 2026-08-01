import {
  ARTIFACT_FILES,
  buildAgent,
  buildSourceDocument,
  buildTaskMessage,
  SOURCE_FILE,
} from "./agent.js";
import { db, loadEncounter, RunRecorder, type ArtifactKind } from "./db.js";

const RECURSION_LIMIT = 150;

/**
 * Read content out of a virtual-filesystem entry.
 *
 * The backend may hand back a bare string, a v2 record (`content` as a string),
 * or a v1 record (`content` as an array of lines). Binary content is ignored —
 * every artifact here is text.
 */
function fileContent(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || !("content" in value)) return null;

  const inner = (value as { content: unknown }).content;
  if (typeof inner === "string") return inner;
  if (Array.isArray(inner) && inner.every((line) => typeof line === "string")) {
    return inner.join("\n");
  }
  return null;
}

function asFileData(content: string) {
  const now = new Date().toISOString();
  return { content, mimeType: "text/markdown", created_at: now, modified_at: now };
}

/**
 * The filesystem backend reports paths rooted at "/" ("/soap.md"), while the
 * agent is told to write "soap.md". Normalise before matching — comparing raw
 * paths silently drops every artifact, which is exactly what it did.
 */
function artifactKindFor(path: string): ArtifactKind | null {
  const name = path.replace(/^\/+/, "").trim().toLowerCase();
  return (ARTIFACT_FILES as Record<string, ArtifactKind>)[name] ?? null;
}

interface ToolCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

interface StreamedMessage {
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  content?: unknown;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : part && typeof part === "object" && "text" in part
            ? String((part as { text: unknown }).text)
            : "",
      )
      .join("");
  }
  return "";
}

/** Tool calls that describe the agent's own bookkeeping rather than its work. */
const NOISY_TOOLS = new Set(["ls", "glob", "grep", "read_file"]);

function summariseToolCall(call: ToolCall): string {
  const args = call.args ?? {};
  switch (call.name) {
    case "lookup_icd10":
      return `Looked up ICD-10 codes for "${String(args.query ?? "")}"`;
    case "check_drug_interactions": {
      const meds = Array.isArray(args.medications) ? args.medications : [];
      return `Checked ${meds.length} medications for interactions`;
    }
    case "check_readability":
      return `Scored readability (${String(args.language ?? "en")})`;
    case "get_patient_history":
      return "Retrieved prior visit notes";
    case "save_packet":
      return "Finalised the packet for review";
    case "write_file":
    case "edit_file":
      return `Wrote ${String(args.file_path ?? args.path ?? "a file")}`;
    case "write_todos":
      return "Updated the plan";
    default:
      return `Called ${call.name ?? "a tool"}`;
  }
}

export async function executeRun(runId: string, encounterId: string): Promise<void> {
  const recorder = new RunRecorder(runId);
  // Content already persisted, so an unchanged file does not create a new version.
  const persisted = new Map<ArtifactKind, string>();
  // Task-tool call ids for safety-reviewer delegations, and the reply text they
  // returned. Used only as a fallback if the reviewer skips writing safety.md —
  // the review is the audit record and must never be silently missing.
  const reviewCallIds = new Set<string>();
  let reviewReply: string | null = null;

  async function persistArtifact(kind: ArtifactKind, content: string) {
    if (persisted.get(kind) === content) return;
    const version = persisted.has(kind) ? undefined : 1;
    persisted.set(kind, content);

    if (version === 1) {
      const { error } = await db
        .from("artifacts")
        .insert({ run_id: runId, kind, version: 1, content });
      if (error) console.error(`[run ${runId}] artifact insert failed:`, error.message);
      await recorder.step("artifact", `Drafted ${kind}`, { kind, version: 1 });
      return;
    }

    // Revision: find the current top version and add one above it.
    const { data } = await db
      .from("artifacts")
      .select("version")
      .eq("run_id", runId)
      .eq("kind", kind)
      .order("version", { ascending: false })
      .limit(1)
      .returns<{ version: number }[]>();

    const next = (data?.[0]?.version ?? 1) + 1;
    const { error } = await db
      .from("artifacts")
      .insert({ run_id: runId, kind, version: next, content });
    if (error) console.error(`[run ${runId}] artifact revision failed:`, error.message);
    await recorder.step("revision", `Revised ${kind} (v${next})`, { kind, version: next });
  }

  try {
    await db.from("runs").update({ status: "running" }).eq("id", runId);

    const { encounter, patient } = await loadEncounter(encounterId);
    await recorder.step("note", `Started packet for ${patient.full_name}`, {
      visitDate: encounter.visit_date,
      language: patient.preferred_language,
    });

    const agent = await buildAgent({
      runId,
      encounterId,
      patientId: patient.id,
      recorder,
    });

    const stream = await agent.stream(
      {
        messages: [{ role: "user", content: buildTaskMessage(encounter, patient) }],
        // Seeded so the main agent and the safety reviewer read identical source
        // material. Passing it only in the task message left the reviewer blind
        // to chart metadata and producing false "unsupported claim" findings.
        files: {
          [`/${SOURCE_FILE}`]: asFileData(buildSourceDocument(encounter, patient)),
        },
      },
      { streamMode: "updates", recursionLimit: RECURSION_LIMIT },
    );

    for await (const chunk of stream) {
      for (const update of Object.values(chunk as Record<string, unknown>)) {
        if (!update || typeof update !== "object") continue;
        const state = update as Record<string, unknown>;

        // The plan, as the agent revises it.
        if (Array.isArray(state.todos)) {
          const todos = state.todos as { content?: string; status?: string }[];
          await recorder.step("plan", "Plan updated", {
            todos: todos.map((t) => ({ content: t.content, status: t.status })),
          });
        }

        // Artifacts, as soon as they land in the virtual filesystem.
        if (state.files && typeof state.files === "object") {
          for (const [path, value] of Object.entries(state.files as Record<string, unknown>)) {
            const kind = artifactKindFor(path);
            if (!kind) continue;
            const content = fileContent(value);
            if (content) await persistArtifact(kind, content);
          }
        }

        // Tool calls and subagent delegations.
        if (Array.isArray(state.messages)) {
          for (const message of state.messages as StreamedMessage[]) {
            // The safety reviewer's reply, in case it never wrote safety.md.
            if (message?.tool_call_id && reviewCallIds.has(message.tool_call_id)) {
              const text = messageText(message.content).trim();
              if (text) reviewReply = text;
            }

            for (const call of message?.tool_calls ?? []) {
              if (call.name === "task") {
                const target = String(call.args?.subagent_type ?? call.args?.subagent ?? "subagent");
                if (/safety/i.test(target) && call.id) reviewCallIds.add(call.id);
                await recorder.step("subagent", `Delegated to ${target}`, {
                  subagent: target,
                  description: call.args?.description ?? null,
                });
              } else if (call.name && !NOISY_TOOLS.has(call.name)) {
                await recorder.step("tool_call", summariseToolCall(call), {
                  tool: call.name,
                  args: call.args ?? {},
                });
              }
            }
          }
        }
      }
    }

    // The reviewer was supposed to write safety.md. If it only replied, keep the
    // reply so the packet still carries its audit record.
    if (!persisted.has("safety_review") && reviewReply) {
      await recorder.step("note", "Captured safety review from subagent reply", {
        reason: "safety.md was not written by the reviewer",
      });
      await persistArtifact("safety_review", reviewReply);
    }

    await recorder.flush();

    // save_packet sets needs_review. If the agent finished without calling it,
    // the run is still incomplete and should not be presented as ready.
    const { data: run } = await db
      .from("runs")
      .select("status")
      .eq("id", runId)
      .single<{ status: string }>();

    if (run?.status === "running") {
      await db
        .from("runs")
        .update({
          status: "failed",
          error: "The agent finished without finalising the packet.",
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[run ${runId}] failed:`, error);
    await recorder.step("note", "Run failed", { error: message });
    await recorder.flush();
    await db
      .from("runs")
      .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
      .eq("id", runId);
  }
}
