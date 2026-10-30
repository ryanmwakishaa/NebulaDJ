#!/usr/bin/env python3
"""
Audio front-end for the virtual DJ.

  analyze  Scan a folder of songs: detect BPM, beat grid + first downbeat,
           musical key (as Camelot), and energy (1-10). Writes library.csv.
  mix      Plan a set with the virtual DJ (virtual_dj.py) and render it to a
           single audio file: tempo-matched, phrase-aligned, with an EQ
           (bass-swap) crossfade, then the incoming track eases back to its
           own tempo.

What the mixer does:
  * Searches phrase-aligned exit and entry cues across the usable sections of both tracks.
  * Scores candidate cue pairs using their normalized per-bar energy profiles.
  * Chooses a transition style from tempo, key and energy compatibility.
  * Optionally layers external risers, sweeps, impacts and scratches from Backend/sfx.
  * Matches loudness per track and applies a look-ahead limiter to the master.

Examples
  python dj_audio.py analyze ./songs
  python dj_audio.py mix ./songs --tracks 8 --seed 7 --out mix.mp3
  python dj_audio.py mix library.csv --tracks 12 --out mix.wav
  python dj_audio.py mix ./songs --tracks 8 --plan-only

Needs: numpy scipy librosa soundfile (pip) and ffmpeg (for mp3/m4a in and out).
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import warnings
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace
from pathlib import Path

import numpy as np

from virtual_dj import Track, VirtualDJ, bpm_distance, load_library, print_set
from transition_planner import choose_transition
from effects_engine import scan_effects, choose_effect, overlay_effect

warnings.filterwarnings("ignore")

SR = 44100            # render sample rate
ASR = 22050           # analysis sample rate
HOP = 512
AUDIO_EXTS = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".aiff", ".aif", ".wma"}
CACHE_NAME = ".dj_cache.json"
CACHE_VERSION = 3
STRUCT_CACHE_NAME = ".dj_structure.json"
STRUCT_VERSION = 2
XF_H = int(0.010 * SR)      # half-width of the splice crossfade between stretched chunks
PAD = int(1.0 * SR)         # context fed to the phase vocoder around each chunk
MIN_RATE, MAX_RATE = 0.85, 1.18
TARGET_DB = -15.0           # per-track loudness target (gated RMS, dBFS)
LIMIT_CEILING = 0.97        # master limiter ceiling (linear)
ANALYSIS_SECONDS = 180      # how much of each track the beat/key analysis looks at


# ==========================================================================
# Loading
# ==========================================================================
def to_stereo(y: np.ndarray) -> np.ndarray:
    if y.ndim == 1:
        y = np.stack([y, y])
    elif y.shape[0] == 1:
        y = np.concatenate([y, y])
    elif y.shape[0] > 2:
        y = y[:2]
    return np.ascontiguousarray(y, dtype=np.float32)


def load_audio(path: str, sr: int, mono: bool) -> np.ndarray:
    import librosa
    try:
        y, _ = librosa.load(path, sr=sr, mono=mono)
        return y
    except Exception:
        if not shutil.which("ffmpeg"):
            raise
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.close()
        try:
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path,
                            "-ar", str(sr), "-ac", "1" if mono else "2", tmp.name], check=True)
            y, _ = librosa.load(tmp.name, sr=sr, mono=mono)
            return y
        finally:
            os.unlink(tmp.name)


def read_tags(path: str) -> dict:
    if not shutil.which("ffprobe"):
        return {}
    try:
        out = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json",
                              "-show_entries", "format_tags", "-i", path],
                             capture_output=True, text=True, timeout=30).stdout
        tags = json.loads(out).get("format", {}).get("tags", {})
        return {k.lower(): str(v) for k, v in tags.items()}
    except Exception:
        return {}


def _true_duration(path: str):
    """Real length of the file in seconds, without decoding it fully when possible."""
    try:
        import librosa
        try:
            return float(librosa.get_duration(path=path))
        except TypeError:                       # older librosa
            return float(librosa.get_duration(filename=path))
    except Exception:
        return None


# ==========================================================================
# Analysis
# ==========================================================================
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def camelot(pc: int, minor: bool) -> str:
    """Pitch class (C=0) + mode -> Camelot code. C major = 8B, A minor = 8A."""
    major_pc = (pc + 3) % 12 if minor else pc
    number = ((major_pc * 7) % 12 + 7) % 12 + 1
    return f"{number}{'A' if minor else 'B'}"


def detect_key(chroma_mean: np.ndarray) -> tuple[str, float]:
    scores = []
    for pc in range(12):
        scores.append((float(np.corrcoef(np.roll(MAJOR, pc), chroma_mean)[0, 1]), pc, False))
        scores.append((float(np.corrcoef(np.roll(MINOR, pc), chroma_mean)[0, 1]), pc, True))
    scores.sort(reverse=True)
    return camelot(scores[0][1], scores[0][2]), scores[0][0] - scores[1][0]


def fit_grid(beat_times: np.ndarray, tempo: float) -> tuple[float, float]:
    """Robust linear fit beat_time = offset + index * period."""
    period0 = 60.0 / tempo
    idx = np.round((beat_times - beat_times[0]) / period0)
    coef = np.polyfit(idx, beat_times, 1)
    for _ in range(3):
        resid = beat_times - np.polyval(coef, idx)
        keep = np.abs(resid) < 0.04
        if keep.sum() < max(8, 0.3 * len(idx)):
            break
        coef = np.polyfit(idx[keep], beat_times[keep], 1)
    return float(coef[0]), float(coef[1])


def fine_onset_env(y: np.ndarray, sr: int, frame: int = 256, hop: int = 64):
    """Sharp amplitude-rise envelope (~3 ms resolution) and its frame times."""
    import librosa
    e = np.sqrt((librosa.util.frame(y, frame_length=frame, hop_length=hop) ** 2).sum(axis=0))
    env = np.maximum(0.0, np.diff(e, prepend=e[0]))
    times = (np.arange(len(env)) * hop + frame / 2) / sr
    return env, times


def refine_grid(y_perc: np.ndarray, bpm0: float, span: float = 0.04, nbins: int = 160):
    """Fold the onset envelope over many candidate tempos; the sharpest phase
    histogram gives the true tempo and where the beats fall. Returns (period, offset)."""
    env, t = fine_onset_env(y_perc, ASR)
    best = (-1.0, bpm0, 0, None)
    for bpm in np.linspace(bpm0 * (1 - span), bpm0 * (1 + span), 321):
        period = 60.0 / bpm
        bins = ((t % period) / period * nbins).astype(int) % nbins
        hist = np.bincount(bins, weights=env, minlength=nbins)
        sm = hist + np.roll(hist, 1) + np.roll(hist, -1)
        j = int(np.argmax(sm))
        if sm[j] > best[0]:
            best = (float(sm[j]), float(bpm), j, hist)
    _, bpm, j, hist = best
    period = 60.0 / bpm
    lo, mid, hi = hist[(j - 1) % nbins], hist[j], hist[(j + 1) % nbins]
    frac = (hi - lo) / (lo + mid + hi + 1e-12)       # centroid shift inside the peak
    off = ((j + 0.5 + frac) / nbins) * period
    return period, float(off)


def analyze_file(path: str) -> dict:
    import librosa
    print("loading audio")
    y = load_audio(path, ASR, mono=True)

    print("audio loaded")
    # Remember the TRUE length: the beat/key analysis below only looks at the first
    # ANALYSIS_SECONDS, but the library must store the real duration of the track.
    full_duration = len(y) / ASR
    y = y[: int(ASR * ANALYSIS_SECONDS)]
    if y.ndim > 1:
        y = y.mean(0)
    duration = len(y) / ASR          # length of the analysis window
    if duration < 20:
        raise ValueError("track is shorter than 20 seconds")

    print("running hpss")
    y_h, y_p = librosa.effects.hpss(y)
    print("hpss done")

    onset_p = librosa.onset.onset_strength(y=y_p, sr=ASR, hop_length=HOP)
    print("onset done")
    onset_full = librosa.onset.onset_strength(y=y, sr=ASR, hop_length=HOP)
    print("starting beat tracking")
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset_p, sr=ASR, hop_length=HOP,
                                           start_bpm=120.0, tightness=100)
    print("beat tracking done")
    tempo = float(np.atleast_1d(tempo)[0])
    beat_times = librosa.frames_to_time(beats, sr=ASR, hop_length=HOP)
    if len(beat_times) < 8:
        raise ValueError("could not find a steady beat")

    bpm0 = tempo
    while bpm0 < 78:
        bpm0 *= 2
    while bpm0 >= 160:
        bpm0 /= 2
    period, off = refine_grid(y_p, bpm0)

    # Strict harmonic separation keeps kick sweeps and snares out of the key estimate.
    y_key = librosa.effects.harmonic(y, margin=4.0)
    tuning = librosa.estimate_tuning(y=y_key, sr=ASR)
    chroma = librosa.feature.chroma_cqt(y=y_key, sr=ASR, tuning=tuning, hop_length=HOP,
                                        fmin=librosa.note_to_hz("C2"), n_octaves=6)

    # Downbeat phase (which of the 4 beats starts the bar). Backbeat snares/claps hit on
    # 2 and 4, so use cues they don't affect: bass/kick level and chord-change novelty.
    from scipy.signal import butter, sosfiltfilt
    k0 = int(math.ceil(-off / period))
    ks = np.arange(k0, int((duration - off) / period) - 1)
    gt = off + ks * period
    low = np.abs(sosfiltfilt(butter(4, 150, "low", fs=ASR, output="sos"), y))
    blk = 64
    low_env = low[: len(low) // blk * blk].reshape(-1, blk).max(axis=1)
    lvl = np.array([low_env[max(0, int((g - 0.01) * ASR / blk)): int((g + 0.12) * ASR / blk) + 1].max()
                    for g in gt])
    nov = np.zeros(len(gt))
    span = max(3, int(round(period * ASR / HOP)))
    for n_i, g in enumerate(gt):
        c = int(round(g * ASR / HOP))
        if c - span >= 0 and c + span < chroma.shape[1]:
            a_ = chroma[:, c - span: c - 1].mean(axis=1)
            b_ = chroma[:, c + 1: c + span].mean(axis=1)
            nov[n_i] = 1 - float(a_ @ b_ / (np.linalg.norm(a_) * np.linalg.norm(b_) + 1e-9))

    def contrast(v):
        per = np.array([v[ks % 4 == p].mean() if np.any(ks % 4 == p) else 0.0 for p in range(4)])
        return np.clip((per - per.mean()) / (per.mean() + 1e-9), -1, 1)

    ph = int(np.argmax(contrast(lvl) + 0.5 * contrast(nov)))

    # Phrase grid starts at the first full bar where the music really begins.
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    thr = 0.1 * np.percentile(rms, 95)
    t_start = float(np.argmax(rms > thr)) * HOP / ASR
    m = math.ceil(((t_start - 0.15) - (off + ph * period)) / (4 * period))
    f = off + (ph + 4 * m) * period
    if -0.03 < f < 0:
        f = 0.0                      # a downbeat a few ms before the start is the start
    elif f < 0:
        f += 4 * period * math.ceil(-f / (4 * period))

    key, conf = detect_key(chroma.mean(axis=1))

    cent = librosa.feature.spectral_centroid(y=y, sr=ASR, hop_length=HOP)[0]
    rms_db = 20 * math.log10(float(np.sqrt(np.mean(y ** 2))) + 1e-9)

    tags = read_tags(path)
    stem = Path(path).stem
    stem = stem.lstrip("0123456789 ._-") or stem
    if " - " in stem:
        f_artist, f_title = stem.split(" - ", 1)
    else:
        f_artist, f_title = "Unknown", stem
    return {
        "bpm": round(60.0 / period, 3),
        "first_downbeat": round(f, 4),
        "key": key,
        "key_conf": round(conf, 3),
        "duration": round(full_duration, 2),
        "rms_db": rms_db,
        "centroid": float(cent.mean()),
        "onset": float(onset_full.mean()),
        "title": tags.get("title") or f_title.strip(),
        "artist": tags.get("artist") or f_artist.strip(),
        "genre": (tags.get("genre") or "unknown").strip().lower(),
    }


def _analyze_worker(path: str):
    try:
        return path, analyze_file(path)
    except Exception as exc:  # keep one bad file from stopping the batch
        return path, {"error": f"{type(exc).__name__}: {exc}"}


def collect_files(folder: str) -> list[str]:
    files = []
    for root, _, names in os.walk(folder):
        for n in names:
            if Path(n).suffix.lower() in AUDIO_EXTS and not n.startswith("."):
                files.append(os.path.join(root, n))
    return sorted(files)


def _cache_key(path: str) -> str:
    st = os.stat(path)
    return f"{os.path.abspath(path)}|{st.st_size}|{int(st.st_mtime)}"


def analyze_folder(folder: str, workers: int | None = None, log=print) -> list[tuple[str, dict]]:
    files = collect_files(folder)
    if not files:
        raise SystemExit(f"No audio files found in {folder}")
    cache_path = Path(folder) / CACHE_NAME
    cache = {"version": CACHE_VERSION, "items": {}}
    try:
        loaded = json.loads(cache_path.read_text())
        if loaded.get("version") == CACHE_VERSION:
            cache = loaded
    except Exception:
        pass

    results: dict[str, dict] = {}
    todo = []
    for p in files:
        info = cache["items"].get(_cache_key(p))
        if info:
            # Older analyses stored the length of the 180 s analysis window as the track's
            # duration. Repair those cheaply (no re-analysis needed).
            if info.get("duration", 0) <= ANALYSIS_SECONDS + 0.5:
                real = _true_duration(p)
                if real and real > info["duration"] + 1:
                    info = {**info, "duration": round(real, 2)}
                    cache["items"][_cache_key(p)] = info
            results[p] = info
        else:
            todo.append(p)

    if todo:
        log(f"Analyzing {len(todo)} file(s) ({len(files) - len(todo)} cached)...")

    for n, p in enumerate(todo, 1):
        print(f"Processing {p}")

        try:
            path, info = _analyze_worker(p)

            if "error" in info:
                print(f"[{n}/{len(todo)}] ERROR: {info['error']}")
                continue

            print(f"[{n}/{len(todo)}] OK: {Path(path).name}")
            results[path] = info
            cache["items"][_cache_key(path)] = info

        except Exception as e:
            print(f"[{n}/{len(todo)}] FAILED: {e}")
            raise

    try:
        cache_path.write_text(json.dumps(cache))
    except OSError:
        pass

    return [(p, results[p]) for p in files if p in results]


def build_tracks(infos: list[tuple[str, dict]]) -> list[Track]:
    """Turn raw features into Track objects; energy is scaled within this library."""
    n = len(infos)
    feats = np.array([[i["rms_db"], i["centroid"], i["onset"]] for _, i in infos])
    if n >= 2:
        z = (feats - feats.mean(0)) / (feats.std(0) + 1e-9)
        comp = z @ np.array([0.4, 0.25, 0.35])
    else:
        comp = np.zeros(n)
    energy = np.clip(np.round(5.5 + 2.0 * comp), 1, 10).astype(int)

    seen: dict[str, int] = {}
    tracks = []
    for (path, info), e in zip(infos, energy):
        title = info["title"]
        seen[title] = seen.get(title, 0) + 1
        if seen[title] > 1:
            title = f"{title} ({seen[title]})"
        tracks.append(Track(title=title, artist=info["artist"], bpm=info["bpm"], key=info["key"],
                            energy=int(e), genre=info["genre"], duration=info["duration"],
                            first_downbeat=info["first_downbeat"], path=os.path.abspath(path)))
    return tracks


def write_library_csv(tracks: list[Track], path: str):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["title", "artist", "bpm", "key", "energy", "genre", "duration",
                    "first_downbeat", "path"])
        for t in tracks:
            w.writerow([t.title, t.artist, t.bpm, t.key, t.energy, t.genre, t.duration,
                        t.first_downbeat, t.path])


# ==========================================================================
# Track structure (intro / body / outro) from per-bar energy
# ==========================================================================
def structure_from_audio(y: np.ndarray, sr: int, bpm: float, first_downbeat: float,
                         run: int = 4, level: float = 0.75):
    """Find where a track 'kicks in' and where its outro starts, in bars from the first downbeat.

    Per-bar energy = half full-band RMS, half bass RMS (both relative to the track's own
    90th percentile). A bar is 'active' when it reaches `level` of the track's typical
    body energy. The intro ends where `run` active bars in a row begin; the outro starts
    after the last such run.

    Returns dict(nb, intro_bars, outro_start, outro_bars, body) or None if the track has no
    usable structure (too short, silent, or no steady body section).
    """
    from scipy.signal import butter, sosfiltfilt
    if bpm <= 0 or len(y) < sr * 20:
        return None
    bar = 240.0 / bpm
    nb_all = int((len(y) / sr - first_downbeat) // bar)
    if nb_all < 16:
        return None

    edges = np.clip(((first_downbeat + np.arange(nb_all + 1) * bar) * sr).astype(int), 0, len(y))
    low = sosfiltfilt(butter(4, 150, "low", fs=sr, output="sos"), y).astype(np.float32)

    def per_bar(x):
        return np.array([float(np.sqrt(np.mean(x[a:b] ** 2))) if b > a else 0.0
                         for a, b in zip(edges[:-1], edges[1:])])

    rms, lo = per_bar(y), per_bar(low)
    p90r, p90l = np.percentile(rms, 90) + 1e-9, np.percentile(lo, 90) + 1e-9

    loud = np.where(rms > 0.03 * p90r)[0]          # ignore trailing silence
    if loud.size == 0:
        return None
    nb = int(loud[-1]) + 1
    if nb < 16:
        return None

    e = 0.5 * rms / p90r + 0.5 * lo / p90l
    body = float(np.median(e[nb // 4: (3 * nb) // 4]))
    if body <= 0:
        return None
    active = e[:nb] >= level * body

    intro = next((k for k in range(0, nb - run + 1) if active[k:k + run].all()), None)
    last = next((k for k in range(nb - 1, run - 2, -1) if active[k - run + 1:k + 1].all()), None)
    if intro is None or last is None or last < intro:
        return None
    # Keep a normalized per-bar energy curve so transitions can be searched
    # across the full usable track, not just at the outro.
    profile = np.clip(e[:nb] / (body + 1e-9), 0.0, 2.5)
    return {"nb": nb, "intro_bars": int(intro), "outro_start": int(last) + 1,
            "outro_bars": int(nb - last - 1), "body": round(body, 3),
            "bar_energy": np.round(profile, 3).tolist()}


def _struct_key(track: Track) -> str:
    return f"{_cache_key(track.path)}|{round(track.bpm, 3)}|{round(track.first_downbeat, 4)}|v{STRUCT_VERSION}"


def track_structure(track: Track, log=print):
    """structure_from_audio() for a track, cached in a .dj_structure.json next to the songs."""
    if not track.path or not os.path.exists(track.path):
        return None
    cache_path = Path(track.path).parent / STRUCT_CACHE_NAME
    cache = {}
    try:
        cache = json.loads(cache_path.read_text())
    except Exception:
        pass
    key = _struct_key(track)
    if key in cache:
        return cache[key]
    try:
        y = load_audio(track.path, ASR, mono=True)
        st = structure_from_audio(y, ASR, track.bpm, track.first_downbeat)
    except Exception as exc:
        log(f"  (could not analyse structure of '{track.title}': {exc})")
        st = None
    cache[key] = st
    try:
        cache_path.write_text(json.dumps(cache))
    except OSError:
        pass
    return st


def _camelot_parts(key: str):
    m = re.fullmatch(r"\s*(\d{1,2})\s*([ABab])\s*", key or "")
    return (int(m.group(1)), m.group(2).upper()) if m else None


def keys_compatible(a: str, b: str) -> bool:
    """Same key, +/-1 on the Camelot wheel, or relative major/minor. Unknown keys count as fine."""
    ca, cb = _camelot_parts(a), _camelot_parts(b)
    if not ca or not cb:
        return True
    if ca[0] == cb[0]:
        return True
    if ca[1] == cb[1]:
        diff = min((ca[0] - cb[0]) % 12, (cb[0] - ca[0]) % 12)
        return diff <= 1
    return False


def _clock_label(seconds: float) -> str:
    seconds = max(0, int(round(seconds)))
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def refine_transitions(entries, overlap_bars: int, fx: bool = True, log=print):
    """Choose phrase-aligned exit AND entry cues across each pair of full tracks.

    The search is not restricted to the outgoing outro or incoming intro. It evaluates
    matching per-bar energy windows across the usable audio in both tracks. Key and tempo
    compatibility select a transition style and overlap length; transition_planner scores
    candidate cue pairs. Returns (mix_out_times, overlaps, styles, entry_cue_times).
    """
    n = len(entries)
    log("Analysing full-track structure for transition candidates...")
    structs = [track_structure(e.track, log) for e in entries]

    mix_out: list = [None] * n
    overlaps = [overlap_bars] * max(0, n - 1)
    styles = ["blend"] * max(0, n - 1)
    entry_cues = [e.track.first_downbeat for e in entries]
    entry_bars = [0] * n
    previous_in_overlap = 0

    for i in range(n - 1):
        t, nx = entries[i].track, entries[i + 1].track
        bar_out = 240.0 / t.bpm
        bar_in = 240.0 / nx.bpm
        st, sn = structs[i], structs[i + 1]
        current_entry_bar = entry_bars[i]

        minimum_out_bar = current_entry_bar + previous_in_overlap + 8
        k_plan = max(
            minimum_out_bar,
            int(round((entries[i].mix_out_in_track - t.first_downbeat) / bar_out)),
        )

        _, ratio = bpm_distance(t.bpm, nx.bpm)
        ratio = ratio or 1.0
        keys_ok = keys_compatible(t.key, nx.key)
        required_rate = t.bpm / (nx.bpm * ratio)
        tempo_ok = MIN_RATE <= required_rate <= MAX_RATE
        energy_gap = nx.energy - t.energy

        # Choose the transition treatment before searching, so both cues have
        # enough source audio for the selected overlap.
        reasons = []
        if not fx:
            style = "blend"
            ov = min(max(4, overlap_bars), 16)
        elif not keys_ok or not tempo_ok:
            style = "echo"
            ov = 4
            if not keys_ok:
                reasons.append("key mismatch")
            if not tempo_ok:
                reasons.append("tempo mismatch")
        elif energy_gap >= 2:
            style = "filter"
            ov = min(max(4, overlap_bars), 8)
            reasons.append(f"energy lift +{energy_gap}")
        else:
            style = "blend"
            ov = min(max(4, overlap_bars), 16)

        choice = None
        if (st and sn and st.get("bar_energy") and sn.get("bar_energy")):
            choice = choose_transition(
                st["bar_energy"],
                sn["bar_energy"],
                minimum_out_bar=minimum_out_bar,
                minimum_in_bar=0,
                overlap_bars=ov,
                preferred_out_bar=k_plan,
                stride_bars=4,
            )

        if choice is not None:
            k, j = choice.out_bar, choice.in_bar
            ov = choice.overlap_bars
            why = f"full-track search score {choice.score:.3f}"
        else:
            # Graceful fallback for files whose structure analysis is unavailable.
            # Never move the exit back before the incoming cue or its play window.
            k = int(math.ceil(minimum_out_bar / 4)) * 4
            j = 0
            if st:
                max_out = ((st["nb"] - ov) // 4) * 4
                if max_out < minimum_out_bar:
                    ov = 4
                    max_out = ((st["nb"] - ov) // 4) * 4
                if max_out < minimum_out_bar:
                    raise ValueError(
                        f"Not enough usable audio left in '{t.title}' for a transition "
                        f"after its selected entry cue."
                    )
                k = min(k, max_out)
            why = "fallback: insufficient structure data"

        out_time = t.first_downbeat + k * bar_out
        in_time = nx.first_downbeat + j * bar_in
        mix_out[i] = out_time
        entry_cues[i + 1] = in_time
        entry_bars[i + 1] = j
        overlaps[i], styles[i] = ov, style
        previous_in_overlap = max(1, int(round(ov / ratio)))

        suffix = f" [{', '.join(reasons)}]" if reasons else ""
        log(
            f"  {i + 1}->{i + 2}: OUT {_clock_label(out_time)} (bar {k}) "
            f"-> IN {_clock_label(in_time)} (bar {j}); "
            f"{style} over {ov} bars; {why}{suffix}"
        )

    return mix_out, overlaps, styles, entry_cues

# ==========================================================================
# Rendering
# ==========================================================================
def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def take(y: np.ndarray, i: int, j: int) -> np.ndarray:
    """y[:, i:j] with zero padding outside the signal."""
    n = y.shape[1]
    out = np.zeros((y.shape[0], j - i), np.float32)
    lo, hi = max(i, 0), min(j, n)
    if hi > lo:
        out[:, lo - i: hi - i] = y[:, lo:hi]
    return out


_RB_STATE = {"mod": None, "warned": False}


def _rubberband():
    if _RB_STATE["mod"] is None:
        try:
            import pylibrb
            try:
                pylibrb.set_default_logging_level(0)
            except Exception:
                pass
            _RB_STATE["mod"] = pylibrb
        except Exception:
            _RB_STATE["mod"] = False
    return _RB_STATE["mod"]


def stretch_audio(seg: np.ndarray, rate: float, block: int = 16384) -> np.ndarray:
    """Time-stretch stereo audio (2, n) by `rate` (>1 = faster/shorter) keeping pitch.
    Uses Rubber Band R3, which preserves kick/snare transients; falls back to librosa's
    phase vocoder (audible pre/post-echo on drums) if pylibrb is not installed."""
    rb_mod = _rubberband()
    if not rb_mod:
        if not _RB_STATE["warned"]:
            print("WARNING: pylibrb not installed (pip install pylibrb); using the lower-quality "
                  "fallback stretch, drums may sound smeared.")
            _RB_STATE["warned"] = True
        import librosa
        return librosa.effects.time_stretch(seg, rate=rate)
    from pylibrb import Option, RubberBandStretcher
    n = seg.shape[1]
    x = np.ascontiguousarray(seg, dtype=np.float32)
    rb = RubberBandStretcher(SR, 2, Option.PROCESS_OFFLINE | Option.ENGINE_FINER, 1.0 / rate)
    rb.set_max_process_size(block)
    rb.set_expected_input_duration(n)
    for i in range(0, n, block):
        rb.study(np.ascontiguousarray(x[:, i: i + block]), final=(i + block >= n))
    out = []
    for i in range(0, n, block):
        rb.process(np.ascontiguousarray(x[:, i: i + block]), final=(i + block >= n))
        while rb.available() > 0:
            out.append(rb.retrieve(rb.available()))
    while rb.available() > 0:
        out.append(rb.retrieve(rb.available()))
    return np.concatenate(out, axis=1) if out else np.zeros((2, 0), np.float32)


def render_chunk(y, a, b, rate, h=XF_H, pad=PAD) -> np.ndarray:
    """Native samples [a, b) played at `rate` (>1 = faster), with h context samples each side."""
    length = int(round((b - a) / rate))
    if abs(rate - 1.0) < 5e-4:
        return take(y, a - h, a + length + h)
    seg = take(y, a - pad, b + pad)
    st = stretch_audio(seg, rate)
    s = int(round((pad - h) / rate))
    out = st[:, s: s + length + 2 * h]
    if out.shape[1] < length + 2 * h:
        out = np.pad(out, ((0, 0), (0, length + 2 * h - out.shape[1])))
    return out.astype(np.float32)


def build_track(y, segs, h=XF_H):
    """segs: [(a, b, rate)] consecutive native-sample chunks -> (audio, offsets).
    offsets[j] is where chunk j starts in the returned audio."""
    lens = [int(round((b - a) / r)) for a, b, r in segs]
    offs = [0]
    for ln in lens:
        offs.append(offs[-1] + ln)
    total = offs[-1]
    out = np.zeros((2, total + 2 * h), np.float32)
    fade_in = np.linspace(0, 1, 2 * h, dtype=np.float32)
    fade_out = fade_in[::-1]
    for k, (a, b, r) in enumerate(segs):
        ch = render_chunk(y, a, b, r, h)
        w = np.ones(lens[k] + 2 * h, np.float32)
        if k > 0:
            w[: 2 * h] = fade_in
        if k < len(segs) - 1:
            w[-2 * h:] = fade_out
        out[:, offs[k]: offs[k] + lens[k] + 2 * h] += ch * w
    return out[:, h: h + total], offs


def eq_blend(seg: np.ndarray, direction: str, bar_samples: int) -> np.ndarray:
    """Equal-power crossfade on the highs; the bass swaps over ~2 bars at the midpoint."""
    from scipy.signal import butter, sosfiltfilt
    n = seg.shape[1]
    if n < 64:
        return seg * (0.0 if direction == "out" else 1.0)
    sos = butter(4, 200, "low", fs=SR, output="sos")
    low = sosfiltfilt(sos, seg, axis=1).astype(np.float32)
    high = seg - low
    x = np.linspace(0, 1, n, dtype=np.float32)
    w = float(np.clip(2 * bar_samples / n, 0.05, 0.5))
    lo_in = smoothstep((x - (0.5 - w / 2)) / w)
    if direction == "in":
        return high * np.sin(x * np.pi / 2) + low * lo_in
    return high * np.cos(x * np.pi / 2) + low * (1 - lo_in)


def echo_transition(out_seg: np.ndarray, in_seg: np.ndarray, beat_samples: int,
                    taps: int = 6, feedback: float = 0.55):
    """Echo-out: the incoming track drops in clean on the phrase while the outgoing track
    loses its bass at once, thins out, and trails off in beat-length echoes.

    Returns (mixed, tail): `mixed` replaces the overlap region; `tail` (2, taps*beat) is
    echo that rings on past the overlap and must be added to the audio that follows.
    """
    from scipy.signal import butter, sosfiltfilt
    n = out_seg.shape[1]
    d = max(1, int(beat_samples))
    if n < 64:
        return in_seg.copy(), np.zeros((2, d * taps), np.float32)
    hp = sosfiltfilt(butter(4, 220, "high", fs=SR, output="sos"), out_seg, axis=1).astype(np.float32)
    x = np.linspace(0, 1, n, dtype=np.float32)
    dry_env = 1.0 - smoothstep((x - 0.05) / 0.35)                       # outgoing fades out fast
    feed = hp * (smoothstep(x / 0.15) * (1.0 - smoothstep((x - 0.55) / 0.35)))  # what feeds the echo
    wet = np.zeros((2, n + d * taps), np.float32)
    for k in range(1, taps + 1):
        wet[:, k * d: k * d + n] += (feedback ** k) * feed
    mixed = in_seg + hp * dry_env + 0.9 * wet[:, :n]
    return mixed.astype(np.float32), (0.9 * wet[:, n:]).astype(np.float32)


def filter_transition(out_seg: np.ndarray, in_seg: np.ndarray) -> np.ndarray:
    """Filtered handoff: progressively remove outgoing low end and highs as the
    incoming track rises. This is distinct from the full EQ blend."""
    from scipy.signal import butter, sosfiltfilt

    n = min(out_seg.shape[1], in_seg.shape[1])
    if n < 128:
        return in_seg[:, :n].copy()
    outgoing = out_seg[:, :n]
    incoming = in_seg[:, :n]
    low = sosfiltfilt(
        butter(4, 180, "low", fs=SR, output="sos"), outgoing, axis=1
    ).astype(np.float32)
    mid_high = outgoing - low
    x = np.linspace(0.0, 1.0, n, dtype=np.float32)
    out_gain = np.cos(x * np.pi / 2)
    low_gain = 1.0 - smoothstep((x - 0.15) / 0.65)
    in_gain = np.sin(x * np.pi / 2)
    return (
        incoming * in_gain
        + mid_high * out_gain
        + low * out_gain * low_gain
    ).astype(np.float32)


def loudness_gain(y: np.ndarray, target_db: float = TARGET_DB) -> float:
    """Gain that brings the track's *gated* RMS to target_db. Quiet intros/outros and
    breakdowns are ignored, so a track with a long soft intro isn't turned up too far."""
    mono = y.mean(axis=0) if y.ndim > 1 else y
    w = int(0.4 * SR)
    n = len(mono) // w
    if n >= 4:
        p = (mono[: n * w].reshape(n, w) ** 2).mean(axis=1)
        sel = p[p > 0.1 * p.mean()]
        power = float(sel.mean()) if sel.size else float(p.mean())
    else:
        power = float(np.mean(mono ** 2))
    rms_db = 10 * math.log10(power + 1e-12)
    return 10 ** (float(np.clip(target_db - rms_db, -12, 12)) / 20)


