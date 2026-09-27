import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CreateUserForm, ResetPasswordForm } from "./user-forms";

export default async function UsersPage() {
  const me = await requireProfile();
  if (!me.is_admin) redirect("/");

  const supabase = await createClient();
  const { data: users } = await supabase
    .from("profiles")
    .select("id, username, display_name, is_admin, created_at")
    .order("created_at");

  return (
    <div className="mx-auto max-w-lg space-y-6 pt-2">
      <h1 className="text-2xl font-bold tracking-tight">Usuarios</h1>

      <ul className="space-y-2">
        {(users ?? []).map((u) => (
          <li key={u.id} className="card space-y-3 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{u.display_name}</p>
                <p className="text-xs text-muted">@{u.username}{u.is_admin ? " · admin" : ""}</p>
              </div>
            </div>
            <ResetPasswordForm userId={u.id} />
          </li>
        ))}
      </ul>

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">Crear usuario</h2>
        <CreateUserForm />
      </section>
    </div>
  );
}
