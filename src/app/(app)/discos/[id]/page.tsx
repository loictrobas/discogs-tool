import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { defaultCaption, getRecord, getTracks, updateRecord } from "@/lib/records";
import { publicMediaUrl } from "@/lib/supabase/admin";
import { RecordEditor } from "./record-editor";

// Rendering a video runs inside a server action on this page.
export const maxDuration = 60;

export default async function RecordPage({ params }: PageProps<"/discos/[id]">) {
  await requireProfile();
  const { id } = await params;

  const record = await getRecord(id).catch(() => null);
  if (!record) notFound();
  if (!record.caption) {
    record.caption = await defaultCaption(id);
    await updateRecord(id, { caption: record.caption });
  }

  const supabase = await createClient();
  const [tracks, { data: profiles }] = await Promise.all([
    getTracks(id),
    supabase.from("profiles").select("id, display_name").order("display_name"),
  ]);

  const mediaBase = publicMediaUrl("");
  return <RecordEditor record={record} tracks={tracks} profiles={profiles ?? []} mediaBase={mediaBase} />;
}
