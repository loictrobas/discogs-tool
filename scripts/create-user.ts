/**
 * Creates a user from the command line (used once to bootstrap the first admin).
 *   pnpm create-user <username> "<Display name>" <password> [--admin]
 */
import { createClient } from "@supabase/supabase-js";

const [username, displayName, password] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const isAdmin = process.argv.includes("--admin");
if (!username || !displayName || !password) {
  console.error('Uso: pnpm create-user <usuario> "<Nombre>" <contraseña> [--admin]');
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});

(async () => {
  const handle = username.trim().toLowerCase();
  const { data, error } = await db.auth.admin.createUser({
    email: `${handle}@users.discoschetos.app`,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const { error: pErr } = await db
    .from("profiles")
    .insert({ id: data.user.id, username: handle, display_name: displayName, is_admin: isAdmin });
  if (pErr) throw pErr;
  console.log(`Usuario ${handle} creado${isAdmin ? " (admin)" : ""}.`);
})().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
