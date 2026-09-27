type CaptionRecord = {
  title: string;
  artists: string;
  labels: string;
  catno: string | null;
  year: number | null;
  country: string | null;
  formats: string | null;
  styles: string | null;
  price: number | null;
  currency: string;
  media_condition: string | null;
  sleeve_condition: string | null;
};

type CaptionTrack = { position: string; title: string; artists: string };

export function formatPrice(price: number | null, currency: string) {
  if (price == null) return null;
  const n = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(price);
  return currency === "ARS" ? `$${n} ARS` : `${n} ${currency}`;
}

/** Default Instagram caption. Never includes who owns the record. */
export function buildCaption(r: CaptionRecord, tracks: CaptionTrack[]) {
  const lines: string[] = [];
  lines.push(r.artists ? `${r.artists} – ${r.title}` : r.title);

  const meta = [r.labels, r.catno, r.year, r.country].filter(Boolean).join(" · ");
  if (meta) lines.push(meta);
  if (r.formats) lines.push(r.formats);
  if (r.styles) lines.push(r.styles);

  if (tracks.length) {
    lines.push("");
    for (const t of tracks) {
      const who = t.artists && t.artists !== r.artists ? `${t.artists} – ` : "";
      lines.push(`${t.position ? `${t.position}. ` : ""}${who}${t.title}`);
    }
  }

  const condition = [r.media_condition && `Disco ${r.media_condition}`, r.sleeve_condition && `Funda ${r.sleeve_condition}`]
    .filter(Boolean)
    .join(" / ");
  const price = formatPrice(r.price, r.currency);
  if (condition || price) lines.push("");
  if (condition) lines.push(`Estado: ${condition}`);
  if (price) lines.push(`💲 ${price}`);

  lines.push("", "📩 Consultas por DM");
  return lines.join("\n");
}
