import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Supabase Auth needs an email; users only ever see their username.
const USERNAME_DOMAIN = "users.discoschetos.app";

export function usernameToEmail(username: string) {
  return `${normalizeUsername(username)}@${USERNAME_DOMAIN}`;
}

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
};

/** Returns the signed-in user's profile, redirecting to /login otherwise. */
export async function requireProfile(): Promise<Profile> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, display_name, is_admin")
    .eq("id", userId)
    .single();
  if (!profile) redirect("/login");
  return profile;
}

/** For route handlers: returns the profile or null (no redirect). */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, display_name, is_admin")
    .eq("id", userId)
    .single();
  return profile ?? null;
}
