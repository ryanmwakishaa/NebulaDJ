# Virtual DJ

Plans a DJ set from your music using Camelot-key graph distance, an energy Markov
chain, BPM envelopes and weighted top-3 selection, then renders it as one mixed file.

## Setup

```
bash setup_env.sh            # macOS / Linux
```
Windows: `python -m venv .venv`, `.venv\Scripts\activate`, `pip install -r requirements.txt`.
Install ffmpeg if you use mp3/m4a files.

## Use it

```
python dj_audio.py analyze ./songs                       # BPM, key, energy -> library.csv
python dj_audio.py mix ./songs --tracks 8 --out mix.mp3  # plan + render
python dj_audio.py mix ./songs --tracks 8 --plan-only    # just print the plan
python dj_audio.py mix library.csv --tracks 12 --seed 7 --out mix.wav
```

Useful options for `mix`: `--seed N` (repeatable set; omit for a different one each time),
`--start "title text"`, `--overlap-bars 16`, `--ramp-bars 16`, `--top-k 3`, `--bpm-envelope 6`.

Songs named `Artist - Title.mp3` are labelled automatically (ID3 tags are used if present).
Results are cached in `.dj_cache.json` inside the songs folder, so re-runs are fast.

## Stable track IDs and playlists

The API derives each track ID from its normalized file path, so sorting or inserting rows
in `library.csv` no longer changes IDs. Playlist membership stores these stable IDs in
`nebula_playlists.db`. Existing playlists that still contain numeric row-index IDs are
migrated on the first library read, using the current CSV ordering as the best available
mapping. If the CSV was already reordered before this migration runs, old playlist entries
may have been pointing at the wrong tracks already; review those playlists after upgrading.

Keep song paths consistent when regenerating `library.csv`; changing a track's path changes
its derived ID.

## Fixing analysis mistakes

Automatic detection is good on steady dance music but not perfect (key detection is the
weakest part, typically ~70-80% on real tracks). `analyze` writes `library.csv`; open it,
correct any `bpm`, `key` (Camelot, e.g. 8A) or `first_downbeat` (seconds) that is wrong, and
mix from the CSV: `python dj_audio.py mix library.csv ...`. The `path` column points at each song.
`energy` (1-10) is scaled relative to *your* library and can be edited too.

## How a transition is rendered

1. The new track enters on a 32-bar phrase boundary of the old one (16/8 for short tracks).
2. It is time-stretched (pitch preserved, Rubber Band R3) to the outgoing tempo.
3. For 16 bars the highs crossfade equal-power while the bass swaps at the midpoint.
4. The old track leaves, then the new one eases back to its own tempo over 16 bars.

## Files

- `virtual_dj.py` the planner (also usable alone with a CSV, no audio)
- `dj_audio.py` analysis + rendering
- `test_virtual_dj.py`, `test_dj_audio.py` self-tests
