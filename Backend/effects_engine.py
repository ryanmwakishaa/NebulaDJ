"""Optional external sound-effect library for NebulaDJ transitions.

Put licensed audio files in Backend/sfx using one of these filename prefixes:
riser_, sweep_, impact_, scratch_. The prefix determines placement/treatment.
"""
from __future__ import annotations

from hashlib import sha256
from pathlib import Path

import numpy as np

SUPPORTED = {".wav", ".mp3", ".flac", ".ogg", ".aiff", ".aif", ".m4a"}
PREFIXES = ("riser_", "sweep_", "impact_", "scratch_")


def scan_effects(directory: str | Path | None) -> dict[str, list[str]]:
    """Return supported effect files grouped by their filename prefix."""
    if not directory:
        return {}
    root = Path(directory)
    if not root.is_dir():
        return {}
    bank = {prefix[:-1]: [] for prefix in PREFIXES}
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() in SUPPORTED:
            stem = path.stem.lower()
            for prefix in PREFIXES:
                if stem.startswith(prefix):
                    bank[prefix[:-1]].append(str(path))
                    break
    return {kind: paths for kind, paths in bank.items() if paths}


def choose_effect(
    bank: dict[str, list[str]],
    transition_style: str,
    pair_token: str,
    chance: float = 0.35,
) -> tuple[str, str] | None:
    """Choose a repeatable optional effect without relying on Python's random seed."""
    if not bank or chance <= 0:
        return None
    if not 0 <= chance <= 1:
        raise ValueError("chance must be between 0 and 1")

    digest = sha256(pair_token.encode("utf-8")).digest()
    roll = int.from_bytes(digest[:4], "big") / 2**32
    if roll >= chance:
        return None

    if transition_style == "echo":
        preferred = ("impact", "scratch", "sweep")
    elif transition_style == "filter":
        preferred = ("riser", "sweep", "impact")
    else:
        preferred = ("sweep", "riser")

    available = [kind for kind in preferred if bank.get(kind)]
    if not available:
        available = sorted(kind for kind, paths in bank.items() if paths)
    if not available:
        return None

    kind = available[digest[4] % len(available)]
    paths = bank[kind]
    path = paths[int.from_bytes(digest[5:9], "big") % len(paths)]
    return kind, path


def overlay_effect(
    target: np.ndarray,
    effect: np.ndarray,
    transition_end: int,
    category: str,
    *,
    sample_rate: int = 44100,
    gain: float = 0.16,
) -> bool:
    """Overlay a normalized effect around the end of the transition in-place.

    Risers/sweeps build toward the handoff. Impacts/scratches are centred on it.
    The target is channel-first stereo audio. Returns False for empty/invalid audio.
    """
    if target.ndim != 2 or effect.ndim != 2 or target.shape[0] != 2 or effect.shape[0] != 2:
        return False
    if target.shape[1] == 0 or effect.shape[1] == 0 or gain <= 0:
        return False

    effect = np.asarray(effect, dtype=np.float32)
    peak = float(np.max(np.abs(effect)))
    if not np.isfinite(peak) or peak < 1e-7:
        return False

    # Keep the effect below the music; the master limiter remains the final safety net.
    clip = effect * (min(1.0, 0.75 / peak) * gain)
    n = clip.shape[1]
    if category in {"riser", "sweep"}:
        start = transition_end - n
    else:
        start = transition_end - n // 2

    dst_start = max(0, start)
    dst_end = min(target.shape[1], start + n)
    if dst_end <= dst_start:
        return False

    src_start = dst_start - start
    src_end = src_start + (dst_end - dst_start)
    segment = clip[:, src_start:src_end].copy()

    fade = min(segment.shape[1] // 3, max(1, int(0.025 * sample_rate)))
    if fade:
        envelope = np.ones(segment.shape[1], dtype=np.float32)
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        envelope[:fade] *= ramp
        envelope[-fade:] *= ramp[::-1]
        segment *= envelope[None, :]

    target[:, dst_start:dst_end] += segment
    return True
