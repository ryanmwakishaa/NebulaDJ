#!/usr/bin/env python3
"""
Virtual DJ: a statistical / graph-theoretic track selector and mix planner.

Components
  1. Harmonic mixing   - graph distance on the Camelot wheel
  2. Energy flow       - Markov chain over energy levels 1..10 (+ gentle crowd "wave")
  3. BPM proximity     - envelope filter with half/double-time ratios
  4. Phrase alignment  - mix points on beat positions where beat mod (phrase_bars*4) == 0
  5. Stochastic pick   - weighted score, top-k shortlist, roulette-wheel choice

Usage
  python virtual_dj.py --tracks 12 --seed 7
  python virtual_dj.py --csv my_library.csv --tracks 20 --export set.csv

CSV columns: title,artist,bpm,key,energy,genre,duration,first_downbeat
  key is Camelot (e.g. 8A, 11B), energy 1-10, duration in seconds,
  first_downbeat in seconds (position of beat 1 of bar 1; default 0).
"""
from __future__ import annotations

import argparse
import csv
import math
import random
from dataclasses import dataclass, field

BEATS_PER_BAR = 4


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Track:
    title: str
    artist: str
    bpm: float
    key: str  # Camelot notation, "1A".."12B"
    energy: int  # 1..10
    genre: str
    duration: float  # seconds
    first_downbeat: float = 0.0
    path: str = ""  # audio file on disk (used by dj_audio.py)

    def __post_init__(self):
        parse_key(self.key)
        if not 1 <= self.energy <= 10:
            raise ValueError(f"energy must be 1..10: {self.title}")


def parse_key(key: str) -> tuple[int, str]:
    key = key.strip().upper()
    num, letter = int(key[:-1]), key[-1]
    if not (1 <= num <= 12 and letter in "AB"):
        raise ValueError(f"bad Camelot key: {key}")
    return num, letter


# --------------------------------------------------------------------------
# 1. Harmonic mixing: graph distance on the Camelot wheel
# --------------------------------------------------------------------------
def key_distance(a: str, b: str) -> int:
    """
    Shortest path on the Camelot graph where edges are:
      - one step around the wheel (same letter, number +/- 1, wrapping 12 -> 1)
      - the relative major/minor swap (same number, A <-> B)
    That reduces to: circular number distance + (1 if letters differ).
      0 = same key, 1 = adjacent / relative, 2 = diagonal or +/-2 (energy boost)
    """
    na, la = parse_key(a)
    nb, lb = parse_key(b)
    wheel = abs(na - nb)
    wheel = min(wheel, 12 - wheel)
    return wheel + (1 if la != lb else 0)


KEY_SCORE = {0: 1.0, 1: 0.9, 2: 0.45, 3: 0.12}
KEY_OK_MAX_DISTANCE = 2


def key_score(distance: int) -> float:
    return KEY_SCORE.get(distance, 0.02)


# --------------------------------------------------------------------------
# 2. Energy: Markov chain
# --------------------------------------------------------------------------
def build_energy_matrix() -> list[list[float]]:
    """
    Row i = current energy (1..10), column j = next energy. Rules of thumb:
    stay or climb by 1-2 is common, small dips are normal, huge jumps up are
    ~impossible, and a big dramatic drop is only plausible from a peak (>= 7).
    """

    def weight(i: int, j: int) -> float:
        d = j - i
        table = {0: 0.30, 1: 0.30, 2: 0.15, -1: 0.12, -2: 0.06, 3: 0.02, -3: 0.03}
        if d in table:
            return table[d]
        if d >= 4:
            return 0.002
        return 0.08 if i >= 7 else 0.005  # d <= -4: deliberate drop only from a peak

    matrix = []
    for i in range(1, 11):
        row = [weight(i, j) for j in range(1, 11)]
        total = sum(row)
        matrix.append([w / total for w in row])
    return matrix


# --------------------------------------------------------------------------
# 3. BPM proximity
# --------------------------------------------------------------------------
def bpm_distance(current: float, candidate: float) -> tuple[float, float]:
    """
    Distance after allowing exact half/double-time matches (70 <-> 140).
    Returns (delta_bpm, ratio) where the candidate is played at candidate*ratio.
    """
    best = (abs(current - candidate), 1.0)
    for ratio in (2.0, 0.5):
        d = abs(current - candidate * ratio)
        if d < best[0]:
            best = (d, ratio)
    return best


# --------------------------------------------------------------------------
# 4. Phrase alignment (modular arithmetic on the beat grid)
# --------------------------------------------------------------------------
def bar_seconds(bpm: float) -> float:
    return BEATS_PER_BAR * 60.0 / bpm


