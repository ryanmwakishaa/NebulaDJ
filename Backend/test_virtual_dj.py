"""Run with: python test_virtual_dj.py"""
import random

from virtual_dj import (
    KEY_OK_MAX_DISTANCE, VirtualDJ, bar_seconds, bpm_distance, build_energy_matrix,
    demo_library, key_distance, next_phrase_boundary, on_phrase_boundary, plan_mix_out,
)


def test_key_graph():
    assert key_distance("8A", "8A") == 0
    assert key_distance("8A", "9A") == 1
    assert key_distance("12A", "1A") == 1      # wheel wraps
    assert key_distance("8A", "8B") == 1       # relative major/minor
    assert key_distance("8A", "9B") == 2       # diagonal
    assert key_distance("8A", "2A") == 6       # opposite side


def test_energy_markov():
    m = build_energy_matrix()
    assert all(abs(sum(row) - 1) < 1e-9 for row in m)
    assert m[1][9] < 0.01                      # 2 -> 10 ~ impossible
    assert m[6][6] > 0.15 and m[6][7] > 0.15   # 7 -> 7 / 8 likely
    # a dramatic drop (5 levels) is plausible from a peak, rare from a mid-level track
    assert m[7][2] > 5 * m[5][0]               # 8 -> 3  vs  6 -> 1
    assert m[9][4] > 5 * m[4][0] * 0.9         # 10 -> 5 vs  5 -> 1 (4-level drop)


def test_bpm():
    assert bpm_distance(140, 70) == (0.0, 2.0)
    assert bpm_distance(70, 140) == (0.0, 0.5)
    assert bpm_distance(124, 126)[0] == 2.0
    assert bpm_distance(90, 130)[0] > 6


def test_phrase_math():
    bpm, db = 124.0, 0.21
    t = next_phrase_boundary(50.0, bpm, db, 32)
    assert t >= 50.0 and on_phrase_boundary(t, bpm, db, 32)
    assert not on_phrase_boundary(t + bar_seconds(bpm), bpm, db, 32)
    for track in demo_library(30):
        mo, pb = plan_mix_out(track, random.Random(1))
        assert mo <= track.duration
        if pb:
            assert on_phrase_boundary(mo, track.bpm, track.first_downbeat, pb)


def test_set_rules():
    lib = demo_library(90)
    for seed in range(20):
        dj = VirtualDJ(lib, seed=seed)
        entries = dj.build_set(15)
        assert len({e.track.title for e in entries}) == 15       # no repeats
        for e in entries[1:]:
            d = e.decision
            if d.widened == 1.0:
                assert d.bpm_delta <= dj.bpm_envelope
                assert abs(d.pitch_pct) <= 8.0 + 1e-9
                if not d.key_drop:
                    assert d.key_dist <= KEY_OK_MAX_DISTANCE
        assert all(b.clock > a.clock for a, b in zip(entries, entries[1:]))


def test_not_always_top_pick():
    lib = demo_library(90)
    dj = VirtualDJ(lib, key_drop_prob=0.0, seed=3)
    cur = dj.library[0]
    dj.history = [cur]
    picks = {dj.select_next(cur).track.title for _ in range(60)}
    assert len(picks) >= 2                                       # roulette adds variety


def test_reproducible():
    lib = demo_library(90)
    a = [e.track.title for e in VirtualDJ(lib, seed=42).build_set(10)]
    b = [e.track.title for e in VirtualDJ(lib, seed=42).build_set(10)]
    assert a == b


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok ", name)
    print("all passed")
