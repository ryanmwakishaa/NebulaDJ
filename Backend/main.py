import csv
from pathlib import Path
from fastapi.middleware.cors import CORSMiddleware

from fastapi import FastAPI
from fastapi.responses import FileResponse

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Backend folder
BASE_DIR = Path(__file__).parent


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "version": "1.0"
    }


@app.get("/api/tracks")
def get_tracks():

    tracks = []

    with open("library.csv", "r", encoding="utf-8") as f:

        reader = csv.DictReader(f)

        for idx, row in enumerate(reader):
            row["id"] = idx
            tracks.append(row)

    return tracks


@app.get("/api/tracks/genres")
def get_genres():

    tracks = get_tracks()

    genres = sorted(
        {
            t.get("genre", "").strip()
            for t in tracks
            if t.get("genre")
        }
    )

    return genres


@app.get("/api/tracks/keys")
def get_keys():

    tracks = get_tracks()

    keys = sorted(
        {
            t.get("key", "").strip()
            for t in tracks
            if t.get("key")
        }
    )

    return keys


@app.get("/api/tracks/{track_id}")
def get_track(track_id: int):

    tracks = get_tracks()

    if track_id < 0 or track_id >= len(tracks):
        return {"error": "Track not found"}

    return tracks[track_id]


@app.get("/api/tracks/{track_id}/audio")
def get_track_audio(track_id: int):

    tracks = get_tracks()

    if track_id < 0 or track_id >= len(tracks):
        return {"error": "Track not found"}

    return {
        "url": f"http://localhost:8000/api/audio/{track_id}"
    }


@app.get("/api/audio/{track_id}")
def stream_audio(track_id: int):

    tracks = get_tracks()

    if track_id < 0 or track_id >= len(tracks):
        return {"error": "Track not found"}

    # Extract filename from CSV path
    filename = Path(tracks[track_id]["path"]).name

    # Look inside Backend/songs/
    real_path = BASE_DIR / "songs" / filename

    print(f"Streaming: {real_path}")

    if not real_path.exists():
        return {
            "error": f"File not found: {real_path}"
        }

    return FileResponse(
        path=real_path,
        media_type="audio/mpeg",
        filename=filename
    )