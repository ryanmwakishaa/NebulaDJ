"""Run with: python test_dj_audio.py   (takes a minute or two)"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

import dj_audio as da
from virtual_dj import SetEntry, Track

SR = 44100


def synth(path, bpm, root_pc=9, minor=True, dur=120.0, kick_only=False):
    """Fake dance track: kick every beat, claps on 2/4, off-beat hats, bass + pad that
    re-trigger on every downbeat, crash every 8 bars. Downbeat of bar 1 is t=0."""
    rng = np.random.default_rng(int(bpm * 10) + root_pc)
    n = int(dur * SR)
    y = np.zeros(n, np.float32)
    beat = 60.0 / bpm

    def put(sig, t):
        i = int(round(t * SR))
        if i < n:
            j = min(n, i + len(sig))
            y[i:j] += sig[: j - i]

    tk = np.arange(int(0.25 * SR)) / SR
    kick = (np.sin(2 * np.pi * (50 * tk + 100 * (1 - np.exp(-30 * tk)) / 30)) * np.exp(-10 * tk)).astype(np.float32)
    if kick_only:   # add a sharp 3 ms broadband click so alignment can be measured in the highs
        kick = kick.copy()
        click = (rng.standard_normal(int(0.003 * SR)) * 0.6).astype(np.float32)
        kick[: len(click)] += click * np.hanning(len(click)).astype(np.float32)
    tc = np.arange(int(0.12 * SR)) / SR
    clap =(rng.standard_normal(len(tc)) * np.exp(-30 * tc) * 0.35).astype(np.float32)
    th = np.arange(int(0.03 * SR)) / SR
    hat = (np.diff(rng.standard_normal(len(th) + 1)) * np.exp(-120 * th) * 0.18).astype(np.float32)
    f0 = 55.0 * 2 ** ((root_pc - 9) / 12)
    tb = np.arange(int(0.45 * SR)) / SR
    bass = (np.sin(2 * np.pi * f0 * tb) * np.exp(-4 * tb) * 0.55).astype(np.float32)
    f_pad = 4 * f0
    third = 3 if minor else 4
    tp = np.arange(int(beat * 4 * SR)) / SR
    pad = sum(np.sin(2 * np.pi * f_pad * 2 ** (s / 12) * tp) for s in (0, third, 7)).astype(np.float32)
    pad *= (0.07 * (0.6 + 0.4 * np.exp(-2 * tp))).astype(np.float32)
    tcr = np.arange(int(0.8 * SR)) / SR
    crash = (rng.standard_normal(len(tcr)) * np.exp(-5 * tcr) * 0.25).astype(np.float32)

    for k in range(int(dur / beat)):
        t = k * beat
        put(kick, t)
        if kick_only:
            continue
        if k % 4 in (1, 3):
            put(clap, t)
        put(hat, t + beat / 2)
        if k % 4 == 0:
            put(bass, t)
            put(pad, t)
        if k % 32 == 0:
            put(crash, t)
    peak = float(np.abs(y).max()) or 1.0
    y *= 0.8 / peak
    sf.write(path, np.stack([y, y], axis=1), SR, subtype="PCM_16")


def test_camelot():
    assert da.camelot(0, False) == "8B"      # C major
    assert da.camelot(9, True) == "8A"       # A minor
    assert da.camelot(2, True) == "7A"       # D minor
    assert da.camelot(4, False) == "12B"     # E major
    assert da.camelot(6, True) == "11A"      # F# minor
    assert da.camelot(7, False) == "9B"      # G major


def _related(a, b):
    na, la = int(a[:-1]), a[-1]
    nb, lb = int(b[:-1]), b[-1]
    return a == b or (na == nb)               # same key or relative major/minor


def test_analyze_synthetic(tmp):
    cases = [(124.0, 9, True, "8A"), (128.0, 2, True, "7A"), (122.0, 0, False, "8B")]
    for bpm, pc, minor, key in cases:
        p = os.path.join(tmp, f"synth_{int(bpm)}.wav")
        synth(p, bpm, pc, minor, dur=70.0)
        r = da.analyze_file(p)
        bar = 240.0 / bpm
        frac = (r["first_downbeat"] / bar) % 1.0
        off_ms = min(frac, 1 - frac) * bar * 1000
        print(f"   {bpm} BPM {key}: got {r['bpm']:.2f} BPM, {r['key']}, "
              f"first downbeat {r['first_downbeat']:.3f}s (bar-grid error {off_ms:.0f} ms)")
        assert abs(r["bpm"] - bpm) < 0.4, r["bpm"]
        assert _related(r["key"], key), (r["key"], key)
        assert off_ms < 60, off_ms


def test_render_alignment(tmp):
    """Two kick-only tracks (120 and 126 BPM). In the overlap their kicks must coincide
    (one onset per beat), and the second track must settle at its own tempo afterwards."""
    import librosa
    a, b = os.path.join(tmp, "ka.wav"), os.path.join(tmp, "kb.wav")
    synth(a, 120.0, kick_only=True, dur=120.0)
    synth(b, 126.0, kick_only=True, dur=120.0)
    ta = Track("A", "x", 120.0, "8A", 5, "house", 120.0, 0.0, a)
    tb = Track("B", "x", 126.0, "8A", 6, "house", 120.0, 0.0, b)
    bar_a = 240.0 / 120.0
    entries = [SetEntry(1, 0.0, ta, None, 32 * bar_a, 32), SetEntry(2, 0.0, tb, None, 0.0, 32)]
    out = os.path.join(tmp, "kick_mix.wav")
    res = da.render_mix(entries, out, overlap_bars=16, ramp_bars=16, log=lambda *_: None)
    y, sr = sf.read(out, dtype="float32")
    assert sr == SR and y.ndim == 2
    assert np.isfinite(y).all() and np.abs(y).max() <= 0.96
    dur = len(y) / sr
    print(f"   mix length {dur:.1f}s, peak {res['peak']:.2f}")
    assert 180 < dur < 192, dur

    from scipy.signal import butter, find_peaks, sosfiltfilt
    mono = y.mean(axis=1)
    hi = np.abs(sosfiltfilt(butter(4, 2000, "high", fs=sr, output="sos"), mono))
    thr = 0.12 * hi.max()
    pk, _ = find_peaks(hi, height=thr, distance=int(0.02 * sr))
    clicks = pk / sr

    t0 = 64.0                                 # B's downbeat lands at bar 32 of A
    ovl_len = 16 * bar_a
    inside = clicks[(clicks > t0 + 2) & (clicks < t0 + ovl_len - 2)]
    ioi = np.diff(inside)
    spread_ms = float(np.ptp(((inside + 0.25) % 0.5) - 0.25)) * 1000
    print(f"   overlap: {len(inside)} clicks, gap min/median/max "
          f"{ioi.min():.3f}/{np.median(ioi):.3f}/{ioi.max():.3f}s (beat 0.500), "
          f"jitter {spread_ms:.1f} ms")
    assert ioi.min() > 0.45, "double clicks in the overlap -> beats are not aligned"
    assert spread_ms < 6, spread_ms

    tail = clicks[clicks > dur - 20]
    med = np.median(np.diff(tail))
    print(f"   final 20s median beat {med:.4f}s (126 BPM = {60 / 126:.4f}s)")
    assert abs(med - 60 / 126) < 0.002

    ramp = clicks[(clicks > t0 + ovl_len) & (clicks < t0 + ovl_len + 20)]
    gaps = np.diff(ramp)
    print(f"   ramp: beat gap goes {gaps[:3].mean():.4f}s -> {gaps[-3:].mean():.4f}s")
    assert gaps[:3].mean() > gaps[-3:].mean()   # tempo is rising from 120 toward 126


def test_cli_end_to_end(tmp):
    folder = os.path.join(tmp, "songs")
    os.makedirs(folder)
    specs = [("Artist A - Alpha", 122, 9, True), ("Artist B - Bravo", 124, 4, True),
             ("Artist C - Charlie", 126, 11, True), ("Artist D - Delta", 124, 2, True)]
    for name, bpm, pc, minor in specs:
        synth(os.path.join(folder, name + ".wav"), bpm, pc, minor, dur=125.0)
    out = os.path.join(tmp, "set.mp3")
    cmd = [sys.executable, "dj_audio.py", "mix", folder, "--tracks", "3", "--seed", "4",
           "--out", out, "--quiet"]
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=str(Path(__file__).parent))
    print("   " + "\n   ".join(r.stdout.strip().splitlines()[-8:]))
    assert r.returncode == 0, r.stderr[-1500:]
    assert os.path.getsize(out) > 100_000
    info = sf.info(out)
    print(f"   mp3: {info.duration:.0f}s, {info.samplerate} Hz")
    assert info.duration > 150
    assert (Path(folder) / ".dj_cache.json").exists()
    # second run uses the cache and the CSV route
    r2 = subprocess.run([sys.executable, "dj_audio.py", "analyze", folder, "--out",
                         os.path.join(tmp, "lib.csv")], capture_output=True, text=True,
                        cwd=str(Path(__file__).parent))
    assert r2.returncode == 0, r2.stderr[-1500:]
    r3 = subprocess.run([sys.executable, "dj_audio.py", "mix", os.path.join(tmp, "lib.csv"),
                         "--tracks", "3", "--seed", "4", "--plan-only", "--quiet"],
                        capture_output=True, text=True, cwd=str(Path(__file__).parent))
    assert r3.returncode == 0, r3.stderr[-1500:]


if __name__ == "__main__":
    test_camelot()
    print("ok  test_camelot")
    with tempfile.TemporaryDirectory() as tmp:
        for fn in (test_analyze_synthetic, test_render_alignment, test_cli_end_to_end):
            fn(tmp)
            print("ok ", fn.__name__)
    print("all passed")
