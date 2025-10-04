import os
from pathlib import Path
from discogs_tool.src.discogs_meta import fetch_release_info

def sanitize_filename(name: str) -> str:
    bad = '<>:"/\\|?*'
    for c in bad:
        name = name.replace(c, "_")
    return name.strip()

def make_release_txt(discogs_url: str, out_dir: str = "outputs") -> str:
    info = fetch_release_info(discogs_url)
    Path(out_dir).mkdir(parents=True, exist_ok=True)

    title_for_file = sanitize_filename(info.title or "release")
    txt_path = os.path.join(out_dir, f"{title_for_file}.txt")

    lines = []
    lines.append(f"Release: {info.title}")
    if info.artists:
        lines.append(f"Artista(s): {', '.join(info.artists)}")
    if info.year:
        lines.append(f"Año: {info.year}")
    if info.country:
        lines.append(f"País: {info.country}")

    # Precios
    lines.append("\nPrecios (Discogs Marketplace):")
    if info.price_min or info.price_median or info.price_max:
        lines.append(f"  Mínimo: {info.price_min} {info.marketplace_currency or ''}")
        lines.append(f"  Mediana: {info.price_median} {info.marketplace_currency or ''}")
        lines.append(f"  Máximo: {info.price_max} {info.marketplace_currency or ''}")
    else:
        lines.append("  No disponible")

    lines.append("\nTracklist:")
    for t in info.tracks:
        pos = (t.position + " - ") if t.position else ""
        dur = f" ({t.duration})" if t.duration else ""
        lines.append(f"{pos}{t.title}{dur}")

    content = "\n".join(lines) + "\n"
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"TXT generado en: {txt_path}")
    return txt_path