import os
import re
from dataclasses import dataclass
from typing import List, Optional
from urllib.parse import urlparse
import discogs_client
from dotenv import load_dotenv

load_dotenv()

DISCOGS_USER_TOKEN = os.getenv("DISCOGS_USER_TOKEN")
APP_USER_AGENT = os.getenv("APP_USER_AGENT", "DiscogsTool/1.0")

if not DISCOGS_USER_TOKEN:
    raise RuntimeError("Falta DISCOGS_USER_TOKEN en .env")

client = discogs_client.Client(APP_USER_AGENT, user_token=DISCOGS_USER_TOKEN)


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


def _extract_release_or_master_id(url: str):
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]

    # descartar prefijos de idioma (fr, es, de, etc.)
    if len(parts) >= 2 and len(parts[0]) == 2:
        parts = parts[1:]

    if len(parts) >= 2 and parts[0] in ("release", "master"):
        kind = parts[0]
        match = re.match(r"(\d+)", parts[1])
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

    # tracks con artistas por track (si existen)
    tracks: List[TrackInfo] = []
    try:
        for t in release.tracklist or []:
            track_artists: Optional[List[str]] = None
            try:
                if getattr(t, "artists", None):
                    track_artists = []
                    for ta in t.artists:
                        # t.artists puede tener .name
                        nm = getattr(ta, "name", None) or (ta.get("name") if isinstance(ta, dict) else None)
                        if nm:
                            track_artists.append(str(nm))
                # si no hay, lo dejamos como None y luego la UI podrá usar artistas del release
            except Exception:
                track_artists = None

            tracks.append(
                TrackInfo(
                    position=str(getattr(t, "position", "") or ""),
                    title=str(getattr(t, "title", "") or "").strip(),
                    duration=str(getattr(t, "duration", "") or "") or None,
                    artists=track_artists,
                )
            )
    except Exception:
        pass

    # imágenes
    image_urls = _images_to_urls(getattr(release, "images", []))

    # precios
    avg_price = None
    currency = None
    price_min = None
    price_median = None
    price_max = None
    try:
        data = getattr(release, "data", {}) or {}
        avg_price = data.get("lowest_price", None)
        currency = data.get("curr_abbr", None) or data.get("lowest_price_currency", None)
        price_min = data.get("lowest_price", None)
        price_median = data.get("median_price", None)
        price_max = data.get("highest_price", None)
    except Exception:
        pass

    return ReleaseInfo(
        title=str(getattr(release, "title", "") or "").strip(),
        artists=artists,
        year=getattr(release, "year", None),
        country=getattr(release, "country", None),
        labels=labels,
        tracks=tracks,
        images=image_urls,
        community_avg_price=avg_price,
        marketplace_currency=currency,
        price_min=price_min,
        price_median=price_median,
        price_max=price_max,
    )