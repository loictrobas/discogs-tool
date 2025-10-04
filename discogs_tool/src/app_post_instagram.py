import os, glob
from pathlib import Path
import streamlit as st

from publish_gcs_to_ig import (
    upload_to_gcs_signed,
    ig_create_reel_container,
    ig_wait_finished,
    ig_publish,
    gcs_client,
    IG_USER_ID,
    IG_TOKEN,
    GRAPH,
)

st.set_page_config(page_title="Instagram Publisher", layout="wide")

st.title("📲 Publicador de Posteos a Instagram")

# Seleccionar carpeta de outputs
base_dir = st.sidebar.text_input("Carpeta base de posteos", "/Users/loic_trobas/Desktop/Proyectos/discogs-tool/outputs")

base_path = Path(base_dir)
if not base_path.exists():
    st.warning("No se encontró la carpeta. Ajusta el path en el sidebar.")
    st.stop()

# Buscar subcarpetas
post_folders = [p for p in base_path.iterdir() if p.is_dir()]
if not post_folders:
    st.info("No hay subcarpetas con posteos en esta carpeta.")
    st.stop()

for folder in post_folders:
    st.subheader(f"📦 Posteo: {folder.name}")

    # Leer archivos
    videos = sorted(folder.glob("*.mp4"))
    txts = list(folder.glob("*.txt"))

    if not videos:
        st.write("⚠️ No se encontraron videos en esta carpeta.")
        continue

    caption = ""
    if txts:
        caption = txts[0].read_text()
        with st.expander("📄 Texto del release"):
            st.text(caption)

    # Previews
    cols = st.columns(len(videos))
    for i, v in enumerate(videos):
        with cols[i]:
            st.video(str(v))

    # Publicar botón
    if st.button(f"🚀 Publicar {folder.name}", key=f"btn_{folder.name}"):
        st.write("⏫ Subiendo a GCS y creando carrusel en IG…")
        client = gcs_client()

        # Subir cada video como "hijo"
        children_ids = []
        for v in videos:
            signed_url = upload_to_gcs_signed(v, folder.name, expires_seconds=7200)
            # container hijo (carousel item)
            import requests
            resp = requests.post(
                f"{GRAPH}/{IG_USER_ID}/media",
                data={
                    "media_type": "VIDEO",
                    "video_url": signed_url,
                    "is_carousel_item": "true",
                    "access_token": IG_TOKEN,
                },
                timeout=180,
            )
            resp.raise_for_status()
            child_id = resp.json()["id"]
            children_ids.append(child_id)

        # Crear el padre CAROUSEL
        import requests
        resp = requests.post(
            f"{GRAPH}/{IG_USER_ID}/media",
            data={
                "media_type": "CAROUSEL",
                "children": ",".join(children_ids),
                "caption": caption,
                "access_token": IG_TOKEN,
            },
            timeout=180,
        )
        resp.raise_for_status()
        parent_id = resp.json()["id"]

        # Publicar
        resp2 = requests.post(
            f"{GRAPH}/{IG_USER_ID}/media_publish",
            data={"creation_id": parent_id, "access_token": IG_TOKEN},
            timeout=120,
        )
        resp2.raise_for_status()
        st.success(f"✅ Publicado en IG: {resp2.json()}")