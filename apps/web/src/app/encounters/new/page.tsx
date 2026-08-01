import Link from "next/link";
import { NewEncounterForm } from "@/components/new-encounter-form";
import { supabase } from "@/lib/supabase";
import type { Patient } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewEncounterPage() {
  const { data: patients } = await supabase
    .from("patients")
    .select("id, full_name, date_of_birth, preferred_language")
    .order("full_name")
    .returns<Patient[]>();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <Link
        href="/"
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← All visits
      </Link>
      <header className="mt-4 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">New visit</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Paste the notes exactly as they were written — abbreviations,
          fragments, missing pieces and all. Tidying them up first makes the
          agent look better than it is.
        </p>
      </header>
      <NewEncounterForm patients={patients ?? []} />
    </main>
  );
}
