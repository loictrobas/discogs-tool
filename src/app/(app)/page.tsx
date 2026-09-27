import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { publicMediaUrl } from "@/lib/supabase/admin";
import { formatPrice } from "@/lib/caption";
import { StatusChip } from "@/components/status";
import type { RecordStatus } from "@/lib/records";

type Row = {
  id: string;
  title: string;
  artists: string;
  labels: string;
  year: number | null;
  status: RecordStatus;
  price: number | null;
  currency: string;
  sold_price: number | null;
  cover_path: string | null;
  owner: { id: string; display_name: string } | null;
  created_at: string;
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "draft", label: "Borradores" },
  { value: "published", label: "Publicados" },
  { value: "sold", label: "Vendidos" },
];

export default async function InventoryPage({ searchParams }: PageProps<"/">) {
  await requireProfile();
  const sp = await searchParams;
  const status = typeof sp.estado === "string" ? sp.estado : "";
  const owner = typeof sp.de === "string" ? sp.de : "";
  // PostgREST filter syntax: strip characters that would break the .or() expression.
  const q = typeof sp.q === "string" ? sp.q.replace(/[,()%*\\]/g, " ").trim() : "";

  const supabase = await createClient();
  const [{ data: profiles }, { data }] = await Promise.all([
    supabase.from("profiles").select("id, display_name").order("display_name"),
    (() => {
      let query = supabase
        .from("records")
        .select("id, title, artists, labels, year, status, price, currency, sold_price, cover_path, created_at, owner:profiles!records_owner_id_fkey(id, display_name)")
        .order("created_at", { ascending: false });
      if (status) query = query.eq("status", status);
      if (owner) query = query.eq("owner_id", owner);
      if (q) query = query.or(`title.ilike.%${q}%,artists.ilike.%${q}%,labels.ilike.%${q}%`);
      return query;
    })(),
  ]);
  const records = (data ?? []) as unknown as Row[];

  const href = (patch: Record<string, string>) => {
    const params = new URLSearchParams({ ...(status && { estado: status }), ...(owner && { de: owner }), ...(q && { q }), ...patch });
    for (const [k, v] of [...params]) if (!v) params.delete(k);
    const s = params.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventario</h1>
          <p className="text-sm text-muted">{records.length} {records.length === 1 ? "disco" : "discos"}</p>
        </div>
      </div>

      <form className="flex gap-2" action="/">
        {status ? <input type="hidden" name="estado" value={status} /> : null}
        {owner ? <input type="hidden" name="de" value={owner} /> : null}
        <input name="q" defaultValue={q} placeholder="Buscar disco, artista o sello" className="input" />
      </form>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 text-sm">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={href({ estado: f.value })}
            className={`chip shrink-0 border px-3 py-1.5 text-sm ${status === f.value ? "border-accent bg-accent/15 text-accent" : "border-line text-muted"}`}
          >
            {f.label}
          </Link>
        ))}
        <span className="mx-1 w-px shrink-0 bg-line" />
        {[{ id: "", display_name: "De todos" }, ...(profiles ?? [])].map((p) => (
          <Link
            key={p.id}
            href={href({ de: p.id })}
            className={`chip shrink-0 border px-3 py-1.5 text-sm ${owner === p.id ? "border-accent bg-accent/15 text-accent" : "border-line text-muted"}`}
          >
            {p.display_name}
          </Link>
        ))}
      </div>

      {records.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <p className="text-muted">{q || status || owner ? "Nada con esos filtros." : "Todavía no hay discos."}</p>
          <Link href="/nuevo" className="btn-primary">Cargar un disco</Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {records.map((r) => (
            <li key={r.id}>
              <Link href={`/discos/${r.id}`} className="card flex items-center gap-3 p-2.5 pr-4 transition hover:border-faint">
                {r.cover_path ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={publicMediaUrl(r.cover_path)} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="size-16 shrink-0 rounded-lg bg-surface-2" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.title}</p>
                  <p className="truncate text-sm text-muted">{[r.artists, r.labels.split(",")[0], r.year].filter(Boolean).join(" · ")}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusChip status={r.status} />
                    {r.owner ? <span className="text-xs text-faint">de {r.owner.display_name}</span> : null}
                  </div>
                </div>
                <div className="shrink-0 text-right text-sm font-semibold">
                  {formatPrice(r.status === "sold" ? (r.sold_price ?? r.price) : r.price, r.currency) ?? <span className="text-faint">—</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