def limit_file(src_wav: str, dst_wav: str, ceiling: float = LIMIT_CEILING, look_ms: float = 8.0):
    """Look-ahead peak limiter, streamed in blocks. Gain only dips around the peaks that need it
    (smooth ramps of `look_ms` either side), instead of turning the whole mix down for one peak.
    Returns peak before limiting, the constant pre-gain applied, and the deepest reduction in dB."""
    import soundfile as sf
    from scipy.ndimage import minimum_filter1d, uniform_filter1d

    look = max(1, int(look_ms / 1000 * SR))
    size = 2 * look + 1
    margin = 2 * look + 1
    blk = SR * 10

    # Pass 1: the overall peak, so one huge overlap spike can't force deep limiting
    peak = 0.0
    with sf.SoundFile(src_wav) as rd:
        for block in rd.blocks(blocksize=blk, dtype="float32"):
            peak = max(peak, float(np.abs(block).max()))
    pre = min(1.0, 1.5 / peak) if peak > 0 else 1.0

    deepest = 1.0
    with sf.SoundFile(src_wav) as rd, sf.SoundFile(dst_wav, "w", samplerate=SR, channels=2,
                                                   subtype="FLOAT") as wr:
        total = len(rd)
        pos = 0
        while pos < total:
            end = min(total, pos + blk)
            lo, hi = max(0, pos - margin), min(total, end + margin)
            rd.seek(lo)
            x = rd.read(hi - lo, dtype="float32", always_2d=True) * pre
            need = np.minimum(1.0, ceiling / (np.abs(x).max(axis=1) + 1e-9))
            g = uniform_filter1d(minimum_filter1d(need, size=size, mode="nearest"), size=size, mode="nearest")
            seg = slice(pos - lo, end - lo)
            wr.write((x[seg] * g[seg, None]).astype(np.float32))
            deepest = min(deepest, float(g[seg].min()))
            pos = end
    return {"peak": peak, "pre_gain": pre, "max_reduction_db": -20 * math.log10(max(deepest, 1e-6))}


