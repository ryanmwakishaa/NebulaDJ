import csv
import hashlib
import math
import os
import random
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict

BASE_DIR = Path(__file__).resolve().parent
LIBRARY_FILE = BASE_DIR / "library.csv"
SONGS_DIR = BASE_DIR / "songs"
PLAYLISTS_DB = BASE_DIR / "nebula_playlists.db"

app = FastAPI(title="NebulaDJ API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Persistent playlists (SQLite)
# ---------------------------------------------------------------------------

class PlaylistCreate(BaseModel):
    name: str


@contextmanager
def _playlist_db() -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(PLAYLISTS_DB, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _init_playlist_db() -> None:
    with _playlist_db() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS playlists (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS playlist_tracks (
                playlist_id TEXT NOT NULL,
                track_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (playlist_id, track_id),
                FOREIGN KEY (playlist_id) REFERENCES playlists(id)
                    ON DELETE CASCADE
            )
            """
        )


def _playlist_to_dict(connection: sqlite3.Connection, playlist_id: str) -> dict[str, Any] | None:
    playlist = connection.execute(
        "SELECT id, name, created_at FROM playlists WHERE id = ?",
        (playlist_id,),
    ).fetchone()
    if playlist is None:
        return None

    track_rows = connection.execute(
        """
        SELECT track_id
        FROM playlist_tracks
        WHERE playlist_id = ?
        ORDER BY position ASC, track_id ASC
        """,
        (playlist_id,),
    ).fetchall()

    return {
        "id": playlist["id"],
        "name": playlist["name"],
        "track_ids": [row["track_id"] for row in track_rows],
        "created_at": playlist["created_at"],
    }


_init_playlist_db()


# ---------------------------------------------------------------------------
# Library helpers
# ---------------------------------------------------------------------------

def _as_float(value: Any) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _stable_track_id(row: dict[str, Any], index: int) -> str:
    """Return an ID that does not change when CSV rows are reordered."""
    explicit_id = (row.get("track_id") or "").strip()
    if explicit_id.startswith("trk_"):
        return explicit_id

    raw_path = (row.get("path") or row.get("file_path") or "").strip()
    if raw_path:
        normalized_path = os.path.normpath(raw_path).replace("\\\\", "/").casefold()
        identity = f"path:{normalized_path}"
    else:
        title = (row.get("title") or f"Track {index + 1}").strip().casefold()
        artist = (row.get("artist") or "Unknown artist").strip().casefold()
        identity = f"metadata:{artist}|{title}"
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
    return f"trk_{digest}"


def _migrate_legacy_playlist_track_ids(tracks: list[dict[str, Any]]) -> None:
    """Best-effort migrate old playlist IDs that were CSV row indexes."""
    if not PLAYLISTS_DB.exists():
        return
    index_to_id = {str(index): track["id"] for index, track in enumerate(tracks)}
    with _playlist_db() as connection:
        rows = connection.execute(
            "SELECT playlist_id, track_id, position FROM playlist_tracks"
        ).fetchall()
        for row in rows:
            old_id = str(row["track_id"])
            if not old_id.isdigit():
                continue
            new_id = index_to_id.get(old_id)
            if new_id is None:
                connection.execute(
                    "DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?",
                    (row["playlist_id"], old_id),
                )
                continue
            exists = connection.execute(
                "SELECT 1 FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?",
                (row["playlist_id"], new_id),
            ).fetchone()
            if exists:
                connection.execute(
                    "DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?",
                    (row["playlist_id"], old_id),
                )
            else:
                connection.execute(
                    "UPDATE playlist_tracks SET track_id = ? WHERE playlist_id = ? AND track_id = ?",
                    (new_id, row["playlist_id"], old_id),
                )


def _read_library() -> list[dict[str, Any]]:
    if not LIBRARY_FILE.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Library CSV not found: {LIBRARY_FILE}",
        )

    with LIBRARY_FILE.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    tracks: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        # Expose the fields the React frontend expects, with an order-independent ID.
        try:
            bpm = float(row.get("bpm") or 0)
        except (TypeError, ValueError):
            bpm = 0.0
        try:
            duration = float(row.get("duration_sec") or row.get("duration") or 0)
        except (TypeError, ValueError):
            duration = 0.0
        try:
            raw_energy = float(row.get("energy") or 0)
        except (TypeError, ValueError):
            raw_energy = 0.0

        # The analyzer stores energy on a 1..10 scale; UI uses 0..1.
        energy = max(0.0, min(1.0, raw_energy / 10.0 if raw_energy > 1 else raw_energy))

        track_id = _stable_track_id(row, index)
        tracks.append({
            "id": track_id,
            "title": (row.get("title") or Path(row.get("path") or f"Track {index + 1}").stem).strip(),
            "artist": (row.get("artist") or "Unknown artist").strip(),
            "album": (row.get("album") or "").strip() or None,
            "genre": (row.get("genre") or "unknown").strip() or "unknown",
            "bpm": round(bpm, 3),
            "key": (row.get("key") or "").strip(),
            "energy": energy,
            "duration_sec": duration,
            "file_path": (row.get("path") or row.get("file_path") or "").strip(),
            "first_downbeat_sec": _as_float(row.get("first_downbeat") or row.get("first_downbeat_sec")),
            "audio_url": f"/api/audio/{track_id}",
            "file_format": Path(row.get("path") or row.get("file_path") or "").suffix.lstrip(".").lower() or None,
        })
    _migrate_legacy_playlist_track_ids(tracks)
    return tracks


def _get_track_or_404(track_id: str) -> dict[str, Any]:
    track = next((item for item in _read_library() if item["id"] == str(track_id)), None)
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return track


def _find_audio_file(track: dict[str, Any]) -> Path:
    original_path = Path(track.get("file_path") or "")
    filename = original_path.name

    candidates = [
        SONGS_DIR / filename,
        BASE_DIR.parent / "songs" / filename,
        original_path,
    ]
    for candidate in candidates:
        try:
            if candidate.is_file():
                return candidate.resolve()
        except (OSError, ValueError):
            continue

    raise HTTPException(
        status_code=404,
        detail=(
            f"Audio file '{filename or 'unknown'}' was not found. "
            f"Place it in '{SONGS_DIR}' or update the path column in library.csv."
        ),
    )


# ---------------------------------------------------------------------------
# Core endpoints (health, tracks, audio)
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": app.version}


# ---------------------------------------------------------------------------
# Playlists
# ---------------------------------------------------------------------------

@app.get("/api/playlists")
def get_playlists() -> list[dict[str, Any]]:
    with _playlist_db() as connection:
        rows = connection.execute(
            "SELECT id FROM playlists ORDER BY created_at DESC, id DESC"
        ).fetchall()
        playlists = [
            _playlist_to_dict(connection, row["id"])
            for row in rows
        ]
    return [playlist for playlist in playlists if playlist is not None]


@app.post("/api/playlists", status_code=201)
def create_playlist(payload: PlaylistCreate) -> dict[str, Any]:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Playlist name cannot be empty")
    if len(name) > 100:
        raise HTTPException(status_code=422, detail="Playlist name must be 100 characters or fewer")

    playlist_id = uuid.uuid4().hex
    created_at = datetime.now(timezone.utc).isoformat()

    with _playlist_db() as connection:
        connection.execute(
            "INSERT INTO playlists (id, name, created_at) VALUES (?, ?, ?)",
            (playlist_id, name, created_at),
        )
        playlist = _playlist_to_dict(connection, playlist_id)

    if playlist is None:
        raise HTTPException(status_code=500, detail="Could not create playlist")
    return playlist


@app.delete("/api/playlists/{playlist_id}", status_code=204)
def delete_playlist(playlist_id: str) -> None:
    with _playlist_db() as connection:
        cursor = connection.execute(
            "DELETE FROM playlists WHERE id = ?",
            (playlist_id,),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Playlist not found")


@app.post("/api/playlists/{playlist_id}/tracks/{track_id}")
def add_track_to_playlist(playlist_id: str, track_id: str) -> dict[str, Any]:
    _get_track_or_404(track_id)

    with _playlist_db() as connection:
        exists = connection.execute(
            "SELECT 1 FROM playlists WHERE id = ?",
            (playlist_id,),
        ).fetchone()
        if exists is None:
            raise HTTPException(status_code=404, detail="Playlist not found")

        already_added = connection.execute(
            """
            SELECT 1 FROM playlist_tracks
            WHERE playlist_id = ? AND track_id = ?
            """,
            (playlist_id, track_id),
        ).fetchone()

        if already_added is None:
            position_row = connection.execute(
                """
                SELECT COALESCE(MAX(position), -1) + 1 AS next_position
                FROM playlist_tracks WHERE playlist_id = ?
                """,
                (playlist_id,),
            ).fetchone()
            connection.execute(
                """
                INSERT INTO playlist_tracks (playlist_id, track_id, position)
                VALUES (?, ?, ?)
                """,
                (playlist_id, track_id, position_row["next_position"]),
            )

        playlist = _playlist_to_dict(connection, playlist_id)

    if playlist is None:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return playlist


@app.delete("/api/playlists/{playlist_id}/tracks/{track_id}")
def remove_track_from_playlist(playlist_id: str, track_id: str) -> dict[str, Any]:
    with _playlist_db() as connection:
        exists = connection.execute(
            "SELECT 1 FROM playlists WHERE id = ?",
            (playlist_id,),
        ).fetchone()
        if exists is None:
            raise HTTPException(status_code=404, detail="Playlist not found")

        connection.execute(
            """
            DELETE FROM playlist_tracks
            WHERE playlist_id = ? AND track_id = ?
            """,
            (playlist_id, track_id),
        )

        # Keep playlist ordering compact after a removal.
        remaining = connection.execute(
            """
            SELECT track_id FROM playlist_tracks
            WHERE playlist_id = ?
            ORDER BY position ASC, track_id ASC
            """,
            (playlist_id,),
        ).fetchall()
        for position, row in enumerate(remaining):
            connection.execute(
                """
                UPDATE playlist_tracks SET position = ?
                WHERE playlist_id = ? AND track_id = ?
                """,
                (position, playlist_id, row["track_id"]),
            )

        playlist = _playlist_to_dict(connection, playlist_id)

    if playlist is None:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return playlist


@app.get("/api/tracks")
def get_tracks(
    search: str | None = None,
    genre: str | None = None,
    min_bpm: float | None = None,
    max_bpm: float | None = None,
    min_energy: float | None = None,
    max_energy: float | None = None,
    key: str | None = None,
    sort: str = Query("bpm", pattern="^(bpm|energy|title|artist|duration|created)$"),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> list[dict[str, Any]]:
    tracks = _read_library()

    if search:
        needle = search.casefold().strip()
        tracks = [
            track for track in tracks
            if needle in track["title"].casefold()
            or needle in track["artist"].casefold()
        ]
    if genre:
        tracks = [track for track in tracks if track["genre"].casefold() == genre.casefold()]
    if key:
        tracks = [track for track in tracks if track["key"].casefold() == key.casefold()]
    if min_bpm is not None:
        tracks = [track for track in tracks if track["bpm"] >= min_bpm]
    if max_bpm is not None:
        tracks = [track for track in tracks if track["bpm"] <= max_bpm]
    if min_energy is not None:
        tracks = [track for track in tracks if track["energy"] >= min_energy]
    if max_energy is not None:
        tracks = [track for track in tracks if track["energy"] <= max_energy]

    sort_field = {"duration": "duration_sec", "created": "title"}.get(sort, sort)
    tracks.sort(key=lambda track: track.get(sort_field) or 0, reverse=(sort_dir == "desc"))
    return tracks[offset:offset + limit]


# NOTE: /genres and /keys must stay above /{track_id}, or FastAPI will try to
# parse "genres" as an integer ID.
@app.get("/api/tracks/genres")
def get_genres() -> list[str]:
    return sorted({track["genre"] for track in _read_library() if track["genre"]})


@app.get("/api/tracks/keys")
def get_keys() -> list[str]:
    return sorted({track["key"] for track in _read_library() if track["key"]})


@app.get("/api/tracks/{track_id}")
def get_track(track_id: str) -> dict[str, Any]:
    return _get_track_or_404(track_id)


@app.get("/api/tracks/{track_id}/audio")
def get_track_audio(track_id: str) -> dict[str, str]:
    _get_track_or_404(track_id)
    # Relative URL means the frontend can build the right origin from BASE_URL.
    return {"url": f"/api/audio/{track_id}"}


@app.get("/api/audio/{track_id}")
def stream_audio(track_id: str) -> FileResponse:
    track = _get_track_or_404(track_id)
    audio_path = _find_audio_file(track)
    media_type = "audio/mpeg" if audio_path.suffix.lower() == ".mp3" else "audio/*"
    return FileResponse(path=audio_path, media_type=media_type, filename=audio_path.name)


@app.get("/api/tracks/{track_id}/waveform")
def get_waveform(track_id: str, points: int = Query(800, ge=50, le=5000)) -> dict[str, Any]:
    """Approximate waveform.

    Real peak extraction needs an audio decoder (librosa / soundfile / ffmpeg).
    Until that is wired in, this returns a deterministic placeholder envelope so
    the waveform UI has something to draw. It is the same every time for a given
    track and scales loosely with the track's energy.
    """
    track = _get_track_or_404(track_id)
    rng = random.Random(int(hashlib.sha256(track_id.encode("utf-8")).hexdigest()[:8], 16))
    base = 0.35 + 0.45 * track["energy"]
    peaks: list[float] = []
    for i in range(points):
        t = i / points
        envelope = 0.75 + 0.25 * math.sin(t * math.pi * 6)
        noise = rng.uniform(0.55, 1.0)
        peaks.append(round(max(0.02, min(1.0, base * envelope * noise)), 4))
    return {
        "track_id": track["id"],
        "duration_sec": track["duration_sec"],
        "points": len(peaks),
        "peaks": peaks,
        "approximate": True,
    }


# ---------------------------------------------------------------------------
# Library analysis (the CSV is produced by an external analyzer)
# ---------------------------------------------------------------------------

@app.post("/api/library/analyze")
@app.get("/api/library/analyze/progress")
def library_analyze_progress() -> dict[str, Any]:
    total = len(_read_library())
    return {
        "status": "complete",
        "total": total,
        "processed": total,
        "progress": 1.0,
        "message": "Library is read from library.csv; run your analyzer script to refresh it.",
    }


# ---------------------------------------------------------------------------
# AI helpers: key / BPM compatibility
# ---------------------------------------------------------------------------

def _camelot(key: str) -> tuple[int, str] | None:
    m = re.fullmatch(r"\s*(\d{1,2})\s*([ABab])\s*", key or "")
    return (int(m.group(1)), m.group(2).upper()) if m else None


def _key_score(a: str, b: str) -> float:
    ca, cb = _camelot(a), _camelot(b)
    if not ca or not cb:
        return 1.0 if a and a.casefold() == b.casefold() else 0.4
    if ca == cb:
        return 1.0
    diff = min((ca[0] - cb[0]) % 12, (cb[0] - ca[0]) % 12)
    if ca[1] == cb[1] and diff == 1:
        return 0.85
    if ca[0] == cb[0]:  # relative major/minor
        return 0.85
    if ca[1] == cb[1] and diff == 2:
        return 0.55
    return 0.15


def _bpm_score(a: float, b: float) -> float:
    if not a or not b:
        return 0.4
    diff = min(abs(a - b), abs(a * 2 - b), abs(a - b * 2))  # half / double time
    return max(0.0, 1 - diff / 12)


def _compat(a: dict[str, Any], b: dict[str, Any]) -> float:
    return 0.55 * _bpm_score(a["bpm"], b["bpm"]) + 0.45 * _key_score(a["key"], b["key"])


def _norm_mode(mode: str | None) -> str:
    return re.sub(r"[\s\-]+", "_", (mode or "auto").strip().lower())


# mode -> (start energy, end energy) for set generation
_SET_CURVES: dict[str, tuple[float, float]] = {
    "auto":           (0.40, 0.80),
    "generate":       (0.40, 0.80),
    "build_energy":   (0.30, 0.95),
    "build":          (0.30, 0.95),
    "peak_hour":      (0.75, 1.00),
    "peak":           (0.75, 1.00),
    "warm_up":        (0.20, 0.50),
    "warmup":         (0.20, 0.50),
    "afro_house":     (0.40, 0.85),
    "afro_house_journey": (0.40, 0.85),
    "sunset":         (0.30, 0.60),
    "sunset_session": (0.30, 0.60),
    "recovery":       (0.45, 0.15),
    "recovery_mode":  (0.45, 0.15),
}

# mode -> how much higher/lower than the current track the next one should be
_ENERGY_DELTA: dict[str, float] = {
    "build_energy": 0.10, "build": 0.10,
    "peak_hour": 0.05, "peak": 0.05,
    "warm_up": -0.05, "warmup": -0.05,
    "sunset": -0.05, "sunset_session": -0.05,
    "recovery": -0.15, "recovery_mode": -0.15,
}


def _describe(a: dict[str, Any], b: dict[str, Any]) -> str:
    bpm_diff = abs(a["bpm"] - b["bpm"])
    key_ok = _key_score(a["key"], b["key"]) >= 0.85
    return f"{bpm_diff:.0f} BPM apart, " + ("harmonic key match" if key_ok else "different key")


# ---------------------------------------------------------------------------
# AI: recommendations
# ---------------------------------------------------------------------------

def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _transition_hint(a: dict[str, Any], b: dict[str, Any]) -> str:
    bpm_diff = abs(a["bpm"] - b["bpm"])
    harmonic = _key_score(a["key"], b["key"]) >= 0.85
    if bpm_diff <= 3 and harmonic:
        return "Long blend (32 beats)"
    if bpm_diff <= 6:
        return "Standard blend (16 beats)"
    if bpm_diff <= 12:
        return "Short blend with EQ swap (8 beats)"
    return "Quick cut or echo-out"


def _recommend(refs: list[dict[str, Any]], mode: str, limit: int) -> list[dict[str, Any]]:
    tracks = _read_library()
    exclude = {r["id"] for r in refs}
    delta = _ENERGY_DELTA.get(mode, 0.0)

    results: list[dict[str, Any]] = []
    for t in tracks:
        if t["id"] in exclude:
            continue
        if refs:
            bpm_c = _avg([_bpm_score(r["bpm"], t["bpm"]) for r in refs])
            harm_c = _avg([_key_score(r["key"], t["key"]) for r in refs])
            target = _avg([r["energy"] for r in refs]) + delta
            energy_c = 1 - min(1.0, abs(t["energy"] - target))
            genre_c = _avg([1.0 if r["genre"].casefold() == t["genre"].casefold() else 0.3 for r in refs])
            score = 0.35 * bpm_c + 0.30 * harm_c + 0.20 * energy_c + 0.15 * genre_c
            explanation = f"Mixes with {refs[0]['title']}: {_describe(refs[0], t)}."
            transition = _transition_hint(refs[0], t)
        else:
            bpm_c = harm_c = genre_c = 0.5
            energy_c = t["energy"]
            score = t["energy"]
            explanation = "High-energy pick from your library."
            transition = "Standard blend (16 beats)"

        results.append({
            "track": t,
            "compatibility_score": round(score, 3),
            "bpm_compatibility": round(bpm_c, 3),
            "harmonic_compatibility": round(harm_c, 3),
            "energy_compatibility": round(energy_c, 3),
            "genre_affinity": round(genre_c, 3),
            "explanation": explanation,
            "recommended_transition": transition,
        })

    results.sort(key=lambda r: r["compatibility_score"], reverse=True)
    return results[:limit]


@app.get("/api/ai/recommendations")
def ai_recommendations_for_decks(
    mode: str = "auto",
    limit: int = Query(8, ge=1, le=50),
    deck_a: str | None = None,
    deck_b: str | None = None,
) -> list[dict[str, Any]]:
    tracks = _read_library()
    by_id = {track["id"]: track for track in tracks}
    refs = [by_id[track_id] for track_id in (deck_a, deck_b) if track_id in by_id]
    return _recommend(refs, _norm_mode(mode), limit)


@app.get("/api/ai/recommendations/{track_id}")
def ai_recommendations_for_track(
    track_id: str,
    mode: str = "auto",
    limit: int = Query(8, ge=1, le=50),
) -> list[dict[str, Any]]:
    track = _get_track_or_404(track_id)
    return _recommend([track], _norm_mode(mode), limit)


# ---------------------------------------------------------------------------
# AI: set generation
# ---------------------------------------------------------------------------

class AISetRequest(BaseModel):
    # Accepts both snake_case and camelCase; unknown fields are kept, not rejected.
    model_config = ConfigDict(extra="allow")

    mode: str | None = "auto"
    name: str | None = None
    length: int | None = None
    num_tracks: int | None = None
    numTracks: int | None = None
    track_count: int | None = None
    size: int | None = None
    duration_minutes: float | None = None
    playlist_id: str | None = None
    overlap_bars: int = 16
    ramp_bars: int = 16
    genre: str | None = None
    min_bpm: float | None = None
    max_bpm: float | None = None
    seed_track_id: str | int | None = None
    seedTrackId: str | int | None = None
    start_track_id: str | int | None = None
    deck_a_track_id: str | int | None = None
    deckATrackId: str | int | None = None


_SETS: dict[str, dict[str, Any]] = {}  # in-memory; cleared on server restart


# Each set type can only draw on tracks that fit it. Bands are percentiles of the energy of
# the tracks in your library (so they work whatever scale the analyzer used): a Warm Up can
# use the calmest 60% of tracks, Peak Hour the most energetic 60%, and so on. That band
# decides the longest set the type allows.
_MODE_BANDS: dict[str, tuple[int, int]] = {
    "auto": (0, 100), "generate": (0, 100),
    "build_energy": (0, 100), "build": (0, 100),
    "peak_hour": (40, 100), "peak": (40, 100),
    "warm_up": (0, 60), "warmup": (0, 60),
    "afro_house": (0, 100), "afro_house_journey": (0, 100),
    "sunset": (15, 85), "sunset_session": (15, 85),
    "recovery": (0, 45), "recovery_mode": (0, 45),
}
HARD_CAP = 200  # safety limit on one set


def _percentile(sorted_values: list[float], pct: float) -> float:
    if not sorted_values:
        return 0.0
    idx = round(pct / 100 * (len(sorted_values) - 1))
    return sorted_values[max(0, min(len(sorted_values) - 1, idx))]


def _eligible_tracks(mode: str, pool: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The tracks this set type is allowed to use."""
    if mode in ("afro_house", "afro_house_journey"):
        pool = [t for t in pool if "afro" in t["genre"].casefold()]
        if not pool:
            return []
    lo_pct, hi_pct = _MODE_BANDS.get(mode, (0, 100))
    energies = sorted(t["energy"] for t in pool)
    lo, hi = _percentile(energies, lo_pct), _percentile(energies, hi_pct)
    return [t for t in pool if lo <= t["energy"] <= hi]


def _requested_length(req: AISetRequest, pool: list[dict[str, Any]]) -> int | None:
    """What the caller asked for, or None meaning 'as many as the set type allows'."""
    for value in (req.num_tracks, req.numTracks, req.track_count, req.length, req.size):
        if value:
            return int(value)
    if req.duration_minutes and pool:
        # The renderer overlaps tracks, so source duration is not mix duration.
        durations = [t["duration_sec"] for t in pool if t["duration_sec"] > 0]
        bpms = [t["bpm"] for t in pool if t["bpm"] > 0]
        avg_duration = sum(durations) / len(durations) if durations else 240.0
        avg_bpm = sum(bpms) / len(bpms) if bpms else 120.0
        overlap_sec = max(0, int(req.overlap_bars)) * 240.0 / avg_bpm
        effective_track_sec = max(30.0, avg_duration - overlap_sec)
        # A set of N tracks has roughly N-1 overlaps. This is an estimate; the
        # actual rendered duration is returned by the renderer after phrase planning.
        target_sec = max(60.0, req.duration_minutes * 60.0)
        return max(1, round((target_sec - overlap_sec) / effective_track_sec) + 1)
    return None


def _plan_full_set(
    prefix: list[dict[str, Any]],
    pool: list[dict[str, Any]],
    length: int,
    start: float,
    end: float,
) -> list[dict[str, Any]]:
    """Order a set that uses most of the eligible tracks.

    Picking the best-fitting track one slot at a time (the greedy way) leaves the leftovers
    for the end, so a long 'build' would finish with its calmest tracks. Instead, hand the
    tracks to slots by energy first (so the set follows its curve all the way), then smooth
    BPM / key / artist choices inside small windows without breaking that trend.
    """
    slots = list(range(len(prefix), length))
    if not slots or not pool:
        return list(prefix)
    # Targets come from the tracks' own energy ranks (rising or falling, following the mode's
    # curve), because a library rarely has enough peak tracks to fill a fixed 0.3 -> 0.95 ramp.
    energies = sorted(t["energy"] for t in pool)
    ascending = end >= start
    steps = max(len(slots) - 1, 1)
    targets: dict[int, float] = {}
    for i, k in enumerate(slots):
        q = i / steps if ascending else 1 - i / steps
        targets[k] = energies[round(q * (len(energies) - 1))]

    avail = list(pool)
    assigned: dict[int, dict[str, Any]] = {}
    for k in sorted(slots, key=lambda k: targets[k]):
        if not avail:
            break
        pick = min(avail, key=lambda t: abs(t["energy"] - targets[k]))
        avail.remove(pick)
        assigned[k] = pick
    order = [assigned[k] for k in slots if k in assigned]

    window = max(3, min(6, len(order) // 8))
    out = list(prefix)
    for i in range(0, len(order), window):
        left = order[i:i + window]
        while left:
            tgt = targets.get(len(out), end)

            def cost(t: dict[str, Any]) -> float:
                c = abs(t["energy"] - tgt)
                if out:
                    c += 0.8 * (1 - _compat(out[-1], t))
                    if t["artist"] == out[-1]["artist"]:
                        c += 0.6
                return c

            pick = min(left, key=cost)
            left.remove(pick)
            out.append(pick)
    return out


def _build_set(req: AISetRequest) -> dict[str, Any]:
    mode = _norm_mode(req.mode)
    start, end = _SET_CURVES.get(mode, _SET_CURVES["auto"])

    library = _read_library()
    pool = library

    # AI set generation always uses the full analyzed library.
    # Playlists remain available for organizing tracks, but do not constrain AI mixes.

    if req.genre:
        pool = [t for t in pool if t["genre"].casefold() == req.genre.casefold()]
    if req.min_bpm is not None:
        pool = [t for t in pool if t["bpm"] >= req.min_bpm]
    if req.max_bpm is not None:
        pool = [t for t in pool if t["bpm"] <= req.max_bpm]
    if not pool:
        raise HTTPException(status_code=400, detail="No tracks in the selected source match these filters")

    eligible = _eligible_tracks(mode, pool)
    if not eligible:
        raise HTTPException(status_code=400, detail=f"No tracks in the selected source are eligible for mode '{mode}'")
    max_tracks = min(len(eligible), HARD_CAP)
    requested = _requested_length(req, eligible)

    # A mix needs at least two distinct tracks. Keep playlist/genre filtering strict:
    # never silently widen the source or shorten a requested duration to hide a shortage.
    if max_tracks < 2:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Only {max_tracks} track(s) match the active filters. "
                "At least 2 matching tracks are required to generate a mix."
            ),
        )
    if req.duration_minutes and requested and requested > max_tracks:
        source_name = "library"
        raise HTTPException(
            status_code=400,
            detail=(
                f"A {req.duration_minutes:g}-minute mix needs approximately {requested} "
                f"matching tracks, but only {max_tracks} are available in the {source_name} "
                "after genre and mode filters. Add matching tracks or choose a shorter duration."
            ),
        )

    length = max(1, min(requested if requested else max_tracks, max_tracks))

    remaining = list(eligible)
    chosen: list[dict[str, Any]] = []

    seed_id = next(
        (v for v in (req.seed_track_id, req.seedTrackId, req.start_track_id,
                     req.deck_a_track_id, req.deckATrackId) if v is not None),
        None,
    )
    if seed_id is not None:
        first = next((t for t in eligible if t["id"] == str(seed_id)), None)
        if first is None:
            raise HTTPException(
                status_code=400,
                detail="The selected starting track is not in the chosen playlist or does not match the active filters",
            )
        remaining = [t for t in remaining if t["id"] != first["id"]]
        chosen.append(first)

    if length > 0.6 * len(eligible):
        chosen = _plan_full_set(chosen, remaining, length, start, end)
    else:
        while len(chosen) < length and remaining:
            target = start + (end - start) * (len(chosen) / max(length - 1, 1))
            recent_artists = [c["artist"] for c in chosen[-3:]]

            def cost(t: dict[str, Any]) -> float:
                c = abs(t["energy"] - target)
                if chosen:
                    c += 0.8 * (1 - _compat(chosen[-1], t))
                    # Long sets: don't keep coming back to the same artist
                    if t["artist"] == chosen[-1]["artist"]:
                        c += 0.6
                    elif t["artist"] in recent_artists:
                        c += 0.25
                return c

            pick = min(remaining, key=cost)
            remaining.remove(pick)
            chosen.append(pick)

    items: list[dict[str, Any]] = []
    for i, t in enumerate(chosen):
        items.append({
            "deck": "A" if i % 2 == 0 else "B",   # alternate decks like a real mix
            "position": i,
            "track": t,
            "transition_score": round(_compat(chosen[i - 1], t), 3) if i > 0 else None,
            "recommended_transition": _transition_hint(chosen[i - 1], t) if i > 0 else None,
        })

    set_id = uuid.uuid4().hex[:12]
    bpms = [t["bpm"] for t in chosen if t["bpm"]]
    result = {
        "id": set_id,
        "name": req.name or f"{mode.replace('_', ' ').title()} Set",
        "mode": mode,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "track_count": len(items),
        "max_tracks": max_tracks,                 # the longest set this type allows
        "requested_tracks": requested,            # None = "as many as allowed"
        "capped": bool(requested and requested > max_tracks),
        # Estimate final output runtime after the crossfades, rather than adding
        # every source track's full duration. The renderer returns the exact runtime.
        "total_duration_sec": round(
            sum(t["duration_sec"] for t in chosen)
            - sum((240.0 * max(0, int(req.overlap_bars)) / t["bpm"])
                  for t in chosen[1:] if t["bpm"] > 0),
            2,
        ),
        "target_duration_minutes": req.duration_minutes,
        "avg_bpm": round(sum(bpms) / len(bpms), 2) if bpms else 0,
        "energy_curve": [round(t["energy"], 3) for t in chosen],
        "track_ids": [t["id"] for t in chosen],
        "tracks": items,
    }
    _SETS[set_id] = result
    return result


@app.get("/api/ai/modes")
def ai_modes() -> dict[str, int]:
    """How many tracks each set type can use from the current library."""
    library = _read_library()
    return {m: min(len(_eligible_tracks(m, library)), HARD_CAP) for m in _MODE_BANDS}


@app.post("/api/ai/set")
def ai_generate_set(req: AISetRequest) -> dict[str, Any]:
    return _build_set(req)


@app.get("/api/ai/sets")
def ai_list_sets() -> list[dict[str, Any]]:
    return sorted(_SETS.values(), key=lambda s: s["created_at"], reverse=True)


@app.get("/api/ai/sets/{set_id}")
def ai_get_set(set_id: str) -> dict[str, Any]:
    found = _SETS.get(set_id)
    if not found:
        raise HTTPException(status_code=404, detail="Set not found")
    return found


# ---------------------------------------------------------------------------
# Mix rendering. Reuses the existing dj_audio renderer and VirtualDJ track model.
# ---------------------------------------------------------------------------

MIXES_DIR = BASE_DIR / "generated_mixes"
MIXES_DIR.mkdir(parents=True, exist_ok=True)
_MIX_STATUS: dict[str, dict[str, Any]] = {}
_MIX_LOCK = threading.Lock()


class MixRenderRequest(BaseModel):
    set_id: str
    format: str = "mp3"
    quality: str = "high"


def _set_status(mix_id: str, **updates: Any) -> None:
    with _MIX_LOCK:
        current = _MIX_STATUS.setdefault(mix_id, {
            "id": mix_id, "set_id": "", "status": "queued", "progress": 0.0,
        })
        current.update(updates)


def _render_mix_worker(mix_id: str, set_id: str, output_format: str) -> None:
    try:
        set_data = _SETS.get(set_id)
        if not set_data:
            raise ValueError("AI set not found or expired; generate the set again")
        if len(set_data.get("tracks", [])) < 2:
            raise ValueError("A mix needs at least two tracks")

        # Imports are deliberately lazy: the API/library remains browseable even
        # if optional audio-render dependencies have not been installed yet.
        import shutil
        from virtual_dj import Track as AudioTrack, SetEntry, plan_mix_out
        import dj_audio

        if output_format == "mp3" and not shutil.which("ffmpeg"):
            raise RuntimeError("ffmpeg is required to export MP3. Install ffmpeg or request WAV.")

        library = _read_library()
        rng = random.Random(mix_id)
        entries = []
        clock = 0.0
        overlap_bars = 16
        ramp_bars = 16
        for index, item in enumerate(set_data["tracks"]):
            row = item["track"]
            track_id = str(row["id"])
            match = next((t for t in library if t["id"] == track_id), None)
            if match is None:
                raise ValueError(f"Track {track_id} is no longer in library.csv")
            key = str(match.get("key") or "").strip()
            if not re.fullmatch(r"(?:[1-9]|1[0-2])[ABab]", key):
                raise ValueError(f"Track '{match['title']}' has invalid Camelot key {key!r}; re-analyze or fix library.csv")
            audio_path = _find_audio_file(match)
            energy = max(1, min(10, round(match["energy"] * 10)))
            audio_track = AudioTrack(
                title=match["title"], artist=match["artist"], bpm=float(match["bpm"]),
                key=key, energy=energy, genre=match["genre"],
                duration=float(match["duration_sec"]),
                first_downbeat=float(match.get("first_downbeat_sec") or 0.0),
                path=str(audio_path),
            )
            mix_out, phrase_bars = plan_mix_out(audio_track, rng, overlap_bars=overlap_bars)
            entries.append(SetEntry(
                index=index + 1, clock=clock, track=audio_track, decision=None,
                mix_out_in_track=mix_out, phrase_bars=phrase_bars,
            ))
            clock += max(0.0, mix_out - audio_track.first_downbeat)

        output_path = MIXES_DIR / f"{mix_id}.{output_format}"
        _set_status(mix_id, status="rendering", progress=0.1, message="Preparing phrase-aligned transitions")
        rendered = dj_audio.render_mix(
            entries, str(output_path), overlap_bars=overlap_bars, ramp_bars=ramp_bars,
            log=lambda message: None,
        )
        size_mb = output_path.stat().st_size / (1024 * 1024)
        _set_status(
            mix_id, status="complete", progress=1.0,
            download_url=f"/api/mix/{mix_id}/download",
            duration_sec=round(float(rendered["duration_s"]), 2),
            file_size_mb=round(size_mb, 2),
            message="Mix rendered successfully",
            warnings=rendered.get("warnings", []),
            timeline=rendered.get("timeline", []),
            output_format=output_format,
        )
    except Exception as exc:
        _set_status(mix_id, status="error", progress=1.0, message=str(exc))


@app.post("/api/mix/render")
def render_mix(req: MixRenderRequest) -> dict[str, Any]:
    if req.format.lower() not in {"mp3", "wav"}:
        raise HTTPException(status_code=400, detail="format must be mp3 or wav")
    if req.quality.lower() not in {"high", "standard"}:
        raise HTTPException(status_code=400, detail="quality must be high or standard")
    set_data = _SETS.get(req.set_id)
    if not set_data:
        raise HTTPException(status_code=404, detail="AI set not found; generate it again")
    if len(set_data.get("tracks", [])) < 2:
        raise HTTPException(status_code=400, detail="A mix needs at least two tracks")

    mix_id = uuid.uuid4().hex[:12]
    _MIX_STATUS[mix_id] = {
        "id": mix_id, "set_id": req.set_id, "status": "queued", "progress": 0.0,
        "message": "Mix queued for rendering",
    }
    worker = threading.Thread(
        target=_render_mix_worker, args=(mix_id, req.set_id, req.format.lower()), daemon=True,
    )
    worker.start()
    return dict(_MIX_STATUS[mix_id])


@app.get("/api/mix/{mix_id}")
def get_mix_status(mix_id: str) -> dict[str, Any]:
    with _MIX_LOCK:
        status = _MIX_STATUS.get(mix_id)
        if status is None:
            raise HTTPException(status_code=404, detail="Mix not found")
        return dict(status)


@app.get("/api/mix/{mix_id}/download")
def download_mix(mix_id: str) -> FileResponse:
    with _MIX_LOCK:
        status = _MIX_STATUS.get(mix_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Mix not found")
    if status.get("status") != "complete":
        raise HTTPException(status_code=409, detail="Mix is not ready for download")
    ext = status.get("output_format", "mp3")
    path = MIXES_DIR / f"{mix_id}.{ext}"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Rendered mix file is missing")
    media_type = "audio/mpeg" if ext == "mp3" else "audio/wav"
    return FileResponse(path, media_type=media_type, filename=f"NebulaDJ_Mix_{mix_id}.{ext}")

