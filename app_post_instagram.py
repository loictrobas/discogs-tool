# discogs_tool/src/app_post_instagram.py
# -*- coding: utf-8 -*-
import os, time, mimetypes, datetime, re
from pathlib import Path
from typing import List, Tuple

import streamlit as st
import requests
from dotenv import load_dotenv
from google.cloud import storage
from google.oauth2 import service_account

import gspread
from google.oauth2.service_account import Credentials



load_dotenv()

# ==== ENV requeridos ====
GCS_JSON   = (os.getenv("GCS_CREDENTIALS_JSON") or "").strip()
GCS_BUCKET = (os.getenv("GCS_BUCKET") or "").strip()
GCS_PREFIX = (os.getenv("GCS_PREFIX") or "discogs-posts").strip().strip("/")
IG_USER_ID = (os.getenv("IG_USER_ID") or "").strip()
IG_TOKEN   = (os.getenv("IG_ACCESS_TOKEN") or "").strip()

GRAPH = "https://graph.facebook.com/v20.0"

# === Google Sheets config ===
SCOPES = ["https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive"]

def sheets_client():
    creds = Credentials.from_service_account_file(GCS_JSON, scopes=SCOPES)
    return gspread.authorize(creds)

# ID de tu Sheet (copialo de la URL)
SHEET_ID = "11VvOH_7A7AsnhRO4TAG4R1sxZctiRZdwBuWtyidDCbk"


def env_ok() -> bool:
    ok = True
    if not GCS_JSON or not Path(GCS_JSON).exists():
        st.error("Falta GCS_CREDENTIALS_JSON o el archivo no existe.")
        ok = False
    if not GCS_BUCKET:
        st.error("Falta GCS_BUCKET.")
        ok = False
    if not IG_USER_ID or not IG_TOKEN:
        st.error("Faltan IG_USER_ID / IG_ACCESS_TOKEN.")
        ok = False
    return ok

# ==== GCS helpers ====
def gcs_client():
    creds = service_account.Credentials.from_service_account_file(GCS_JSON)
    return storage.Client(credentials=creds)

def upload_signed(local_path: Path, key_prefix: str, expires_seconds: int = 7200) -> str:
    """
    Sube el archivo a GCS y devuelve una Signed URL (V4) de lectura GET.
    Compatible con Uniform Bucket-Level Access (no usa ACL).
    """
    client = gcs_client()
    bucket = client.bucket(GCS_BUCKET)
    dest_name = f"{key_prefix}/{local_path.name}" if key_prefix else local_path.name
    blob = bucket.blob(dest_name)

    ctype, _ = mimetypes.guess_type(local_path.name)
    blob.upload_from_filename(str(local_path), content_type=ctype or "video/mp4")

    url = blob.generate_signed_url(
        version="v4",
        expiration=datetime.timedelta(seconds=expires_seconds),
        method="GET",
        response_disposition=f'inline; filename="{local_path.name}"',
    )
    return url

# ==== IG helpers ====
def ig_create_child_video_for_carousel(video_url: str) -> str:
    """
    Crea un 'child' de carrusel para VIDEO:
    - media_type=VIDEO
    - is_carousel_item=true
    """
    r = requests.post(
        f"{GRAPH}/{IG_USER_ID}/media",
        data={
            "media_type": "VIDEO",
            "video_url": video_url,
            "is_carousel_item": "true",
            "access_token": IG_TOKEN,
        },
        timeout=180,
    )
    if r.status_code != 200:
        st.error(f"IG ERROR child: {r.status_code} {r.text}")
        r.raise_for_status()
    return r.json()["id"]

