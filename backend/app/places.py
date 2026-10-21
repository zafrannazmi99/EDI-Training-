import json
from typing import Any

import httpx

from .config import PROJECT_ROOT


RAW_PATH = PROJECT_ROOT / "data" / "raw" / "karlsruhe_places.json"
CLEAN_PATH = PROJECT_ROOT / "data" / "places.json"
OVERPASS_ENDPOINTS = (
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
)
PHOTON_ENDPOINT = "https://photon.komoot.io/api/"
PHOTON_QUERIES = (
    "park Karlsruhe",
    "Aussichtspunkt Karlsruhe",
    "playground Karlsruhe",
    "Naturschutzgebiet Karlsruhe",
    "Picknickplatz Karlsruhe",
    "Stadtwald Karlsruhe",
    "Baggersee Karlsruhe",
    "Wanderweg Karlsruhe",
    "Naturpark Karlsruhe",
)

# A Karlsruhe-centered bounding box keeps the first download bounded and simple.
OVERPASS_QUERY = (
    "[out:json][timeout:75];\n"
    "(\n"
    '  nwr(48.78,8.15,49.23,8.70)["tourism"="viewpoint"];\n'
    '  nwr(48.78,8.15,49.23,8.70)["leisure"~"^(park|nature_reserve|picnic_table|playground|garden|recreation_ground)$"];\n'
    '  nwr(48.78,8.15,49.23,8.70)["amenity"~"^(picnic_table|bench)$"];\n'
    '  nwr(48.78,8.15,49.23,8.70)["natural"~"^(water|wood|scrub)$"];\n'
    '  nwr(48.78,8.15,49.23,8.70)["waterway"~"^(river|stream|canal)$"];\n'
    '  relation(48.78,8.15,49.23,8.70)["route"="hiking"];\n'
    ");\n"
    "out center tags;"
)

TYPE_LABELS = {
    "tourism=viewpoint": "Viewpoint",
    "leisure=park": "Park",
    "leisure=nature_reserve": "Nature reserve",
    "leisure=picnic_table": "Picnic spot",
    "amenity=picnic_table": "Picnic spot",
    "amenity=bench": "Bench",
    "leisure=playground": "Playground",
    "leisure=garden": "Garden",
    "leisure=recreation_ground": "Recreation ground",
    "natural=water": "Water feature",
    "natural=wood": "Woodland",
    "natural=scrub": "Natural area",
    "landuse=forest": "Woodland",
    "water=lake": "Lake",
    "highway=footway": "Footway",
    "highway=track": "Mapped track",
    "waterway=river": "River",
    "waterway=stream": "Stream",
    "waterway=canal": "Canal",
    "route=hiking": "Hiking route",
}


def classify(tags: dict[str, Any]) -> str:
    for key in ("tourism", "leisure", "amenity", "natural", "landuse", "water", "highway", "waterway", "route"):
        value = tags.get(key)
        if value is not None:
            label = TYPE_LABELS.get(f"{key}={value}")
            if label:
                return label
    return "Outdoor place"


def coordinates(element: dict[str, Any]) -> tuple[float | None, float | None]:
    center = element.get("center") or {}
    lat = element.get("lat", center.get("lat"))
    lon = element.get("lon", center.get("lon"))
    if lat is None or lon is None:
        return None, None
    return float(lat), float(lon)


def describe(name: str, place_type: str, tags: dict[str, Any]) -> str:
    # Use only OSM-provided details so the search index cannot add unsupported facts.
    details = []
    for key, label in (("description", "Description"), ("surface", "surface"),
                       ("access", "access"), ("fee", "fee"), ("opening_hours", "opening hours"),
                       ("wheelchair", "wheelchair access"), ("operator", "managed by")):
        value = tags.get(key)
        if not value or not str(value).strip():
            continue
        details.append(str(value).strip() if key == "description" else f"{label}: {value}")
    suffix = f" Details: {'; '.join(details)}." if details else ""
    return f"{name} is an OpenStreetMap-listed {place_type.lower()} near Karlsruhe.{suffix}"


def clean_elements(elements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    places: list[dict[str, Any]] = []
    for element in elements:
        tags = element.get("tags") or {}
        lat, lon = coordinates(element)
        if lat is None or lon is None:
            continue
        place_type = classify(tags)
        name = str(tags.get("name") or f"{place_type} (OSM {element.get('id')})").strip()
        osm_id = f"{element.get('type', 'object')}/{element.get('id')}"
        places.append({
            "id": osm_id,
            "name": name,
            "place_type": place_type,
            "lat": lat,
            "lon": lon,
            "description": describe(name, place_type, tags),
            "tags": tags,
        })
    return places


def fetch_places() -> tuple[int, int]:
    RAW_PATH.parent.mkdir(parents=True, exist_ok=True)
    CLEAN_PATH.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            response = httpx.post(
                endpoint,
                data={"data": OVERPASS_QUERY},
                timeout=httpx.Timeout(15.0, connect=8.0),
                headers={"User-Agent": "KarlsruheHiddenGems/1.0 (learning project)"},
            )
            response.raise_for_status()
            raw = response.json()
            elements = raw.get("elements", [])
            places = clean_elements(elements)
            RAW_PATH.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
            CLEAN_PATH.write_text(json.dumps(places, ensure_ascii=False, indent=2), encoding="utf-8")
            return len(elements), len(places)
        except (httpx.HTTPError, ValueError) as exc:
            last_error = exc

    photon_places: dict[tuple[str, str, float, float], dict[str, Any]] = {}
    photon_features = []
    for query in PHOTON_QUERIES:
        try:
            response = httpx.get(
                PHOTON_ENDPOINT,
                params={"q": query, "limit": 25, "lat": 49.0069, "lon": 8.4037, "lang": "en"},
                timeout=httpx.Timeout(15.0, connect=8.0),
                headers={"User-Agent": "KarlsruheHiddenGems/1.0 (learning project)"},
            )
            response.raise_for_status()
            features = response.json().get("features", [])
            photon_features.extend(features)
            for feature in features:
                properties = feature.get("properties") or {}
                key = properties.get("osm_key")
                value = properties.get("osm_value")
                if f"{key}={value}" not in TYPE_LABELS or not properties.get("name"):
                    continue
                coordinates = (feature.get("geometry") or {}).get("coordinates") or []
                if len(coordinates) < 2:
                    continue
                lon, lat = map(float, coordinates[:2])
                if not (48.78 <= lat <= 49.23 and 8.15 <= lon <= 8.70):
                    continue
                osm_type = {"N": "node", "W": "way", "R": "relation"}.get(properties.get("osm_type"))
                osm_id = properties.get("osm_id")
                if not osm_type or osm_id is None:
                    continue
                tags = {"name": properties["name"], key: value}
                place = clean_elements([{
                    "type": osm_type,
                    "id": osm_id,
                    "lat": lat,
                    "lon": lon,
                    "tags": tags,
                }])
                if place:
                    item = place[0]
                    key = (
                        item["name"].casefold(),
                        item["place_type"],
                        round(item["lat"], 4),
                        round(item["lon"], 4),
                    )
                    photon_places[key] = item
        except (httpx.HTTPError, ValueError) as exc:
            last_error = exc

    if photon_places:
        places = list(photon_places.values())
        RAW_PATH.write_text(
            json.dumps({"source": "Photon / OpenStreetMap", "features": photon_features}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        CLEAN_PATH.write_text(json.dumps(places, ensure_ascii=False, indent=2), encoding="utf-8")
        return len(photon_features), len(places)

    raise RuntimeError(f"Could not download OSM places from Overpass: {last_error}")
