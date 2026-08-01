"use client";

import { CheckIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTimestamp } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import {
  ARTIFACT_LABELS,
  ARTIFACT_ORDER,
  parseSafetyReview,
  type Artifact,
  type ArtifactKind,
} from "@/lib/types";

export function ArtifactPanes({
  artifacts,
  inFlight,
  hasRun,
}: {
  artifacts: Artifact[];
  inFlight: boolean;
  hasRun: boolean;
}) {
  const byKind = useMemo(() => {
    const map = new Map<ArtifactKind, Artifact[]>();
    for (const artifact of artifacts) {
      const list = map.get(artifact.kind) ?? [];
      list.push(artifact);
      map.set(
        artifact.kind,
        list.sort((a, b) => a.version - b.version),
      );
    }
    return map;
  }, [artifacts]);

  const available = ARTIFACT_ORDER.filter((kind) => byKind.has(kind));
  const [active, setActive] = useState<ArtifactKind>("soap");
  const [version, setVersion] = useState<number | null>(null);

  // Follow the agent: when a new artifact type appears, show it.
  useEffect(() => {
    if (available.length > 0 && !available.includes(active)) {
      setActive(available[available.length - 1]!);
      setVersion(null);
    }
  }, [available, active]);

  if (!hasRun) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No packet has been generated for this visit yet.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Press <span className="font-medium">Generate packet</span> to start
            the agent.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (available.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-4/5" />
          <p className="pt-2 text-xs text-muted-foreground">
            Drafts appear here as the agent writes them.
          </p>
        </CardContent>
      </Card>
    );
  }

  const versions = byKind.get(active) ?? [];
  const selected =
    versions.find((a) => a.version === version) ?? versions[versions.length - 1];

  return (
    <Card>
      <CardContent className="pt-6">
        <Tabs
          value={active}
          onValueChange={(value) => {
            setActive(value as ArtifactKind);
            setVersion(null);
          }}
        >
          <TabsList className="flex-wrap">
            {ARTIFACT_ORDER.map((kind) => {
              const list = byKind.get(kind);
              const signedOff = Boolean(list?.at(-1)?.approved_at);
              return (
                <TabsTrigger key={kind} value={kind} disabled={!list}>
                  {signedOff && (
                    <CheckIcon
                      aria-label="approved"
                      className="mr-1 size-3 text-emerald-600"
                    />
                  )}
                  {ARTIFACT_LABELS[kind]}
                  {list && list.length > 1 && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground">
                      v{list.length}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {versions.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2">
            <span className="text-xs text-muted-foreground">
              The agent revised this {versions.length - 1}{" "}
              {versions.length === 2 ? "time" : "times"}:
            </span>
            {versions.map((artifact) => (
              <Button
                key={artifact.id}
                size="sm"
                variant={artifact.id === selected?.id ? "secondary" : "ghost"}
                className="h-6 px-2 text-xs"
                onClick={() => setVersion(artifact.version)}
              >
                v{artifact.version}
                {artifact.version === versions.length && " (final)"}
              </Button>
            ))}
          </div>
        )}

        {selected && (
          <div className="mt-5">
            {selected.kind === "safety_review" ? (
              <SafetyReviewPane artifact={selected} />
            ) : (
              <>
                <Markdown>{selected.edited_content ?? selected.content}</Markdown>
                <ApproveBar artifact={selected} isFinal={selected === versions.at(-1)} />
              </>
            )}
          </div>
        )}

        {inFlight && (
          <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">
            The agent is still working — drafts may still be revised.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The reviewer is asked for JSON. When it complies, render structured findings;
 * when it returns prose instead, show that rather than an error — a review a
 * clinician can read still has value even if it did not parse.
 */
function SafetyReviewPane({ artifact }: { artifact: Artifact }) {
  const parsed = parseSafetyReview(artifact.content);

  if (!parsed) {
    return <Markdown>{artifact.content}</Markdown>;
  }

  const blocking = parsed.findings.filter((f) => f.severity === "blocking");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Independent safety review</span>
        {parsed.findings.length === 0 ? (
          <Badge variant="secondary">No findings</Badge>
        ) : (
          <>
            {blocking.length > 0 && (
              <Badge variant="destructive">
                {blocking.length} blocking
              </Badge>
            )}
            <Badge variant="outline">
              {parsed.findings.length - blocking.length} advisory
            </Badge>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Written by a separate reviewer agent that read the source notes and the
        drafts without seeing the drafting agent&apos;s reasoning. Blocking
        findings were fixed before the packet reached you.
      </p>

      {parsed.findings.length === 0 ? (
        <p className="rounded-md border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
          The reviewer traced every clinical statement back to the source notes
          and found nothing to flag.
        </p>
      ) : (
        <ul className="space-y-3">
          {parsed.findings.map((finding, index) => (
            <li key={index} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    finding.severity === "blocking" ? "destructive" : "outline"
                  }
                  className="text-[10px]"
                >
                  {finding.severity ?? "advisory"}
                </Badge>
                {finding.artifact && (
                  <span className="text-xs text-muted-foreground">
                    {ARTIFACT_LABELS[finding.artifact as ArtifactKind] ??
                      finding.artifact}
                  </span>
                )}
              </div>
              {finding.quote && (
                <blockquote className="mt-2 border-l-2 pl-3 font-mono text-xs text-muted-foreground">
                  {finding.quote}
                </blockquote>
              )}
              {finding.problem && (
                <p className="mt-2 text-sm">{finding.problem}</p>
              )}
              {finding.fix && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Suggested fix: {finding.fix}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ApproveBar({
  artifact,
  isFinal,
}: {
  artifact: Artifact;
  isFinal: boolean;
}) {
  const [approvedAt, setApprovedAt] = useState(artifact.approved_at);
  const [saving, setSaving] = useState(false);

  useEffect(() => setApprovedAt(artifact.approved_at), [artifact.id, artifact.approved_at]);

  if (!isFinal) {
    return (
      <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">
        Viewing an earlier draft. Switch to the final version to approve.
      </p>
    );
  }

  async function approve() {
    setSaving(true);
    const at = new Date().toISOString();
    const { error } = await supabase
      .from("artifacts")
      .update({ approved_at: at })
      .eq("id", artifact.id);
    setSaving(false);

    if (error) {
      toast.error("Could not record approval", { description: error.message });
      return;
    }
    setApprovedAt(at);
    toast.success(`${ARTIFACT_LABELS[artifact.kind]} approved`);
  }

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      {/* Timestamps render in the viewer's timezone, so they must not appear in
          the server HTML — suppress rather than risk a hydration mismatch. */}
      <p className="text-xs text-muted-foreground" suppressHydrationWarning>
        {approvedAt
          ? `Approved ${formatTimestamp(approvedAt)}`
          : "Nothing is sent to the patient until a clinician approves it."}
      </p>
      <Button
        size="sm"
        variant={approvedAt ? "secondary" : "default"}
        disabled={saving || Boolean(approvedAt)}
        onClick={approve}
      >
        {approvedAt ? "Approved" : saving ? "Saving…" : "Approve"}
      </Button>
    </div>
  );
}