def ig_wait_finished(creation_id: str, timeout_sec: int = 300, show_log: bool = True) -> str:
    """Espera a que el media container esté listo y muestra el estado en tiempo real."""
    t0 = time.time()
    last_status = None
    attempt = 0

    while time.time() - t0 < timeout_sec:
        attempt += 1
        try:
            r = requests.get(
                f"{GRAPH}/{creation_id}",
                params={"fields": "status_code", "access_token": IG_TOKEN},
                timeout=30,
            )
            r.raise_for_status()
            status = r.json().get("status_code", "UNKNOWN")
        except Exception as e:
            status = f"⚠️ error {e}"
        
        # Mostrar estado en tiempo real (solo si cambia)
        if status != last_status:
            if show_log:
                st.write(f"🕒 [{attempt}] Estado actual: {status}")
            last_status = status

        # Si está listo
        if status in ("FINISHED", "PUBLISHED"):
            st.success(f"✅ Contenedor {creation_id} listo ({status})")
            return status

        # Si algo falló de entrada
        if status in ("ERROR", "EXPIRED"):
            st.error(f"❌ Error al procesar {creation_id}: {status}")
            raise RuntimeError(f"Container {creation_id} terminó con estado {status}")

        time.sleep(5)

    raise TimeoutError(f"Timeout esperando FINISHED para {creation_id} (último estado: {last_status})")

def ig_create_carousel_parent(children_ids: List[str], caption: str) -> str:
    """Crea el contenedor padre del carrusel."""
    r = requests.post(
        f"{GRAPH}/{IG_USER_ID}/media",
        data={
            "media_type": "CAROUSEL",
            "children": ",".join(children_ids),
            "caption": caption or "",
            "access_token": IG_TOKEN,
        },
        timeout=180,
    )
    if r.status_code != 200:
        st.error(f"IG ERROR parent: {r.status_code} {r.text}")
        r.raise_for_status()
    return r.json()["id"]

def ig_publish(creation_id: str) -> dict:
    r = requests.post(
        f"{GRAPH}/{IG_USER_ID}/media_publish",
        data={"creation_id": creation_id, "access_token": IG_TOKEN},
        timeout=180,
    )
    if r.status_code != 200:
        st.error(f"IG ERROR publish: {r.status_code} {r.text}")
        r.raise_for_status()
    return r.json()

# ==== Utilidades de texto ====
PRICE_LINE_PATTERNS = (
    r"^\s*Precios.*$",
    r"^\s*Precio.*$",
    r"^\s*M[ií]n(:|imo)\s*:?\s*.*$",
    r"^\s*Mediana\s*:?\s*.*$",
    r"^\s*M[aá]x(:|imo)\s*:?\s*.*$",
)

def strip_price_lines(raw: str) -> Tuple[str, str]:
    """
    Quita líneas de precios del texto y las devuelve aparte.
    return: (texto_sin_precios, bloque_precios)
    """
    lines = raw.splitlines()
    kept, prices = [], []
    for ln in lines:
        if any(re.match(pat, ln, flags=re.IGNORECASE) for pat in PRICE_LINE_PATTERNS):
            prices.append(ln)
        else:
            kept.append(ln)
    return "\n".join(kept).strip(), "\n".join(prices).strip()

def build_caption_from_txt(txt_path: Path) -> Tuple[str, str]:
    """
    Usa el .txt tal cual como base del caption (tiene título, artista, sello, tracklist, año/país),
    pero SACA las líneas de precios por defecto.
    No agrega hashtags automáticos.
    """
    try:
        raw = txt_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return "", ""

    body_no_prices, price_block = strip_price_lines(raw)

    # Caption final sin hashtags extra
    caption = body_no_prices.strip()

    return caption, price_block

def add_release_to_sheet(info, price_str: str, owner: str = "Loic"):
    """
    Inserta una fila en el Google Sheet con datos del release publicado.
    """
    try:
        sh = sheets_client().open_by_key(SHEET_ID)
        ws = sh.sheet1  # primera hoja

        ep = info.title or ""
        artistas = ", ".join(info.artists or [])
        pais = info.country or ""
        anio = str(info.year or "")
        precio = price_str or ""
        vendido = "No"
        publicado = "Sí"
        propietario = owner  # "Pato", "Loic", "Cala"

        ws.append_row([ep, artistas, pais, anio, precio, vendido, publicado, propietario])
        return True
    except Exception as e:
        st.error(f"Error escribiendo en Sheets: {e}")
        return False

def find_ready_release_folders(root: Path) -> list[tuple[Path, list[Path], Path]]:
    """Devuelve lista de (carpeta_release, [videos .mp4], txt) para carpetas válidas."""
    out = []
    for sub in sorted(p for p in root.iterdir() if p.is_dir()):
        vids = sorted(sub.glob("*.mp4"))
        txts = list(sub.glob("*.txt"))
        if vids and txts:
            out.append((sub, vids, txts[0]))
    return out


