"""Phrase-aware transition point search for NebulaDJ.

The planner works with per-bar energy curves produced by dj_audio.structure_from_audio.
It searches usable audio in both tracks; it does not assume that the outgoing track
must be near its end or that the incoming track must start at bar zero.
"""
from __future__ import annotations

from dataclasses import dataclass
import math

import numpy as np


@dataclass(frozen=True)
class TransitionChoice:
    out_bar: int
    in_bar: int
    score: float
    overlap_bars: int


def _candidate_bars(
    profile: np.ndarray,
    minimum_bar: int,
    overlap_bars: int,
    stride_bars: int,
    min_activity: float,
) -> list[int]:
    """Return phrase-grid starts with enough non-silent audio for the overlap."""
    if profile.ndim != 1 or len(profile) < overlap_bars:
        return []

    first = int(math.ceil(max(0, minimum_bar) / stride_bars) * stride_bars)
    last = len(profile) - overlap_bars
    candidates = []
    for bar in range(first, last + 1, stride_bars):
        window = profile[bar:bar + overlap_bars]
        # Ignore near-silence, but retain quieter breakdowns as possible musical moments.
        if float(np.mean(window)) >= min_activity and float(np.max(window)) >= min_activity * 1.5:
            candidates.append(bar)
    return candidates


def _window_cost(out_window: np.ndarray, in_window: np.ndarray) -> float:
    """Lower is better: similar level/shape, with a penalty for nearly silent windows."""
    difference = float(np.mean(np.abs(out_window - in_window)))
    width = min(2, len(out_window))
    start_gap = abs(float(np.mean(out_window[:width])) - float(np.mean(in_window[:width])))
    out_slope = float(out_window[-1] - out_window[0])
    in_slope = float(in_window[-1] - in_window[0])
    slope_gap = abs(out_slope - in_slope) / max(1, len(out_window))
    quiet_penalty = max(0.0, 0.22 - float(np.mean(out_window)))
    quiet_penalty += max(0.0, 0.22 - float(np.mean(in_window)))
    return difference + 0.25 * start_gap + 0.15 * slope_gap + 0.8 * quiet_penalty


def choose_transition(
    outgoing_profile,
    incoming_profile,
    *,
    minimum_out_bar: int,
    minimum_in_bar: int = 0,
    overlap_bars: int = 8,
    preferred_out_bar: int | None = None,
    stride_bars: int = 4,
    min_activity: float = 0.08,
) -> TransitionChoice | None:
    """Find the best pair of phrase-aligned windows anywhere in both tracks.

    Profiles are normalized per-track energy curves. Candidate starts are searched
    every stride_bars; their windows must have overlap_bars of audio available.
    The optional preferred_out_bar is only a weak tie-breaker, never a boundary rule.
    """
    out_profile = np.asarray(outgoing_profile, dtype=np.float32)
    in_profile = np.asarray(incoming_profile, dtype=np.float32)

    out_bars = _candidate_bars(
        out_profile, minimum_out_bar, overlap_bars, stride_bars, min_activity
    )
    in_bars = _candidate_bars(
        in_profile, minimum_in_bar, overlap_bars, stride_bars, min_activity
    )
    if not out_bars or not in_bars:
        return None

    best: tuple[float, int, int] | None = None
    for out_bar in out_bars:
        out_window = out_profile[out_bar:out_bar + overlap_bars]
        for in_bar in in_bars:
            in_window = in_profile[in_bar:in_bar + overlap_bars]
            cost = _window_cost(out_window, in_window)
            if preferred_out_bar is not None:
                # Weak prior: avoid arbitrary jumps when multiple windows are equally good.
                cost += 0.015 * abs(out_bar - preferred_out_bar) / max(16, len(out_profile))
            candidate = (cost, out_bar, in_bar)
            if best is None or candidate < best:
                best = candidate

    if best is None:
        return None
    return TransitionChoice(
        out_bar=best[1],
        in_bar=best[2],
        score=float(best[0]),
        overlap_bars=overlap_bars,
    )