def beat_position(t: float, bpm: float, first_downbeat: float) -> float:
    return (t - first_downbeat) * bpm / 60.0


def on_phrase_boundary(t: float, bpm: float, first_downbeat: float,
                       phrase_bars: int = 32, tol: float = 1e-6) -> bool:
    """BeatPosition mod (phrase_bars * 4) == 0."""
    period = phrase_bars * BEATS_PER_BAR
    r = beat_position(t, bpm, first_downbeat) % period
    return min(r, period - r) < tol


def next_phrase_boundary(t: float, bpm: float, first_downbeat: float,
                         phrase_bars: int = 32) -> float:
    """Earliest time >= t that lands on beat 1 of a phrase_bars block."""
    bars = (t - first_downbeat) / bar_seconds(bpm)
    k = math.ceil(bars / phrase_bars - 1e-9)
    return first_downbeat + k * phrase_bars * bar_seconds(bpm)


def plan_mix_out(track: Track, rng: random.Random, min_phrases: int = 2,
                 overlap_bars: int = 16) -> tuple[float, int]:
    """
    Pick when to start blending out: a random whole number of phrases after
    the track's first downbeat, leaving room for the overlap before the end.
    Falls back to 16- then 8-bar phrases for short tracks.
    Returns (mix_out_time_in_track_seconds, phrase_bars_used).
    """
    bs = bar_seconds(track.bpm)
    limit = track.duration - overlap_bars * bs
    for phrase_bars in (32, 16, 8):
        n_max = int((limit - track.first_downbeat) / bs // phrase_bars)
        if n_max >= 1:
            n = rng.randint(min(min_phrases, n_max), n_max)
            return track.first_downbeat + n * phrase_bars * bs, phrase_bars
    return max(track.first_downbeat, limit), 0


# --------------------------------------------------------------------------
# 5. The DJ: scoring + stochastic selection
# --------------------------------------------------------------------------
GENRE_RELATED = [
    ("house", "deep house"), ("house", "tech house"), ("house", "afro house"),
    ("house", "disco"), ("deep house", "afro house"), ("deep house", "melodic techno"),
    ("tech house", "techno"), ("techno", "melodic techno"), ("disco", "funk"),
    ("hip hop", "funk"), ("hip hop", "r&b"), ("r&b", "funk"),
    ("afro house", "melodic techno"),
]
_RELATED = {frozenset(p) for p in GENRE_RELATED}


def genre_affinity(a: str, b: str) -> float:
    if a == b:
        return 1.0
    return 0.6 if frozenset((a, b)) in _RELATED else 0.2


@dataclass
class Decision:
    track: Track
    score: float
    components: dict
    shortlist: list  # [(track, score, probability)]
    key_dist: int
    bpm_delta: float
    pitch_pct: float
    key_drop: bool
    widened: float


@dataclass
class SetEntry:
    index: int
    clock: float  # seconds from set start when this track's bar 1 hits
    track: Track
    decision: Decision | None
    mix_out_in_track: float = 0.0
    phrase_bars: int = 32


class VirtualDJ:
    def __init__(self, library: list[Track], weights=(0.30, 0.25, 0.30, 0.15),
                 bpm_envelope: float = 6.0, max_stretch: float = 0.08,
                 top_k: int = 3, sharpness: float = 2.0,
                 key_drop_prob: float = 0.05, repeat_memory: int = 12,
                 arc_cycle: int = 8, overlap_bars: int = 16,
                 seed: int | None = None):
        if not library:
            raise ValueError("empty library")
        self.library = library
        self.w_key, self.w_bpm, self.w_energy, self.w_genre = weights
        self.bpm_envelope = bpm_envelope
        self.max_stretch = max_stretch
        self.top_k = top_k
        self.sharpness = sharpness
        self.key_drop_prob = key_drop_prob
        self.repeat_memory = repeat_memory
        self.arc_cycle = arc_cycle
        self.overlap_bars = overlap_bars
        self.rng = random.Random(seed)
        self.energy_matrix = build_energy_matrix()
        self.history: list[Track] = []

    # ---- scoring pieces -------------------------------------------------
    def _bpm_score(self, delta: float) -> float:
        sigma = self.bpm_envelope / 2.0
        return math.exp(-0.5 * (delta / sigma) ** 2)

    def _energy_score(self, cur: Track, cand: Track) -> float:
        row = self.energy_matrix[cur.energy - 1]
        p_norm = row[cand.energy - 1] / max(row)
        step = len(self.history)
        target = 6 + 3 * math.sin(2 * math.pi * step / self.arc_cycle)
        arc = math.exp(-0.5 * ((cand.energy - target) / 2.5) ** 2)
        return 0.7 * p_norm + 0.3 * arc

    # ---- candidate pool (filters, with graceful widening) ---------------
    def _pool(self, cur: Track, key_drop: bool):
        recent = {t.title for t in self.history[-self.repeat_memory:]}
        base = [t for t in self.library if t.title not in recent and t.title != cur.title]
        if not base:
            base = [t for t in self.library if t.title != cur.title]

        def stage(require_key: bool, factor: float):
            out = []
            for t in base:
                delta, ratio = bpm_distance(cur.bpm, t.bpm)
                eff = t.bpm * ratio
                if delta > self.bpm_envelope * factor:
                    continue
                if delta / eff > self.max_stretch * factor:
                    continue
                if require_key and not key_drop and \
                        key_distance(cur.key, t.key) > KEY_OK_MAX_DISTANCE:
                    continue
                out.append(t)
            return out

        for require_key in (True, False):
            for factor in (1.0, 1.5, 2.0, 3.0):
                pool = stage(require_key, factor)
                if pool:
                    return pool, factor
        return base, float("inf")

    # ---- main selection --------------------------------------------------
    def select_next(self, cur: Track) -> Decision:
        key_drop = self.rng.random() < self.key_drop_prob
        pool, widened = self._pool(cur, key_drop)

        scored = []
        for t in pool:
            dist = key_distance(cur.key, t.key)
            k = 0.6 if key_drop else key_score(dist)
            delta, ratio = bpm_distance(cur.bpm, t.bpm)
            b = self._bpm_score(delta)
            e = self._energy_score(cur, t)
            g = genre_affinity(cur.genre, t.genre)
            total = self.w_key * k + self.w_bpm * b + self.w_energy * e + self.w_genre * g
            if t.artist == cur.artist:
                total *= 0.5
            scored.append((t, total, {"key": k, "bpm": b, "energy": e, "genre": g}))

        scored.sort(key=lambda x: x[1], reverse=True)
        shortlist = scored[: self.top_k]
        weights = [max(s, 1e-9) ** self.sharpness for _, s, _ in shortlist]
        total_w = sum(weights)
        probs = [w / total_w for w in weights]
        idx = self.rng.choices(range(len(shortlist)), weights=weights, k=1)[0]
        chosen, score, comps = shortlist[idx]

        delta, ratio = bpm_distance(cur.bpm, chosen.bpm)
        eff = chosen.bpm * ratio
        decision = Decision(
            track=chosen, score=score, components=comps,
            shortlist=[(t, s, p) for (t, s, _), p in zip(shortlist, probs)],
            key_dist=key_distance(cur.key, chosen.key),
            bpm_delta=delta,
            pitch_pct=(cur.bpm / eff - 1) * 100,
            key_drop=key_drop and key_distance(cur.key, chosen.key) > KEY_OK_MAX_DISTANCE,
            widened=widened,
        )
        return decision

    # ---- set builder ------------------------------------------------------
    def build_set(self, n_tracks: int, start: Track | None = None) -> list[SetEntry]:
        self.history = []
        if start is None:
            warm = [t for t in self.library if t.energy <= 5] or self.library
            start = self.rng.choice(warm)
        entries: list[SetEntry] = []
        clock = 0.0
        cur, decision = start, None
        for i in range(n_tracks):
            mix_out, pb = plan_mix_out(cur, self.rng, overlap_bars=self.overlap_bars)
            entries.append(SetEntry(i + 1, clock, cur, decision, mix_out, pb))
            self.history.append(cur)
            if i == n_tracks - 1:
                break
            clock += mix_out - cur.first_downbeat  # next track's bar 1 lands here
            decision = self.select_next(cur)
            cur = decision.track
        return entries


# --------------------------------------------------------------------------
# Library helpers
# --------------------------------------------------------------------------
def load_library(path: str) -> list[Track]:
    tracks = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            tracks.append(Track(
                title=row["title"], artist=row["artist"], bpm=float(row["bpm"]),
                key=row["key"], energy=int(row["energy"]), genre=row["genre"],
                duration=float(row["duration"]),
                first_downbeat=float(row.get("first_downbeat") or 0.0),
                path=(row.get("path") or "").strip(),
            ))
    return tracks


def demo_library(n: int = 90, seed: int = 1) -> list[Track]:
    rng = random.Random(seed)
    profiles = {
        "deep house": ((118, 124), (2, 5)),
        "house": ((122, 127), (4, 8)),
        "tech house": ((124, 129), (5, 9)),
        "afro house": ((120, 126), (3, 7)),
        "techno": ((128, 136), (6, 10)),
        "melodic techno": ((120, 128), (4, 8)),
        "disco": ((116, 124), (3, 7)),
        "hip hop": ((84, 96), (3, 7)),
        "funk": ((98, 112), (3, 7)),
    }
    adjectives = ["Midnight", "Golden", "Velvet", "Electric", "Slow", "Neon", "Hidden",
                  "Warm", "Lunar", "Broken", "Silver", "Late", "Wild", "Cosmic"]
    nouns = ["Signal", "Garden", "Pulse", "Harbor", "Echo", "Skyline", "Rhythm",
             "Mirage", "Engine", "Voyage", "Static", "Bloom", "Tides", "Sunrise"]
    artists = [f"Artist {c}" for c in "ABCDEFGHIJKLMNOP"]
    genres = list(profiles)
    seen, tracks = set(), []
    while len(tracks) < n:
        title = f"{rng.choice(adjectives)} {rng.choice(nouns)}"
        if title in seen:
            continue
        seen.add(title)
        genre = rng.choices(genres, weights=[3, 4, 3, 2, 3, 2, 1, 1, 1])[0]
        (b0, b1), (e0, e1) = profiles[genre]
        tracks.append(Track(
            title=title, artist=rng.choice(artists),
            bpm=round(rng.uniform(b0, b1), 1),
            key=f"{rng.randint(1, 12)}{rng.choice('AB')}",
            energy=rng.randint(e0, e1), genre=genre,
            duration=round(rng.uniform(240, 420), 1),
            first_downbeat=round(rng.uniform(0.0, 0.4), 3),
        ))
    return tracks


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def fmt_time(s: float) -> str:
    return f"{int(s // 60):02d}:{int(s % 60):02d}"


def print_set(entries: list[SetEntry], verbose: bool = True):
    print(f"{'#':>2}  {'time':>5}  {'key':>3}  {'bpm':>5}  {'E':>2}  {'genre':<15} track")
    print("-" * 78)
    for e in entries:
        t = e.track
        print(f"{e.index:>2}  {fmt_time(e.clock):>5}  {t.key:>3}  {t.bpm:>5.1f}  "
              f"{t.energy:>2}  {t.genre:<15} {t.title} - {t.artist}")
        d = e.decision
        if verbose and d:
            tag = "  KEY-CHANGE DROP" if d.key_drop else ""
            widen = f"  (envelope x{d.widened:g})" if d.widened != 1.0 else ""
            print(f"      mix in: key dist {d.key_dist}, dBPM {d.bpm_delta:.1f}, "
                  f"pitch {d.pitch_pct:+.1f}%, score {d.score:.2f}{tag}{widen}")
            picks = ", ".join(f"{t.title} {s:.2f} ({p:.0%})" for t, s, p in d.shortlist)
            print(f"      shortlist: {picks}")
        if verbose and e.phrase_bars:
            bars = (e.mix_out_in_track - t.first_downbeat) / bar_seconds(t.bpm)
            print(f"      mix out at bar {bars:.0f} ({e.phrase_bars}-bar phrase boundary)")


def export_set(entries: list[SetEntry], path: str):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["order", "set_time", "title", "artist", "key", "bpm", "energy",
                    "genre", "key_distance", "bpm_delta", "pitch_pct", "score", "key_drop"])
        for e in entries:
            t, d = e.track, e.decision
            w.writerow([e.index, fmt_time(e.clock), t.title, t.artist, t.key, t.bpm,
                        t.energy, t.genre,
                        d.key_dist if d else "", f"{d.bpm_delta:.1f}" if d else "",
                        f"{d.pitch_pct:+.1f}" if d else "", f"{d.score:.3f}" if d else "",
                        d.key_drop if d else ""])


def main():
    ap = argparse.ArgumentParser(description="Virtual DJ set generator")
    ap.add_argument("--csv", help="library CSV (default: synthetic demo library)")
    ap.add_argument("--tracks", type=int, default=10)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--top-k", type=int, default=3)
    ap.add_argument("--bpm-envelope", type=float, default=6.0)
    ap.add_argument("--key-drop-prob", type=float, default=0.05)
    ap.add_argument("--export", help="write the set to this CSV path")
    ap.add_argument("--quiet", action="store_true", help="one line per track")
    args = ap.parse_args()

    library = load_library(args.csv) if args.csv else demo_library()
    dj = VirtualDJ(library, top_k=args.top_k, bpm_envelope=args.bpm_envelope,
                   key_drop_prob=args.key_drop_prob, seed=args.seed)
    entries = dj.build_set(args.tracks)
    print_set(entries, verbose=not args.quiet)
    if args.export:
        export_set(entries, args.export)
        print(f"\nSaved to {args.export}")


if __name__ == "__main__":
    main()
