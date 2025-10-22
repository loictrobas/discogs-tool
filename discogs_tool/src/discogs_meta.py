# discogs_tool/src/discogs_meta.py
import os
import re as _re
from dataclasses import dataclass
from typing import List, Optional, Tuple
from urllib.parse import urlparse

import requests
import discogs_client
from dotenv import load_dotenv

load_dotenv()

# === ENV ===
DISCOGS_USER_TOKEN = os.getenv("DISCOGS_USER_TOKEN", "").strip()
DISCOGS_USER_AGENT = os.getenv("DISCOGS_USER_AGENT", "DiscogsTool/1.0").strip()
DISCOGS_CURRENCY   = "USD"
#(os.getenv("DISCOGS_CURRENCY") or "ARS").strip().upper()  # default ARS

if not DISCOGS_USER_TOKEN:
    raise RuntimeError("Falta DISCOGS_USER_TOKEN en .env")

# Cliente oficial para metadata
client = discogs_client.Client(DISCOGS_USER_AGENT, user_token=DISCOGS_USER_TOKEN)

# === Dataclasses ===
@dataclass
class TrackInfo:
    position: str
    title: str
    duration: Optional[str] = None
    artists: Optional[List[str]] = None  # artistas del track (si existen)

@dataclass
class ReleaseInfo:
    title: str
    artists: List[str]                # artistas del release (a veces “Various”)
    year: Optional[int]
    country: Optional[str]
    labels: List[str]                 # sellos (label names)
    tracks: List[TrackInfo]
    images: List[tuple]               # [(uri, uri150), ...]
    community_avg_price: Optional[float]
    marketplace_currency: Optional[str]
    price_min: Optional[float] = None
    price_median: Optional[float] = None
    price_max: Optional[float] = None

# === Helpers ===
def _extract_release_or_master_id(url: str):
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]

    # descartar prefijos de idioma (fr, es, de, etc.)
    if len(parts) >= 2 and len(parts[0]) == 2:
        parts = parts[1:]

    if len(parts) >= 2 and parts[0] in ("release", "master"):
        kind = parts[0]
        match = _re.match(r"(\d+)", parts[1])  # <-- usar _re
        if match:
            return kind, int(match.group(1))
    raise ValueError("URL de Discogs no reconocida. Debe apuntar a /release/... o /master/...")

def _images_to_urls(images):
    out = []
    try:
        for img in images or []:
            uri = None
            uri150 = None
            if hasattr(img, "uri") and img.uri:
                uri = img.uri
            elif isinstance(img, dict) and img.get("uri"):
                uri = img["uri"]
            if hasattr(img, "uri150") and img.uri150:
                uri150 = img.uri150
            elif isinstance(img, dict) and img.get("uri150"):
                uri150 = img["uri150"]
            if uri:
                out.append((uri, uri150))
    except Exception:
        pass
    return out

def _discogs_headers():
    h = {
        "User-Agent": DISCOGS_USER_AGENT,
        "Accept": "application/vnd.discogs.v2+json"
    }
    if DISCOGS_USER_TOKEN:
        h["Authorization"] = f"Discogs token={DISCOGS_USER_TOKEN}"
    return h

def _to_float(x):
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    if isinstance(x, str):
        try:
            return float(x.replace(",", "."))
        except Exception:
            return None
    if isinstance(x, dict):
        # típicamente {'currency': 'ARS', 'value': 123.45}
        for k in ("value", "amount", "price"):
            if k in x:
                return _to_float(x[k])
    return None

def _median(nums: List[float]) -> Optional[float]:
    nums = sorted(n for n in nums if n is not None)
    if not nums:
        return None
    n = len(nums)
    mid = n // 2
    if n % 2 == 1:
        return nums[mid]
    return (nums[mid - 1] + nums[mid]) / 2.0

def fetch_market_stats(release_id: int, currency: str) -> Tuple[Optional[float], Optional[float], Optional[float], str]:
    """
    Intenta traer low/median/high desde el endpoint de stats.
    (No siempre expone mediana y máximo; varios objetos traen solo 'lowest_price').
    """
    curr = (currency or DISCOGS_CURRENCY or "ARS").upper()
    url = f"https://api.discogs.com/marketplace/stats/{release_id}?curr_abbr={curr}"
    try:
        r = requests.get(url, headers=_discogs_headers(), timeout=30)
        r.raise_for_status()
        data = r.json() or {}
    except Exception:
        return (None, None, None, curr)

    p_min = _to_float(data.get("lowest_price"))
    # tolerante a variaciones: usamos varias alternativas si existieran
    p_med = (
        _to_float(data.get("median_price")) or
        _to_float(data.get("median")) or
        _to_float(data.get("summary", {}).get("median")) or
        _to_float(data.get("sales", {}).get("median"))
    )
    p_max = (
        _to_float(data.get("highest_price")) or
        _to_float(data.get("highest")) or
        _to_float(data.get("summary", {}).get("highest")) or
        _to_float(data.get("sales", {}).get("highest"))
    )
    return (p_min, p_med, p_max, curr)

