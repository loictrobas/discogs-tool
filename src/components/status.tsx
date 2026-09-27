import type { RecordStatus } from "@/lib/records";

const STYLES: Record<RecordStatus, { label: string; className: string }> = {
  draft: { label: "Borrador", className: "bg-surface-2 text-muted" },
  published: { label: "Publicado", className: "bg-accent/15 text-accent" },
  sold: { label: "Vendido", className: "bg-ok/15 text-ok" },
};

export function StatusChip({ status }: { status: RecordStatus }) {
  const s = STYLES[status];
  return <span className={`chip ${s.className}`}>{s.label}</span>;
}
