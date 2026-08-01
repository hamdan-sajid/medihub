"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import type { Patient } from "@/lib/types";

const NEW_PATIENT = "__new__";

/** Languages the readability tool scores with a validated formula. */
const LANGUAGES = [
  { value: "en", label: "English (Flesch-Kincaid)" },
  { value: "es", label: "Spanish (Fernández-Huerta)" },
];

const EXAMPLE = `62F c/o burning when passing urine x 3 days, going more often. no fever, no flank pain, no nausea.
not sexually active. no hx of kidney stones.
obs: temp 36.8, BP 124/78. abdo soft, no suprapubic tenderness.
urine dip: leucs +++, nitrites +, blood +.
imp: uncomplicated UTI.
plan: nitrofurantoin 100mg BD x 5 days. push fluids.
safety net - if fever, flank pain, or vomiting, come back or go to ED.
f/u only if not settling in 48h.`;

export function NewEncounterForm({ patients }: { patients: Patient[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [patientId, setPatientId] = useState<string>(NEW_PATIENT);
  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [language, setLanguage] = useState("en");
  const [visitDate, setVisitDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [clinician, setClinician] = useState("");
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [notes, setNotes] = useState("");

  const isNewPatient = patientId === NEW_PATIENT;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!notes.trim()) {
      setError("Visit notes are required — they are the agent's only input.");
      return;
    }
    if (isNewPatient && (!fullName.trim() || !dob)) {
      setError("A new patient needs a name and a date of birth.");
      return;
    }

    setSaving(true);
    try {
      let resolvedPatientId = patientId;

      if (isNewPatient) {
        const { data, error: patientError } = await supabase
          .from("patients")
          .insert({
            full_name: fullName.trim(),
            date_of_birth: dob,
            preferred_language: language,
          })
          .select("id")
          .single<{ id: string }>();

        if (patientError || !data) {
          throw new Error(
            patientError?.message.includes("row-level security")
              ? "Adding a patient was blocked by row-level security. Run supabase/add-intake-policy.sql in the SQL editor."
              : (patientError?.message ?? "Could not create the patient."),
          );
        }
        resolvedPatientId = data.id;
      }

      const { data: encounter, error: encounterError } = await supabase
        .from("encounters")
        .insert({
          patient_id: resolvedPatientId,
          visit_date: visitDate,
          clinician: clinician.trim() || "Not recorded",
          chief_complaint: chiefComplaint.trim() || null,
          raw_notes: notes,
        })
        .select("id")
        .single<{ id: string }>();

      if (encounterError || !encounter) {
        throw new Error(encounterError?.message ?? "Could not create the visit.");
      }

      toast.success("Visit added", {
        description: "Press Generate packet to run the agent.",
      });
      router.push(`/encounters/${encounter.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[mediHub] intake failed:", err);
      setError(message);
      toast.error("Could not add the visit", { description: message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not add the visit</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label htmlFor="patient">Patient</Label>
            <Select value={patientId} onValueChange={setPatientId}>
              <SelectTrigger id="patient">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_PATIENT}>New patient…</SelectItem>
                {patients.map((patient) => (
                  <SelectItem key={patient.id} value={patient.id}>
                    {patient.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isNewPatient && (
              <p className="text-xs text-muted-foreground">
                The agent will read this patient&apos;s previous visits as
                context via <code>get_patient_history</code>.
              </p>
            )}
          </div>

          {isNewPatient && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Aisha Khan"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dob">Date of birth</Label>
                <Input
                  id="dob"
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="language">Handout language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger id="language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="visitDate">Visit date</Label>
              <Input
                id="visitDate"
                type="date"
                value={visitDate}
                onChange={(e) => setVisitDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clinician">Clinician</Label>
              <Input
                id="clinician"
                value={clinician}
                onChange={(e) => setClinician(e.target.value)}
                placeholder="Dr. Osei"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chief">Chief complaint</Label>
              <Input
                id="chief"
                value={chiefComplaint}
                onChange={(e) => setChiefComplaint(e.target.value)}
                placeholder="burning on urination"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="notes">Visit notes</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setNotes(EXAMPLE);
                  setChiefComplaint("burning on urination");
                  setClinician("Dr. Osei");
                }}
              >
                Use an example
              </Button>
            </div>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={14}
              className="font-mono text-xs leading-relaxed"
              placeholder="Paste the raw notes here, exactly as written."
            />
            <p className="text-xs text-muted-foreground">
              This is the agent&apos;s only clinical input. Everything in the
              packet must trace back to it or to the clinic&apos;s reference
              data.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Adding…" : "Add visit"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
