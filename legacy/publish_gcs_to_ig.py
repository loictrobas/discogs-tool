import os, time, mimetypes, datetime
from pathlib import Path
import requests
from google.cloud import storage
from google.oauth2 import service_account
from dotenv import load_dotenv

load_dotenv()

# --- Config ---
# TIP: podés pasar el archivo como argumento: python publish_gcs_to_ig.py /ruta/video.mp4
import sys
if len(sys.argv) >= 2:
    LOCAL_FILE = Path(sys.argv[1])
else:
    # fallback para test rápido
    LOCAL_FILE = Path("/Users/loic_trobas/Downloads/si.mp4")

GCS_JSON = (os.getenv("GCS_CREDENTIALS_JSON") or "").strip()
GCS_BUCKET = (os.getenv("GCS_BUCKET") or "").strip()
GCS_PREFIX = (os.getenv("GCS_PREFIX", "discogs-posts") or "").strip().strip("/")

IG_USER_ID = (os.getenv("IG_USER_ID") or "").strip()
IG_TOKEN = (os.getenv("IG_ACCESS_TOKEN") or "").strip()
GRAPH = "https://graph.facebook.com/v20.0"

assert LOCAL_FILE.exists(), f"No existe archivo local: {LOCAL_FILE}"
assert GCS_JSON and Path(GCS_JSON).exists(), "Falta GCS_CREDENTIALS_JSON o no existe el JSON"
assert GCS_BUCKET, "Falta GCS_BUCKET"
assert IG_USER_ID and IG_TOKEN, "Faltan IG_USER_ID o IG_ACCESS_TOKEN en .env"

def gcs_client():
    creds = service_account.Credentials.from_service_account_file(GCS_JSON)
    return storage.Client(credentials=creds)

def upload_to_gcs_signed(local_path: Path, key_prefix: str, expires_seconds: int = 7200) -> str:
    """
    Sube el archivo a GCS y devuelve una Signed URL (V4) de lectura GET.
    Funciona con UBLA activado (no usa ACLs).
    """
    client = gcs_client()
    bucket = client.bucket(GCS_BUCKET)

    dest_name = f"{key_prefix}/{local_path.name}" if key_prefix else local_path.name
    blob = bucket.blob(dest_name)

    ctype, _ = mimetypes.guess_type(local_path.name)  # <-- FIX del typo
    blob.upload_from_filename(str(local_path), content_type=ctype or "video/mp4")

    url = blob.generate_signed_url(
        version="v4",
        expiration=datetime.timedelta(seconds=expires_seconds),
        method="GET",
        response_disposition=f'inline; filename="{local_path.name}"',
    )
    return url

def ig_create_reel_container(video_url: str, caption: str = "", thumb_offset_sec: int = 1) -> str:
    """
    Crea un media container tipo REELS (reemplaza al antiguo VIDEO).
    """
    payload = {
        "media_type": "REELS",        # <-- clave
        "video_url": video_url,
        "caption": caption,
        "thumb_offset": thumb_offset_sec,  # segundo para frame de portada (opcional)
        "access_token": IG_TOKEN,
    }
    resp = requests.post(f"{GRAPH}/{IG_USER_ID}/media", data=payload, timeout=180)
    if resp.status_code != 200:
        print("IG ERROR create container:", resp.status_code, resp.text)
        resp.raise_for_status()
    return resp.json()["id"]

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

def ig_publish(creation_id: str) -> dict:
    r = requests.post(
        f"{GRAPH}/{IG_USER_ID}/media_publish",
        data={"creation_id": creation_id, "access_token": IG_TOKEN},
        timeout=180,
    )
    if r.status_code != 200:
        print("IG ERROR publish:", r.status_code, r.text)
        r.raise_for_status()
    return r.json()

def main():
    release_key = GCS_PREFIX  # podés cambiarlo por nombre de release si querés
    print("⏫ Subiendo a GCS…")
    signed_url = upload_to_gcs_signed(LOCAL_FILE, release_key, expires_seconds=7200)  # 2 horas
    print("✔️  GCS URL:", signed_url)

    print("🎥 Creando container REELS en IG…")
    # Caption simple con nombre de archivo (sin extensión) para test
    caption = LOCAL_FILE.stem
    creation_id = ig_create_reel_container(signed_url, caption=caption, thumb_offset_sec=1)
    print("creation_id:", creation_id)

    print("⏳ Esperando procesamiento…")
    status = ig_wait_finished(creation_id)
    print("✔️  IG status final:", status)

    print("🚀 Publicando…")
    pub = ig_publish(creation_id)
    print("✅ Publicado:", pub)

if __name__ == "__main__":
    main()