def fetch_price_suggestions_approx(release_id: int, currency: str) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """
    Fallback: calcula min/mediana/max aproximados a partir de price_suggestions
    (por condición). No es idéntico al historial de ventas de Discogs,
    pero sirve cuando el endpoint de stats no trae median/high.
    """
    curr = (currency or DISCOGS_CURRENCY or "ARS").upper()
    url = f"https://api.discogs.com/marketplace/price_suggestions/{release_id}?curr_abbr={curr}"
    try:
        r = requests.get(url, headers=_discogs_headers(), timeout=30)
        r.raise_for_status()
        data = r.json() or {}
    except Exception:
        return (None, None, None)

    values = []
    for cond, obj in (data.items() if isinstance(data, dict) else []):
        values.append(_to_float(obj.get("value")))

    values = [v for v in values if v is not None]
    if not values:
        return (None, None, None)

    pmin = min(values)
    pmax = max(values)
    pmed = _median(values)
    return (pmin, pmed, pmax)

# === MAIN ===
def fetch_release_info(url: str) -> ReleaseInfo:
    kind, _id = _extract_release_or_master_id(url)

    if kind == "master":
        master = client.master(_id)
        release = master.main_release
    else:
        release = client.release(_id)

    # artistas del release
    artists = []
    try:
        if release.artists:
            for a in release.artists:
                if hasattr(a, "name"):
                    artists.append(a.name)
                else:
                    artists.append(str(a))
    except Exception:
        pass

    # labels (sellos)
    labels: List[str] = []
    try:
        for lab in getattr(release, "labels", []) or []:
            name = getattr(lab, "name", None) or (lab.get("name") if isinstance(lab, dict) else None)
            if name:
                labels.append(str(name))
    except Exception:
        pass

    # ---------- Tracklist: filtrar encabezados ("That Side", "This Side", etc.) ----------
    _HEADINGS = {
        "that side", "this side", "logo side", "info side",
        "other side", "both sides", "this-side", "that-side",
        "side a", "side b"  # por si algún release lo cargó así
    }
    def _norm(s: str) -> str:
        return _re.sub(r"\s+", " ", (s or "").strip().lower())

    tracks: List[TrackInfo] = []
    try:
        for t in (getattr(release, "tracklist", None) or []):
            # 1) Si Discogs marca el item como encabezado, lo salteamos
            t_type = getattr(t, "type_", None)
            if t_type and str(t_type).lower() != "track":
                continue

            # 2) Filtro de resguardo: títulos típicos de encabezado + sin duración
            title_raw = str(getattr(t, "title", "") or "").strip()
            dur_raw = str(getattr(t, "duration", "") or "") or None
            if (not dur_raw) and (_norm(title_raw) in _HEADINGS):
                continue

            # 3) Artistas específicos del track (si existen)
            track_artists: Optional[List[str]] = None
            try:
                if getattr(t, "artists", None):
                    track_artists = []
                    for ta in t.artists:
                        nm = getattr(ta, "name", None) or (ta.get("name") if isinstance(ta, dict) else None)
                        if nm:
                            track_artists.append(str(nm))
            except Exception:
                track_artists = None

            tracks.append(
                TrackInfo(
                    position=str(getattr(t, "position", "") or ""),
                    title=title_raw,
                    duration=dur_raw,
                    artists=track_artists,
                )
            )
    except Exception:
        pass

    # imágenes
    image_urls = _images_to_urls(getattr(release, "images", []))

    # === PRECIOS ===
    # 1) Intento oficial con stats
    pmin, pmed, pmax, curr = fetch_market_stats(release.id, DISCOGS_CURRENCY)

    # 2) Fallback con price_suggestions si faltan mediana/máximo
    if pmed is None or pmax is None:
        s_min, s_med, s_max = fetch_price_suggestions_approx(release.id, DISCOGS_CURRENCY)
        # completamos solo lo que falta
        if pmin is None:
            pmin = s_min
        if pmed is None:
            pmed = s_med
        if pmax is None:
            pmax = s_max

    # Lo que llamábamos community_avg_price lo alineamos a "mediana" (más útil)
    community_avg_price = pmed

    return ReleaseInfo(
        title=str(getattr(release, "title", "") or "").strip(),
        artists=artists,
        year=getattr(release, "year", None),
        country=getattr(release, "country", None),
        labels=labels,
        tracks=tracks,
        images=image_urls,
        community_avg_price=community_avg_price,
        marketplace_currency=curr,
        price_min=pmin,
        price_median=pmed,
        price_max=pmax,
    )