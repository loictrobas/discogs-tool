import json
import os
import subprocess
from pathlib import Path
from typing import List, Dict, Optional

import streamlit as st
import requests
from pydub import AudioSegment
from pydub.utils import which

# Importá tus módulos existentes
from discogs_tool.src.discogs_meta import fetch_release_info
from discogs_tool.src.make_txt import sanitize_filename, make_release_txt

# ---------- Configuración base ----------
APP_USER_AGENT = os.getenv("APP_USER_AGENT", "DiscogsTool/1.0")
FFMPEG_PATH = which("ffmpeg")
if FFMPEG_PATH:
    AudioSegment.converter = FFMPEG_PATH

DEFAULT_DURATION = 30
DEFAULT_START = 90  # 1:30

# Persistencia simple (cross-session) en archivo local:
CONFIG_FILE = Path.home() / ".discogs_tool_config.json"


def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except Exception:
            return {}
    return {}


def save_config(cfg: dict):
    try:
        CONFIG_FILE.write_text(json.dumps(cfg, indent=2))
    except Exception:
        pass


# ---------- Utilidades ----------
def ensure_headers():
    return {
        "User-Agent": APP_USER_AGENT,
        "Referer": "https://www.discogs.com/",
        "Accept": "image/*,*/*;q=0.8",
    }


def download_image(url: str, out_path: Path, uri150: Optional[str] = None) -> Optional[Path]:
    headers = ensure_headers()
    try:
        r = requests.get(url, headers=headers, timeout=30)
        r.raise_for_status()
        out_path.write_bytes(r.content)
        return out_path
    except Exception:
        if uri150:
            try:
                r2 = requests.get(uri150, headers=headers, timeout=30)
                r2.raise_for_status()
                out_path.write_bytes(r2.content)
                return out_path
            except Exception:
                return None
        return None


def yt_search(query: str, n: int = 5) -> List[Dict]:
    """
    Usa yt-dlp para devolver top-N resultados de búsqueda sin descargar.
    Retorna una lista de dicts: {title, url, thumbnail, duration, channel}
    """
    cmd = [
        "yt-dlp",
        "-J",
        f"ytsearch{n}:{query}",
        "--no-warnings",
        "--no-playlist",
        "--skip-download",
    ]
    try:
        proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
        data = json.loads(proc.stdout)
        entries = data.get("entries") or []
        results = []
        for e in entries:
            # Campos robustos con defaults
            url = e.get("webpage_url") or e.get("url")
            title = e.get("title") or "(sin título)"
            duration = e.get("duration")  # en segundos
            channel = e.get("channel") or e.get("uploader") or ""
            thumb = None
            thumbs = e.get("thumbnails") or []
            if thumbs:
                # tomar la de mayor resolución disponible
                thumbs_sorted = sorted(thumbs, key=lambda t: t.get("height", 0), reverse=True)
                thumb = thumbs_sorted[0].get("url")
            results.append({
                "title": title,
                "url": url,
                "thumbnail": thumb,
                "duration": duration,
                "channel": channel,
            })
        return results
    except subprocess.CalledProcessError as e:
        st.error(f"Error buscando en YouTube: {e}")
        return []
    except Exception as e:
        st.error(f"Error parseando resultados de YouTube: {e}")
        return []


def yt_download_audio_by_url(video_url: str, dst_no_ext: Path, start_sec=DEFAULT_START, duration_sec=DEFAULT_DURATION) -> Optional[Path]:
    """
    Descarga audio (mp3) de una URL de YouTube específica y recorta desde start_sec.
    """
    out_template = str(dst_no_ext.with_suffix(".%(ext)s"))
    cmd = [
        "yt-dlp",
        video_url,
        "-x", "--audio-format", "mp3",
        "-o", out_template,
        "--no-playlist",
        "--no-warnings",
        "--quiet",
    ]
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError:
        return None

    mp3_path = dst_no_ext.with_suffix(".mp3")
    if not mp3_path.exists():
        candidates = list(dst_no_ext.parent.glob(dst_no_ext.name + ".*"))
        if candidates:
            mp3_path = candidates[0]
        else:
            return None

    # Recorte
    try:
        audio = AudioSegment.from_file(mp3_path)
        start_ms = start_sec * 1000
        end_ms = start_ms + (duration_sec * 1000)
        if len(audio) > start_ms:
            clip = audio[start_ms:end_ms]
            clip.export(mp3_path, format="mp3")
        else:
            audio[:duration_sec*1000].export(mp3_path, format="mp3")
        return mp3_path
    except Exception:
        return None


