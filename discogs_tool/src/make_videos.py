import subprocess
from pathlib import Path
import requests
import moviepy.editor as mp
from pydub import AudioSegment
from pydub.utils import which

from discogs_tool.src.discogs_meta import fetch_release_info
from discogs_tool.src.make_txt import sanitize_filename, make_release_txt

from dotenv import load_dotenv
import os

# --- Config ---
load_dotenv()
APP_USER_AGENT = os.getenv("APP_USER_AGENT", "DiscogsTool/1.0")

ffmpeg_path = which("ffmpeg")
if ffmpeg_path:
    AudioSegment.converter = ffmpeg_path

# ----------------------------- Utilidades ----------------------------- #
def download_image(url: str, out_path: Path, uri150: str | None = None) -> Path | None:
    headers = {
        "User-Agent": APP_USER_AGENT,
        "Referer": "https://www.discogs.com/",
        "Accept": "image/*,*/*;q=0.8",
    }
    try:
        r = requests.get(url, headers=headers, timeout=30)
        r.raise_for_status()
        out_path.write_bytes(r.content)
        return out_path
    except Exception as e:
        print(f"⚠️  Error descargando imagen full ({e}).")
        if uri150:
            try:
                r2 = requests.get(uri150, headers=headers, timeout=30)
                r2.raise_for_status()
                out_path.write_bytes(r2.content)
                return out_path
            except Exception as e2:
                print(f"⛔  También falló thumbnail: {e2}")
        return None

def yt_search_and_download_mp3(query: str, dst_no_ext: Path, start_sec=90, duration_sec=30) -> Path | None:
    """
    Descarga audio desde YouTube, recorta desde start_sec hasta start_sec+duration_sec.
    """
    out_template = str(dst_no_ext.with_suffix(".%(ext)s"))
    cmd = [
        "yt-dlp",
        f"ytsearch1:{query}",
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

    try:
        audio = AudioSegment.from_file(mp3_path)
        start_ms = start_sec * 1000
        end_ms = start_ms + (duration_sec * 1000)
        if len(audio) > start_ms:
            clip = audio[start_ms:end_ms]
            clip.export(mp3_path, format="mp3")
        else:
            print("⚠️  El audio es demasiado corto, exportando desde inicio…")
            audio[:duration_sec*1000].export(mp3_path, format="mp3")
        return mp3_path
    except Exception as e:
        print(f"⚠️  Error recortando audio: {e}")
        return None

def make_video(image_path: Path, audio_path: Path, out_mp4: Path, duration_sec=30):
    img_clip = mp.ImageClip(str(image_path)).set_duration(duration_sec)
    aud_clip = mp.AudioFileClip(str(audio_path)).subclip(0, duration_sec)
    video = img_clip.set_audio(aud_clip)
    video.write_videofile(str(out_mp4), fps=24, codec="libx264", audio_codec="aac", verbose=False, logger=None)
    img_clip.close()
    aud_clip.close()

# ------------------------------ Pipeline ------------------------------ #
def process_release(url: str, start_sec=90, duration_sec=30):
    info = fetch_release_info(url)

    # Carpeta del release
    release_folder = Path("outputs") / sanitize_filename(info.title)
    release_folder.mkdir(parents=True, exist_ok=True)

    # TXT del release
    make_release_txt(url, out_dir=release_folder)

    # Imagen
    cover_path = None
    if info.images:
        full_uri, thumb_uri = None, None
        if isinstance(info.images[0], (list, tuple)):
            full_uri, thumb_uri = info.images[0]
        else:
            full_uri = info.images[0]
        cover_path = release_folder / "cover.jpg"
        if not cover_path.exists():
            print("🖼️  Descargando imagen de portada…")
            cover_path = download_image(full_uri, cover_path, uri150=thumb_uri)
    else:
        print("⚠️  Release sin imágenes.")

    if not cover_path or not cover_path.exists():
        print("⛔  No hay imagen de portada. Abortando videos.")
        return

    price = info.community_avg_price if info.community_avg_price else "NA"
    currency = info.marketplace_currency or ""
    print(f"📀 {info.title} | {len(info.tracks)} tracks | 💵 {price} {currency}".strip())

    for t in info.tracks:
        if not t.title:
            continue
        query = f"{info.title} {t.title}"
        print(f"\n🔎 {query}")
        base_name = sanitize_filename(f"{t.position + ' ' if t.position else ''}{t.title}")
        audio_dst = release_folder / base_name
        mp3_path = yt_search_and_download_mp3(query, audio_dst, start_sec=start_sec, duration_sec=duration_sec)
        if not mp3_path:
            print(f"⛔  No se pudo bajar audio para {t.title}")
            continue
        price_str = f"{price}{(' ' + currency) if currency else ''}" if price != "NA" else "NA"
        out_video = release_folder / f"{base_name} - {price_str}.mp4"
        try:
            make_video(cover_path, mp3_path, out_video, duration_sec=duration_sec)
            print(f"✅ Video generado: {out_video}")
        except Exception as e:
            print(f"⚠️  Error en video {t.title}: {e}")
        # borrar mp3 temporal
        try:
            mp3_path.unlink()
        except Exception:
            pass

# ------------------------------ CLI ----------------------------------- #
if __name__ == "__main__":
    url = input("Pegá URL Discogs (release o master): ").strip()
    process_release(url)