def parse_release_header_from_txt(txt_path: Path) -> dict:
    """
    Lee el encabezado del .txt del release y devuelve dict:
    {title, artists, country, year}  (strings; year puede venir vacío)
    """
    data = {"title": "", "artists": "", "country": "", "year": ""}
    try:
        raw = txt_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return data

    # Patrones tolerantes a espacios y acentos
    m = re.search(r"^\s*Release\s*:\s*(.+)$", raw, flags=re.IGNORECASE | re.MULTILINE)
    if m: data["title"] = m.group(1).strip()

    m = re.search(r"^\s*Artista\(s\)\s*:\s*(.+)$", raw, flags=re.IGNORECASE | re.MULTILINE)
    if m: data["artists"] = m.group(1).strip()

    m = re.search(r"^\s*Año\s*:\s*(.+)$", raw, flags=re.IGNORECASE | re.MULTILINE)
    if m: data["year"] = m.group(1).strip()

    m = re.search(r"^\s*Pa[ií]s\s*:\s*(.+)$", raw, flags=re.IGNORECASE | re.MULTILINE)
    if m: data["country"] = m.group(1).strip()

    return data

def add_release_to_sheet_fields(ep: str, artistas: str, pais: str, anio: str, precio: str, owner: str = "Loic"):
    """
    Inserta una fila en el Google Sheet con datos del release publicado.
    """
    try:
        sh = sheets_client().open_by_key(SHEET_ID)
        ws = sh.sheet1  # primera hoja
        vendido = "No"
        publicado = "Sí"
        ws.append_row([ep, artistas, pais, anio, precio, vendido, publicado, owner])
        return True
    except Exception as e:
        st.error(f"Error escribiendo en Sheets: {e}")
        return False

# ==== UI ====
st.set_page_config(page_title="Postear a Instagram", page_icon="📱", layout="wide")
st.title("Instagram — publicar carruseles (Reels)")

if not env_ok():
    st.stop()

base_dir = st.text_input(
    "Carpeta raíz con releases listos (cada subcarpeta = 1 post)",
    value=str((Path.cwd() / "outputs").resolve())
)

if not base_dir.strip() or not Path(base_dir).exists():
    st.warning("Ajustá la ruta a la carpeta que contiene las subcarpetas con .mp4 + .txt.")
    st.stop()

releases = find_ready_release_folders(Path(base_dir))
st.write(f"Encontrados **{len(releases)}** releases listos para publicar.")

if not releases:
    st.stop()

# Previsualización + edición por carpeta (CAPTION EDITABLE CON DEFAULT)
for folder, vids, txt in releases:
    with st.expander(f"📦 {folder.name} — {len(vids)} videos", expanded=False):
        # 1) Construir caption por defecto desde .txt (sin precios)
        caption_default, price_block = build_caption_from_txt(txt)

        # 2) Inicializar el valor por defecto EN LA CLAVE DEL WIDGET
        key_cap = f"caption_{folder.name}"
        if key_cap not in st.session_state:
            st.session_state[key_cap] = caption_default

        # 3) Campo editable (muestra lo default y podés cambiarlo)
        st.markdown("**✏️ Caption a publicar (editable):**")
        st.text_area(
            label="",
            key=key_cap,
            height=240
        )

        # 👇 Selector de propietario
        key_owner = f"owner_{folder.name}"
        if key_owner not in st.session_state:
            st.session_state[key_owner] = "Loic"  # default
        st.selectbox(
            "👤 Propietario:",
            ["Loic", "Pato", "Cala"],
            key=key_owner
        )

        # 👇 Precio a publicar (guardado por carpeta/release)
        key_price = f"price_{folder.name}"
        if key_price not in st.session_state:
            st.session_state[key_price] = ""  # default vacío

        st.text_input(
            "💲 Precio a publicar (ej: 15 USD, $15.000 ARS, 20€…)",
            key=key_price,
            placeholder="Ej: 15 USD"
)

        # 4) Info de precios aparte (por si querés copiarla)
        with st.expander("ℹ️ Info de precios (no incluida por defecto)", expanded=False):
            if price_block:
                st.code(price_block, language="markdown")
            else:
                st.caption("Este .txt no contiene líneas de precios detectables.")

        # 5) Previews de videos (toggle por si no querés cargarlos)
        show_previews = st.checkbox("👀 Mostrar previews de video", value=True, key=f"show_prev_{folder.name}")

        if show_previews:
            ncols = 3 if len(vids) >= 3 else max(1, len(vids))
            cols = st.columns(ncols)
            for i, v in enumerate(vids):
                with cols[i % ncols]:
                    st.caption(v.name)
                    st.video(str(v))  # ruta local al mp4
        else:
            st.markdown("**Videos:**")
            for v in vids:
                st.write("•", v.name)

