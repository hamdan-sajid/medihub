"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Run, RunStep, StepKind } from "@/lib/types";

/**
 * The agent's trace. Same rows the run is audited from — one mechanism serving
 * both the live view and the permanent record.
 */
export function RunTrace({ steps, run }: { steps: RunStep[]; run: Run | null }) {
  const inFlight = run?.status === "queued" || run?.status === "running";

  return (
    <Card className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-6rem)]">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          What the agent did
        </CardTitle>
        {steps.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {steps.length} step{steps.length === 1 ? "" : "s"}
          </span>
        )}
      </CardHeader>
      <CardContent>
        {steps.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {run
              ? "Waiting for the agent to start…"
              : "Generate a packet to watch the agent work."}
          </p>
        ) : (
          <ScrollArea className="h-[28rem] pr-3">
            <ol className="space-y-0">
              {steps.map((step, index) => (
                <StepRow
                  key={step.id}
                  step={step}
                  isLast={index === steps.length - 1}
                  isActive={inFlight && index === steps.length - 1}
                />
              ))}
            </ol>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

const KIND_STYLES: Record<StepKind, { dot: string; label: string }> = {
  plan: { dot: "bg-blue-500", label: "plan" },
  tool_call: { dot: "bg-zinc-400", label: "tool" },
  subagent: { dot: "bg-violet-500", label: "subagent" },
  artifact: { dot: "bg-emerald-500", label: "draft" },
  revision: { dot: "bg-amber-500", label: "revision" },
  note: { dot: "bg-zinc-300", label: "note" },
};

function StepRow({
  step,
  isLast,
  isActive,
}: {
  step: RunStep;
  isLast: boolean;
  isActive: boolean;
}) {
  const style = KIND_STYLES[step.kind] ?? KIND_STYLES.note;
  const detail = describeDetail(step);

  return (
    <li className="relative flex gap-3 pb-4 pl-1">
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[7px] top-4 h-full w-px bg-border"
        />
      )}
      <span
        aria-hidden
        className={`relative mt-1.5 h-[9px] w-[9px] shrink-0 rounded-full ${style.dot} ${
          isActive ? "animate-pulse ring-4 ring-primary/15" : ""
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm leading-snug">{step.title}</span>
          {(step.kind === "subagent" ||
            step.kind === "revision" ||
            step.kind === "plan") && (
            <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
              {style.label}
            </Badge>
          )}
        </div>
        {detail && (
          <p className="mt-0.5 break-words text-xs text-muted-foreground">{detail}</p>
        )}
      </div>
    </li>
  );
}

/**
 * Surface the part of `detail` a clinician would care about. Tool args are the
 * evidence for what the agent claims, so showing them is the point.
 */
function describeDetail(step: RunStep): string | null {
  const detail = step.detail ?? {};

  if (step.kind === "plan" && Array.isArray(detail.todos)) {
    const todos = detail.todos as { content?: string; status?: string }[];
    const done = todos.filter((t) => t.status === "completed").length;
    return `${done}/${todos.length} complete`;
  }

  if (step.kind === "tool_call") {
    const args = (detail.args ?? {}) as Record<string, unknown>;
    switch (detail.tool) {
      case "lookup_icd10":
        return null; // the title already names the query
      case "check_drug_interactions":
        return Array.isArray(args.medications)
          ? (args.medications as string[]).join(", ")
          : null;
      case "check_readability":
        return null;
      case "save_packet": {
        const flags = Array.isArray(args.redFlags) ? args.redFlags.length : 0;
        const unknowns = Array.isArray(args.uncertainties)
          ? args.uncertainties.length
          : 0;
        return `${flags} red flag${flags === 1 ? "" : "s"}, ${unknowns} uncertaint${
          unknowns === 1 ? "y" : "ies"
        }`;
      }
      default:
        return null;
    }
  }

  if (step.kind === "note" && typeof detail.error === "string") {
    return detail.error.slice(0, 200);
  }

  if (step.kind === "note" && Array.isArray(detail.redFlags)) {
    const flags = detail.redFlags as string[];
    return flags.length > 0 ? flags.join(" · ") : null;
  }

  return null;
}