def plain_transitions(entries, overlap_bars):
    n = len(entries)
    return ([None if i == n - 1 else entries[i].mix_out_in_track for i in range(n)],
            [overlap_bars] * max(0, n - 1), ["blend"] * max(0, n - 1))


def render_mix(entries, out_path: str, overlap_bars: int = 16, ramp_bars: int = 16, log=print,
               refine: bool = True, fx: bool = True, target_db: float = TARGET_DB,
               sfx_dir: str | None = None, sfx_chance: float = 0.35) -> dict:
    import soundfile as sf
    n = len(entries)
    if refine and n > 1:
        mix_out, ovs, styles, entry_cues = refine_transitions(
            entries, overlap_bars, fx=fx, log=log
        )
    else:
        mix_out, ovs, styles = plain_transitions(entries, overlap_bars)
        entry_cues = [e.track.first_downbeat for e in entries]

    if not 0.0 <= sfx_chance <= 1.0:
        raise ValueError("sfx_chance must be between 0 and 1")
    effects_dir = sfx_dir if sfx_dir is not None else Path(__file__).resolve().parent / "sfx"
    sfx_bank = scan_effects(effects_dir)
    sfx_cache = {}
    effect_count = sum(len(paths) for paths in sfx_bank.values())
    if effect_count:
        log(f"Loaded {effect_count} external effect(s) from {effects_dir}")

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    lim = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    lim.close()
    timeline = []
    warnings_out = []
    try:
        with sf.SoundFile(tmp.name, "w", samplerate=SR, channels=2, subtype="FLOAT") as out:
            cur = None
            prev = None
            base = 0          # output sample where cur[:, 0] sits
            p_out = None      # playing tempo of the outgoing track at its mix point
            for i, e in enumerate(entries):
                t = e.track
                log(f"[{i + 1}/{n}] {t.title} - {t.artist}")
                if not t.path or not os.path.exists(t.path):
                    raise FileNotFoundError(f"audio file missing for '{t.title}': {t.path!r}")
                y = to_stereo(load_audio(t.path, SR, mono=False))
                y *= loudness_gain(y, target_db)
                is_first, is_last = i == 0, i == n - 1
                # Later tracks may enter at a cue point selected from anywhere in the source.
                f = t.first_downbeat if is_first else entry_cues[i]
                bar = 240.0 / t.bpm
                kM = None if is_last else max(1, int(round((mix_out[i] - f) / bar)))
                ov_out = None if is_last else ovs[i]          # blend length leaving this track
                ov_in = None if is_first else ovs[i - 1]      # blend length entering this track

                if is_first:
                    ratio, r0, nL, nR = 1.0, 1.0, 0, 0
                else:
                    ratio = bpm_distance(p_out, t.bpm)[1]
                    r0 = p_out / (t.bpm * ratio)
                    if not MIN_RATE <= r0 <= MAX_RATE and styles[i - 1] == "echo":
                        # Tempo gap too big to match: echo the old track out and let the new
                        # one drop in at its own tempo, like a DJ would. No stretching.
                        r0 = 1.0
                    elif not MIN_RATE <= r0 <= MAX_RATE:
                        warnings_out.append(f"'{t.title}': needs {100 * (r0 - 1):+.1f}% tempo change, "
                                            "clamped (transition will not be perfectly matched)")
                        r0 = float(np.clip(r0, MIN_RATE, MAX_RATE))
                    nL = max(1, int(round(ov_in / ratio)))
                    nR = int(round(ramp_bars / ratio))
                nR_eff = nR if kM is None else max(0, min(nR, kM - nL))
                n_steps = nR_eff // 2 if nR_eff >= 2 else 0
                edges = [nL + int(round(j * nR_eff / n_steps)) for j in range(n_steps + 1)] if n_steps else []

                def rate_base(k, _first=is_first, _r0=r0, _nL=nL, _edges=edges, _ns=n_steps):
                    if _first or not _edges and k >= _nL:
                        return 1.0
                    if k < _nL:
                        return _r0
                    for j in range(_ns):
                        if _edges[j] <= k < _edges[j + 1]:
                            return _r0 + (1 - _r0) * (j + 0.5) / _ns
                    return 1.0

                n_samp = y.shape[1]
                k_start = -int(math.floor(f / bar + 1e-9)) if is_first else 0
                k_end = (int(math.floor((n_samp / SR - f) / bar)) if is_last else kM + ov_out)
                cuts = {k_start, k_end}
                if not is_first:
                    cuts |= {0, nL, *edges}
                if not is_last:
                    cuts.add(kM)
                cuts = sorted(c for c in cuts if k_start <= c <= k_end)
                segs = []
                for k0, k1 in zip(cuts, cuts[1:]):
                    rate = rate_base(min(k0, kM) if kM is not None else k0)
                    segs.append((max(0, int(round((f + k0 * bar) * SR))),
                                 int(round((f + k1 * bar) * SR)), rate))
                if is_last and n_samp - segs[-1][1] > 0.25 * SR:
                    segs.append((segs[-1][1], n_samp, 1.0))
                arr, offs = build_track(y, segs)
                del y
                bar_off = dict(zip(cuts, offs[: len(cuts)]))
                this_rate_at_M = rate_base(kM) if kM is not None else 1.0

                if is_first:
                    cur, base = arr, 0
                    fi = int(0.02 * SR)
                    cur[:, :fi] *= np.linspace(0, 1, fi, dtype=np.float32)
                    downbeat_at = bar_off[0]
                else:
                    q = prev["bar_off"][prev["kM"]]
                    prev_ovl = prev["bar_off"][prev["kM"] + prev["ov"]] - q
                    in_ovl = bar_off[nL] - bar_off[0]
                    ovl = int(min(prev_ovl, in_ovl, cur.shape[1] - q, arr.shape[1]))
                    bar_s = int(round(240.0 / p_out * SR))
                    out.write(np.ascontiguousarray(cur[:, :q].T))
                    if styles[i - 1] == "echo":
                        beat_s = int(round(60.0 / p_out * SR))
                        mixed, tail = echo_transition(cur[:, q: q + ovl], arr[:, :ovl], beat_s)
                        arr[:, :ovl] = mixed
                        m = min(tail.shape[1], arr.shape[1] - ovl)
                        if m > 0:
                            arr[:, ovl: ovl + m] += tail[:, :m]
                    elif styles[i - 1] == "filter":
                        arr[:, :ovl] = filter_transition(
                            cur[:, q: q + ovl], arr[:, :ovl]
                        )
                    else:
                        mixed = eq_blend(cur[:, q: q + ovl], "out", bar_s) + eq_blend(arr[:, :ovl], "in", bar_s)
                        arr[:, :ovl] = mixed

                    # Optional external accent layer, placed relative to the selected handoff.
                    if sfx_bank and sfx_chance > 0:
                        pair_token = f"{entries[i - 1].track.title}|{t.title}|{i}"
                        selected = choose_effect(
                            sfx_bank, styles[i - 1], pair_token, chance=sfx_chance
                        )
                        if selected:
                            category, effect_path = selected
                            try:
                                if effect_path not in sfx_cache:
                                    sfx_audio = to_stereo(
                                        load_audio(effect_path, SR, mono=False)
                                    )
                                    sfx_cache[effect_path] = sfx_audio
                                applied = overlay_effect(
                                    arr, sfx_cache[effect_path], ovl, category,
                                    sample_rate=SR, gain=0.16,
                                )
                                if applied:
                                    log(f"  FX: {category} ({Path(effect_path).name})")
                            except Exception as exc:
                                log(f"  (skipped FX {effect_path}: {exc})")

                    base += q
                    cur = arr
                    downbeat_at = 0

                timeline.append({
                    "index": i + 1, "title": t.title, "artist": t.artist, "key": t.key,
                    "native_bpm": t.bpm,
                    "enter_bpm": None if is_first else round(t.bpm * ratio * r0, 2),
                    "start_s": (base + downbeat_at) / SR,
                    "source_cue_s": round(f, 3),
                    "mix_out_source_s": None if is_last else round(mix_out[i], 3),
                    "via": None if is_first else f"{styles[i - 1]} {ovs[i - 1]} bars",
                })
                prev = {"bar_off": bar_off, "kM": kM, "ov": ov_out}
                p_out = t.bpm * this_rate_at_M

            fo = min(int(3 * SR), cur.shape[1])
            cur[:, -fo:] *= np.linspace(1, 0, fo, dtype=np.float32)
            out.write(np.ascontiguousarray(cur.T))
            total_s = (base + cur.shape[1]) / SR

        stats = limit_file(tmp.name, lim.name)
        export_audio(lim.name, out_path, 1.0, log)
    finally:
        for p in (tmp.name, lim.name):
            try:
                os.unlink(p)
            except OSError:
                pass
    return {"duration_s": total_s, "peak": stats["peak"], "gain": stats["pre_gain"],
            "limiter_db": stats["max_reduction_db"], "timeline": timeline, "warnings": warnings_out}