# Selección y publicación
choices = st.multiselect("Elegí qué releases publicar", [f.name for f, *_ in releases])

if st.button("🚀 Publicar seleccionados como carrusel"):
    if not choices:
        st.warning("Seleccioná al menos un release.")
        st.stop()

    log = []
    progress = st.progress(0.0, text="Publicando…")
    total = len(choices)
    done = 0

    for folder, vids, txt in releases:
        if folder.name not in choices:
            continue

        st.subheader(folder.name)

        # Tomar lo que esté escrito en el text_area; si no existe, usar default del .txt
        key_cap = f"caption_{folder.name}"
        default_cap, _ = build_caption_from_txt(txt)
        caption_to_use = st.session_state.get(key_cap, default_cap).strip() or default_cap

        # Agregar el precio al caption si se completó en el input
        key_price = f"price_{folder.name}"
        price_val = st.session_state.get(key_price, "").strip()
        if price_val:
            caption_to_use += f"\n\n💲 Precio: {price_val}"

        # 1) Subir videos a GCS y crear children
        children = []
        for i, v in enumerate(vids, start=1):
            progress.progress((done + (i/len(vids))*1) / max(1, total), text=f"{folder.name}: subiendo {i}/{len(vids)}")
            try:
                signed = upload_signed(v, f"{GCS_PREFIX}/{folder.name}", expires_seconds=7200)
                cid = ig_create_child_video_for_carousel(signed)
                status = ig_wait_finished(cid, timeout_sec=420)
                log.append(f"Child OK [{status}]: {v.name} → {cid}")
                children.append(cid)
            except Exception as e:
                log.append(f"Child ERROR {v.name}: {e}")
                st.error(f"Error con {v.name}: {e}")

        # 2) Crear carrusel y publicar
        if children:
            try:
                parent = ig_create_carousel_parent(children, caption_to_use)
                ig_wait_finished(parent, timeout_sec=420)  # Espera normal
                pub = ig_publish(parent)
                st.success(f"✅ Publicado correctamente: {pub}")

                # ✅ Agregar al Google Sheets
                owner_selected = st.session_state.get(f"owner_{folder.name}", "Loic")
                price_val = st.session_state.get(f"price_{folder.name}", "").strip() or "NA"
                meta = parse_release_header_from_txt(txt)
                add_release_to_sheet_fields(
                    ep=meta.get("title", ""),
                    artistas=meta.get("artists", ""),
                    pais=meta.get("country", ""),
                    anio=meta.get("year", ""),
                    precio=price_val,
                    owner=owner_selected
                )

            except Exception as e:
                st.error(f"⚠️ Error publicando en Instagram: {e}")

                # 💡 Nuevo bloque de recuperación: "falso negativo"
                if children:
                    st.warning("Posible falso negativo detectado — los videos subieron correctamente, intentando registrar igual en Sheets…")
                    try:
                        owner_selected = st.session_state.get(f"owner_{folder.name}", "Loic")
                        price_val = st.session_state.get(f"price_{folder.name}", "").strip() or "NA"
                        meta = parse_release_header_from_txt(txt)
                        add_release_to_sheet_fields(
                            ep=meta.get("title", ""),
                            artistas=meta.get("artists", ""),
                            pais=meta.get("country", ""),
                            anio=meta.get("year", ""),
                            precio=price_val,
                            owner=owner_selected
                        )
                        st.success("📗 Registro agregado a Google Sheets (fallback).")
                    except Exception as se:
                        st.error(f"❌ Falló también al registrar en Sheets: {se}")

        done += 1
        progress.progress(done / total, text=f"{done}/{total}")

    if log:
        st.text_area("Log", "\n".join(log), height=240)