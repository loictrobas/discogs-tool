# Discogs Tool

Pipeline:
1) **app_discogs_to_videos**: toma un link de Discogs y genera:
   - videos .mp4 por track (30s desde 1:30, con portada)
   - archivo .txt con metadatos (título, año, país, tracks, precios)
2) **app_post_instagram**: selecciona carpetas de releases y publica a Instagram (reels/carouseles) vía IG Graph API + GCS.

## Estructura

- `discogs_tool/src/`:
  - `discogs_meta.py`, `make_txt.py`, `make_videos.py`
  - `app_post_instagram.py`, `get_user_id_ig.py`, `publish_gcs_to_ig.py`
- `discogs_tool/outputs/` y `outputs/`: resultados
- `.env`: tokens y rutas (no se sube)

## Requisitos

- Python 3.11
- `environment.yml` (Conda)
- `ffmpeg`, `yt-dlp`

## Uso
```bash
conda env create -f environment.yml
conda activate discogs-tool

# App 1: generar videos
streamlit run streamlit_app.py   # (si tu app UI de generación es esta)

# App 2: post a Instagram
python -m discogs_tool.src.app_post_instagram