def export_audio(src_wav: str, out_path: str, gain: float, log=print):
    import soundfile as sf
    ext = Path(out_path).suffix.lower() or ".wav"
    if ext != ".wav" and not shutil.which("ffmpeg"):
        out_path = str(Path(out_path).with_suffix(".wav"))
        log(f"ffmpeg not found, writing WAV instead: {out_path}")
        ext = ".wav"
    if ext == ".wav":
        with sf.SoundFile(src_wav) as rd, sf.SoundFile(out_path, "w", samplerate=SR, channels=2,
                                                       subtype="PCM_16") as wr:
            for block in rd.blocks(blocksize=SR * 10, dtype="float32"):
                wr.write(block * gain)
    else:
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", src_wav, "-af", f"volume={gain:.5f}"]
        if ext in {".mp3", ".m4a", ".aac", ".opus"}:
            cmd += ["-b:a", "256k"]
        subprocess.run(cmd + [out_path], check=True)


# ==========================================================================
# CLI
# ==========================================================================
def load_tracks(source: str, workers=None, log=print) -> list[Track]:
    p = Path(source)
    if p.is_dir():
        return build_tracks(analyze_folder(str(p), workers, log))
    tracks = load_library(source)
    root = p.resolve().parent
    fixed = []
    for t in tracks:
        tp = Path(t.path) if t.path else None
        if tp is not None and not tp.is_absolute():
            tp = root / tp
        fixed.append(replace(t, path=str(tp) if tp else ""))
    return fixed