def make_video(image_path: Path, audio_path: Path, out_mp4: Path, duration_sec=DEFAULT_DURATION):
    # moviepy import dentro de la función para evitar conflictos de cargado
    import moviepy.editor as mp
    img_clip = mp.ImageClip(str(image_path)).set_duration(duration_sec)
    aud_clip = mp.AudioFileClip(str(audio_path)).subclip(0, duration_sec)
    video = img_clip.set_audio(aud_clip)
    video.write_videofile(str(out_mp4), fps=24, codec="libx264", audio_codec="aac", verbose=False, logger=None)
    img_clip.close()
    aud_clip.close()


# ---------- Estado de la app ----------
if "output_dir" not in st.session_state:
    # intentar cargar de config
    cfg = load_config()
    st.session_state.output_dir = cfg.get("output_dir", "")

if "release_info" not in st.session_state:
    st.session_state.release_info = None

if "search_results" not in st.session_state:
    # dict por track_id (índice) -> lista de resultados
    st.session_state.search_results = {}

if "chosen_results" not in st.session_state:
    # dict por track_id -> ("manual", url) | ("auto", result_dict)
    st.session_state.chosen_results = {}

if "cover_path" not in st.session_state:
    st.session_state.cover_path = None


st.set_page_config(page_title="Discogs → Videos", page_icon="🎞️", layout="wide")
st.title("Discogs → Videos (generación)")

# ---------- Paso 0: Elegir carpeta de salida ----------
st.subheader("1) Elegí la carpeta de salida (persistente)")
output_dir = st.text_input("Ruta de carpeta de salida (se usará para TODOS los releases):", st.session_state.output_dir)

col_s1, col_s2 = st.columns([1,1])
with col_s1:
    if st.button("Guardar carpeta de salida"):
        if not output_dir:
            st.error("Ingresá una ruta válida.")
        else:
            Path(output_dir).mkdir(parents=True, exist_ok=True)
            st.session_state.output_dir = output_dir
            cfg = load_config()
            cfg["output_dir"] = output_dir
            save_config(cfg)
            st.success(f"Carpeta set: {output_dir}")

with col_s2:
    if st.button("Usar carpeta 'outputs' por defecto"):
        default = Path.cwd() / "outputs"
        default.mkdir(parents=True, exist_ok=True)
        st.session_state.output_dir = str(default)
        cfg = load_config()
        cfg["output_dir"] = st.session_state.output_dir
        save_config(cfg)
        st.success(f"Carpeta set: {st.session_state.output_dir}")

st.divider()

# ---------- Paso 1: URL de Discogs ----------
st.subheader("2) Pegar URL de Discogs del release/master y previsualizar tracks")
discogs_url = st.text_input("URL de Discogs", placeholder="https://www.discogs.com/release/...")
go_fetch = st.button("Cargar release")

if go_fetch:
    if not st.session_state.output_dir:
        st.error("Primero definí la carpeta de salida.")
    elif not discogs_url.strip():
        st.error("Pegá una URL de Discogs.")
    else:
        try:
            info = fetch_release_info(discogs_url.strip())
            st.session_state.release_info = info

            # Carpeta por release dentro del output_dir elegido
            release_folder = Path(st.session_state.output_dir) / sanitize_filename(info.title)
            release_folder.mkdir(parents=True, exist_ok=True)

            # TXT (con precios) dentro de la carpeta de release
            make_release_txt(discogs_url.strip(), out_dir=str(release_folder))

            # Portada
            cover_path = release_folder / "cover.jpg"
            if info.images:
                # info.images[0] puede ser (uri, uri150) o string
                full_uri, thumb_uri = None, None
                first_img = info.images[0]
                if isinstance(first_img, (list, tuple)):
                    full_uri, thumb_uri = first_img
                else:
                    full_uri = first_img
                if not cover_path.exists():
                    download_image(full_uri, cover_path, uri150=thumb_uri)
            st.session_state.cover_path = str(cover_path) if cover_path.exists() else None

            # Borrar previos
            st.session_state.search_results = {}
            st.session_state.chosen_results = {}

            st.success(f"Release cargado: {info.title} — {len(info.tracks)} tracks.")
        except Exception as e:
            st.error(f"Error: {e}")

