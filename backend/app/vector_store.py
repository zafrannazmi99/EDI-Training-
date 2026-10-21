import json
import sqlite3
from functools import lru_cache
from typing import Any

import numpy as np

from .config import settings
from .places import CLEAN_PATH


@lru_cache(maxsize=1)
def get_embedder():
    # Load the embedding runtime only when search or indexing is requested. This
    # lets health, authentication, and trip endpoints start without loading Torch.
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(settings.embedding_model)


def _connect() -> sqlite3.Connection:
    settings.vector_db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(settings.vector_db_path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS places (
            id TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            metadata TEXT NOT NULL,
            embedding BLOB NOT NULL,
            dimensions INTEGER NOT NULL
        )
        """
    )
    return connection


def build_index() -> int:
    if not CLEAN_PATH.exists():
        raise FileNotFoundError("No cleaned places found. Run `python -m app.ingest` first.")
    places = json.loads(CLEAN_PATH.read_text(encoding="utf-8"))
    if not places:
        raise ValueError("The cleaned place file is empty. Fetch places before indexing.")

    embedder = get_embedder()
    connection = _connect()
    try:
        with connection:
            connection.execute("DELETE FROM places")
            batch_size = 64
            for start in range(0, len(places), batch_size):
                batch = places[start:start + batch_size]
                vectors = embedder.encode(
                    [place["description"] for place in batch],
                    normalize_embeddings=True,
                    convert_to_numpy=True,
                )
                rows = []
                for place, vector in zip(batch, vectors):
                    vector = np.asarray(vector, dtype=np.float32)
                    metadata = {
                        "name": place["name"],
                        "place_type": place["place_type"],
                        "lat": place["lat"],
                        "lon": place["lon"],
                        "tags": place["tags"],
                    }
                    rows.append((
                        place["id"],
                        place["description"],
                        json.dumps(metadata, ensure_ascii=False),
                        vector.tobytes(),
                        int(vector.size),
                    ))
                connection.executemany(
                    "INSERT INTO places (id, description, metadata, embedding, dimensions) "
                    "VALUES (?, ?, ?, ?, ?)",
                    rows,
                )
    finally:
        connection.close()
    return len(places)


def search_places(question: str, limit: int = 5) -> list[dict[str, Any]]:
    connection = _connect()
    try:
        rows = connection.execute(
            "SELECT id, description, metadata, embedding, dimensions FROM places"
        ).fetchall()
    finally:
        connection.close()

    if not rows:
        raise RuntimeError("The place index is empty. Run `python -m app.index_places` first.")

    query_vector = np.asarray(
        get_embedder().encode(
            [question], normalize_embeddings=True, convert_to_numpy=True
        )[0],
        dtype=np.float32,
    )
    if any(row["dimensions"] != query_vector.size for row in rows):
        raise RuntimeError("The place index uses a different embedding model. Rebuild the index.")

    matrix = np.vstack([
        np.frombuffer(row["embedding"], dtype=np.float32, count=row["dimensions"])
        for row in rows
    ])
    scores = matrix @ query_vector
    places = []
    seen_places = set()
    for index in np.argsort(scores)[::-1]:
        row = rows[int(index)]
        metadata = json.loads(row["metadata"])
        unique_name = metadata.get("name", "Outdoor place").strip().casefold()
        unique_key = (unique_name, metadata.get("place_type", "Outdoor place"))
        if unique_key in seen_places:
            continue
        seen_places.add(unique_key)
        places.append({
            "id": row["id"],
            "name": metadata.get("name", "Outdoor place"),
            "place_type": metadata.get("place_type", "Outdoor place"),
            "lat": metadata["lat"],
            "lon": metadata["lon"],
            "description": row["description"],
            "tags": metadata.get("tags", {}),
            "score": round(max(0.0, min(1.0, float(scores[index]))), 3),
        })
        if len(places) >= limit:
            break
    return places