def cmd_analyze(args):
    tracks = build_tracks(analyze_folder(args.folder, args.workers))
    out = args.out or "library.csv"
    write_library_csv(tracks, out)
    print(f"\n{'title':<34} {'bpm':>7} {'key':>4} {'E':>2} {'1st bar':>8}  {'key conf':>8}")
    print("-" * 72)
    infos = {os.path.abspath(p): i for p, i in analyze_folder(args.folder, args.workers, log=lambda *_: None)}
    for t in tracks:
        conf = infos[t.path]["key_conf"]
        print(f"{t.title[:33]:<34} {t.bpm:>7.2f} {t.key:>4} {t.energy:>2} {t.first_downbeat:>7.2f}s  {conf:>8.2f}")
    print(f"\nSaved {len(tracks)} tracks to {out}")
    print("Tip: if a BPM, key or first_downbeat looks wrong, fix it in the CSV and mix from the CSV.")


def cmd_mix(args):
    tracks = load_tracks(args.source, args.workers)
    if len(tracks) < 2:
        raise SystemExit("Need at least 2 tracks to make a mix.")
    if args.tracks > len(tracks):
        print(f"Note: only {len(tracks)} tracks available, so some will repeat.")
    dj = VirtualDJ(tracks, top_k=args.top_k, bpm_envelope=args.bpm_envelope,
                   key_drop_prob=args.key_drop_prob, overlap_bars=args.overlap_bars, seed=args.seed)
    start = None
    if args.start:
        hits = [t for t in tracks if args.start.lower() in t.title.lower()]
        if not hits:
            raise SystemExit(f"No track title contains '{args.start}'")
        start = hits[0]
    entries = dj.build_set(args.tracks, start=start)
    print_set(entries, verbose=not args.quiet)
    if args.plan_only:
        if len(entries) > 1 and not args.no_structure:
            print("\\nSearching full-track transition cues...")
            refine_transitions(
                entries, args.overlap_bars, fx=not args.no_fx, log=print
            )
        return
    missing = [e.track.title for e in entries if not e.track.path or not os.path.exists(e.track.path)]
    if missing:
        raise SystemExit("Audio files not found for: " + ", ".join(missing) +
                         "\n(The CSV needs a 'path' column pointing at each song.)")
    print("\nRendering...")
    res = render_mix(
        entries, args.out, overlap_bars=args.overlap_bars, ramp_bars=args.ramp_bars,
        refine=not args.no_structure, fx=not args.no_fx, target_db=args.target_db,
        sfx_dir=args.sfx_dir, sfx_chance=args.sfx_chance,
    )
    print(f"\n{'#':>2}  {'starts':>6}  {'key':>3}  {'native':>7}  {'enters at':>9}  {'transition':<14}  track")
    for r in res["timeline"]:
        m, s = divmod(int(r["start_s"]), 60)
        enter = f"{r['enter_bpm']:.1f}" if r["enter_bpm"] else "-"
        print(f"{r['index']:>2}  {m:02d}:{s:02d}  {r['key']:>3}  {r['native_bpm']:>7.1f}  {enter:>9}  "
              f"{(r['via'] or '-'):<14}  {r['title']} - {r['artist']}")
    for w in res["warnings"]:
        print("WARNING:", w)
    m, s = divmod(int(res["duration_s"]), 60)
    print(f"\nWrote {args.out}  ({m}:{s:02d}, peak {res['peak']:.2f}, "
          f"limiter max {res['limiter_db']:.1f} dB)")


