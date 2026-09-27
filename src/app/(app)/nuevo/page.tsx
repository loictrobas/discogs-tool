import { NewRecordForm } from "./new-record-form";

export const maxDuration = 60;

export default function NewRecordPage() {
  return (
    <div className="mx-auto max-w-lg space-y-6 pt-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Nuevo disco</h1>
        <p className="mt-1 text-sm text-muted">
          Pegá el link de Discogs. Traigo portada, tracks y busco el audio de cada tema.
        </p>
      </div>
      <NewRecordForm />
    </div>
  );
}
