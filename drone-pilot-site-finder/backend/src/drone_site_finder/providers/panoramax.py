from datetime import UTC, datetime
from urllib.parse import urlparse

from drone_site_finder.providers.http import SourceUnavailable
from drone_site_finder.schemas.sites import SourceReport

URL = "https://api.panoramax.xyz/api/search"


def https_url(value):
    return value if isinstance(value, str) and urlparse(value).scheme == "https" else None


async def fetch_photos(http, bbox, enabled):
    status, detail, photos = "disabled", "Disabled by request.", []
    if enabled:
        try:
            data = await http.json(URL, params={"bbox": ",".join(map(str, bbox)), "limit": 60})
            for feature in data.get("features", []):
                properties = feature.get("properties", {})
                license_url = next(
                    (
                        https_url(link.get("href"))
                        for link in feature.get("links", [])
                        if link.get("rel") == "license"
                    ),
                    None,
                )
                # Skip unlicensed metadata instead of assuming a federation-wide image licence.
                if not license_url or feature.get("geometry", {}).get("type") != "Point":
                    continue
                producer = properties.get("geovisio:producer") or ", ".join(
                    p.get("name", "")
                    for p in feature.get("providers", [])
                    if "producer" in p.get("roles", [])
                )
                origin = next(
                    (
                        https_url(link.get("href"))
                        for link in feature.get("links", [])
                        if link.get("rel") == "via"
                    ),
                    "https://api.panoramax.xyz",
                )
                photos.append(
                    {
                        "id": feature["id"],
                        "geometry": feature["geometry"],
                        "url": f"{origin}/#focus=pic&pic={feature['id']}",
                        "thumbnail_url": https_url(
                            feature.get("assets", {}).get("thumb", {}).get("href")
                        )
                        if producer
                        else None,
                        "license_url": license_url,
                        "attribution": str(
                            producer or "Auteur non renseigné : consulter l’original"
                        ),
                        "captured_at": properties.get("datetime"),
                    }
                )
            status, detail = (
                "available",
                "Up to 60 nearby catalogue images; not evidence of current site conditions.",
            )
        except (SourceUnavailable, ValueError, KeyError, TypeError) as exc:
            status, detail = "unavailable", str(exc)
    return photos, SourceReport(
        id="panoramax",
        name="Panoramax",
        url=URL,
        license="Per-image licence link",
        attribution="Panoramax contributors",
        status=status,
        detail=detail,
        feature_count=len(photos),
        fetched_at=datetime.now(UTC).isoformat(),
    )