def main():
    ap = argparse.ArgumentParser(description="Virtual DJ: analyze songs and render a mix")
    sub = ap.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("analyze", help="detect BPM / key / energy for every song in a folder")
    a.add_argument("folder")
    a.add_argument("--out", help="library CSV to write (default: library.csv)")
    a.add_argument("--workers", type=int)
    a.set_defaults(fn=cmd_analyze)

    m = sub.add_parser("mix", help="plan and render a mix")
    m.add_argument("source", help="folder of songs, or a library CSV with a 'path' column")
    m.add_argument("--tracks", type=int, default=8)
    m.add_argument("--seed", type=int)
    m.add_argument("--out", default="mix.mp3")
    m.add_argument("--start", help="start with the first track whose title contains this text")
    m.add_argument("--overlap-bars", type=int, default=16, help="longest blend, in bars (default 16)")
    m.add_argument("--ramp-bars", type=int, default=16,
                   help="bars over which the new track eases back to its own tempo (default 16)")
    m.add_argument("--top-k", type=int, default=3)
    m.add_argument("--bpm-envelope", type=float, default=6.0)
    m.add_argument("--key-drop-prob", type=float, default=0.05)
    m.add_argument("--workers", type=int)
    m.add_argument("--target-db", type=float, default=TARGET_DB,
                   help=f"per-track loudness target in dBFS RMS (default {TARGET_DB})")
    m.add_argument("--no-structure", action="store_true",
                   help="use the planner's mix points as they are (skip intro/outro detection)")
    m.add_argument("--no-fx", action="store_true", help="long EQ blends only (no echo-out transitions)")
    m.add_argument("--sfx-dir", default=None,
                   help="folder of external riser_/sweep_/impact_/scratch_ effects (default: Backend/sfx)")
    m.add_argument("--sfx-chance", type=float, default=0.35,
                   help="probability of adding one external effect per transition (0 to 1; default 0.35)")
    m.add_argument("--plan-only", action="store_true", help="print the set, don't render audio")
    m.add_argument("--quiet", action="store_true")
    m.set_defaults(fn=cmd_mix)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()