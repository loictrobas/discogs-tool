# Discoschetos

Web app para publicar vinilos en Instagram ([@discoschetos](https://instagram.com/discoschetos)) y llevar el inventario compartido.

**Flujo:** pegás un link de Discogs → trae portada, tracks y busca el audio de cada tema → arma un video de 30 s por track → cargás precio y de quién es → publica el carrusel en Instagram.

## Stack

- **Next.js 16** en Vercel (UI, server actions, render de videos con `next/og` + `ffmpeg-static`)
- **Supabase**: Postgres (inventario), Auth (usuario + contraseña), Storage (portadas, audios, videos públicos para Instagram)
- **Instagram Graph API** para publicar
- **Audio worker** (`scripts/audio-worker.ts`): baja audio de YouTube con `yt-dlp`. Corre en una compu de casa porque YouTube bloquea las IPs de servidores.

## Setup local

```bash
pnpm install
cp .env.example .env.local   # completar
supabase link --project-ref <ref> && supabase db push
pnpm create-user loic "Loïc" <contraseña> --admin
pnpm dev
```

En otra terminal, para los audios de YouTube (necesita `brew install yt-dlp deno`):

```bash
pnpm worker
```

## Variables de entorno

| Variable | Qué es |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key de Supabase |
| `SUPABASE_SECRET_KEY` | Secret key de Supabase (solo servidor y worker) |
| `DISCOGS_USER_TOKEN` | Token personal de Discogs |
| `DISCOGS_USER_AGENT` | User-Agent para la API de Discogs |
| `IG_USER_ID` | ID de la cuenta de Instagram Business |
| `IG_ACCESS_TOKEN` | Token de página con `instagram_content_publish` |

## Estructura

- `src/app/` — páginas: inventario (`/`), nuevo disco, editor (`/discos/[id]`), usuarios
- `src/lib/` — Discogs, búsqueda de audio, render (frame + ffmpeg), Instagram, publicación
- `supabase/migrations/` — esquema de la base
- `scripts/` — worker de audio y alta de usuarios
- `legacy/` — la versión anterior en Streamlit/Python