# ---------- Paso 2: Preview y selección por track ----------
if st.session_state.release_info:
    info = st.session_state.release_info

    # ---------- Resumen del release & Tracklist ----------
    st.subheader("Resumen del release")

    col1, col2 = st.columns([1, 2])
    with col1:
        # portada si la tenemos
        if st.session_state.cover_path and Path(st.session_state.cover_path).exists():
            st.image(st.session_state.cover_path, use_container_width=True)
        else:
            st.caption("Sin portada descargada.")

    with col2:
        st.markdown(f"### {info.title}")
        artists = ", ".join(info.artists) if getattr(info, 'artists', None) else "—"
        labels = ", ".join(getattr(info, "labels", []) or []) or "—"
        year = info.year or "—"
        country = info.country or "—"
        cur = info.marketplace_currency or ""
        price_min = f"{info.price_min} {cur}".strip() if info.price_min is not None else "—"
        price_median = f"{info.price_median} {cur}".strip() if info.price_median is not None else "—"
        price_max = f"{info.price_max} {cur}".strip() if info.price_max is not None else "—"

        st.write(f"**Artista(s):** {artists}")
        st.write(f"**Sello(s):** {labels}")
        st.write(f"**Año / País:** {year} · {country}")
        st.write("**Precios marketplace:**")
        st.write(f"- **Mínimo:** {price_min}")
        st.write(f"- **Mediana:** {price_median}")
        st.write(f"- **Máximo:** {price_max}")

    # Tracklist en tabla compacta
    st.markdown("#### Tracklist")
    rows = []
    for t in info.tracks:
        track_artists = ", ".join(t.artists) if getattr(t, "artists", None) else (info.artists[0] if info.artists else "")
        rows.append({
            "Pos": t.position or "",
            "Artista": track_artists,
            "Track": t.title or "",
            "Duración": t.duration or "",
        })
    st.table(rows)

    st.divider()
    st.subheader("3) Previsualizar y elegir resultados de YouTube por track")

    for idx, t in enumerate(info.tracks):
        if not t.title:
            continue

        with st.expander(f"{t.position + ' - ' if t.position else ''}{t.title}", expanded=False):
            if idx not in st.session_state.search_results:
                # ---------- NUEVA QUERY: label + track artist + track title ----------
                label = info.labels[0] if getattr(info, "labels", None) else ""

                if getattr(t, "artists", None):
                    track_artist = ", ".join(t.artists or [])
                else:
                    track_artist = info.artists[0] if info.artists else ""

                track_title = t.title or ""

                parts = [label, track_artist, track_title]
                query = " ".join([p for p in parts if p]).strip()

                st.caption(f"🔎 Búsqueda (principal): `{query}` (top 5)")
                results = yt_search(query, n=3)

                if not results:
                    fallback_query = f"{info.title} {track_title}"
                    st.caption(f"↩️  Sin resultados; fallback: `{fallback_query}`")
                    results = yt_search(fallback_query, n=3)

                st.session_state.search_results[idx] = results

            results = st.session_state.search_results.get(idx, [])
            if not results:
                st.warning("Sin resultados automáticos.")
                # 👉 input manual cuando NO hay resultados (key única)
                manual_url = st.text_input(
                    f"🔗 Pegá un link manual de YouTube para {t.title}",
                    key=f"manual_url_no_results_{idx}"
                )
                if manual_url:
                    st.session_state.chosen_results[idx] = ("manual", manual_url)
                continue

            # Mostrar los resultados con thumbnail + título + canal + duración
            options_labels = []
            for j, r in enumerate(results):
                if r['duration'] is not None:
                    m, s = divmod(int(r['duration']), 60)
                    dur_txt = f"{m}:{s:02d}"
                else:
                    dur_txt = "?"
                label = f"{r['title']}  •  {r['channel']}  •  {dur_txt}"
                options_labels.append(label)

            # Radio de selección (default 0; no usamos chosen_results como índice)
            choice = st.radio(
                "Elegí el video correcto:",
                list(range(len(results))),
                format_func=lambda i: options_labels[i],
                index=0,
                key=f"choice_{idx}",
            )

            # Guardar la selección como "auto"
            st.session_state.chosen_results[idx] = ("auto", results[choice])

            colA, colB = st.columns([1,1])
            with colA:
                if results[choice].get("thumbnail"):
                    st.image(results[choice]["thumbnail"], use_container_width=True, caption="Thumbnail")
            with colB:
                st.write(f"**Título:** {results[choice]['title']}")
                st.write(f"**Canal:** {results[choice]['channel']}")
                if results[choice]['duration'] is not None:
                    m, s = divmod(int(results[choice]['duration']), 60)
                    dur_txt = f"{m}:{s:02d}"
                else:
                    dur_txt = "?"
                st.write(f"**Duración:** {dur_txt}")
                st.write(f"**URL:** {results[choice]['url']}")

            # 👉 input manual cuando SÍ hay resultados (key distinta)
            manual_url = st.text_input(
                f"🔗 O pegá un link manual de YouTube para {t.title}",
                key=f"manual_url_with_results_{idx}"
            )
            if manual_url:
                st.session_state.chosen_results[idx] = ("manual", manual_url)

    st.divider()

    # ---------- Paso 3: Generar videos ----------
    st.subheader("4) Generar videos (30s desde 1:30)")

    if st.button("Generar todos los videos aprobados"):
        release_folder = Path(st.session_state.output_dir) / sanitize_filename(info.title)
        cover_path = Path(st.session_state.cover_path) if st.session_state.cover_path else None

        if not cover_path or not cover_path.exists():
            st.error("No hay portada válida. Abortando.")
        else:
            price = info.community_avg_price if info.community_avg_price else "NA"
            currency = info.marketplace_currency or ""
            progress = st.progress(0, text="Generando...")

            total_tracks = len(info.tracks)
            done = 0
            logs = []

            for idx, t in enumerate(info.tracks):
                if not t.title:
                    done += 1
                    progress.progress(done / total_tracks, text=f"{done}/{total_tracks}")
                    continue

                # Leer selección (manual o auto)
                selection = st.session_state.chosen_results.get(idx, None)
                if not selection:
                    logs.append(f"SKIP (sin selección): {t.title}")
                    done += 1
                    progress.progress(done / total_tracks, text=f"{done}/{total_tracks}")
                    continue

                if selection[0] == "manual":
                    url = selection[1]  # link manual
                else:
                    chosen = selection[1]
                    url = chosen["url"]

                base_name = sanitize_filename(f"{t.position + ' ' if t.position else ''}{t.title}")
                audio_dst = release_folder / base_name

                # Descargar audio recortado
                mp3_path = yt_download_audio_by_url(url, audio_dst, start_sec=DEFAULT_START, duration_sec=DEFAULT_DURATION)
                if not mp3_path:
                    logs.append(f"ERROR audio: {t.title}")
                    done += 1
                    progress.progress(done / total_tracks, text=f"{done}/{total_tracks}")
                    continue

                # Componer video
                price_str = f"{price}{(' ' + currency) if currency else ''}" if price != "NA" else "NA"
                out_video = release_folder / f"{base_name} - {price_str}.mp4"
                try:
                    make_video(cover_path, mp3_path, out_video, duration_sec=DEFAULT_DURATION)
                    # borrar mp3 temporal
                    try:
                        mp3_path.unlink()
                    except Exception:
                        pass
                    logs.append(f"OK: {out_video.name}")
                except Exception as e:
                    logs.append(f"ERROR video {t.title}: {e}")

                done += 1
                progress.progress(done / total_tracks, text=f"{done}/{total_tracks}")

            st.success("✅ Listo. Mirá la carpeta de salida.")
            if logs:
                st.text_area("Log de proceso", "\n".join(logs), height=200)