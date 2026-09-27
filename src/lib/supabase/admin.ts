import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/** Service-role client. Bypasses RLS: only use after checking the caller. */
export function createAdminClient() {
  return createClient(env.supabaseUrl(), env.supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const MEDIA_BUCKET = "media";

export function publicMediaUrl(path: string) {
  return `${env.supabaseUrl()}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`;
}
