"""Unit tests for the optional external transition-effects library."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

from effects_engine import choose_effect, overlay_effect, scan_effects


class EffectsEngineTests(unittest.TestCase):
    def test_scans_effects_by_filename_prefix(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "riser_build.wav").touch()
            Path(folder, "impact_drop.mp3").touch()
            Path(folder, "unclassified.wav").touch()
            bank = scan_effects(folder)
            self.assertEqual(len(bank["riser"]), 1)
            self.assertEqual(len(bank["impact"]), 1)
            self.assertNotIn("unclassified", str(bank))

    def test_effect_choice_is_deterministic(self):
        bank = {"impact": ["impact_one.wav", "impact_two.wav"]}
        first = choose_effect(bank, "echo", "track-a|track-b", chance=1.0)
        second = choose_effect(bank, "echo", "track-a|track-b", chance=1.0)
        self.assertEqual(first, second)
        self.assertEqual(first[0], "impact")

    def test_overlay_places_effect_at_transition(self):
        target = np.zeros((2, 2000), dtype=np.float32)
        effect = np.ones((2, 400), dtype=np.float32)
        changed = overlay_effect(
            target, effect, transition_end=1000, category="impact",
            sample_rate=1000, gain=0.2,
        )
        self.assertTrue(changed)
        self.assertEqual(float(np.max(np.abs(target[:, :700]))), 0.0)
        self.assertGreater(float(np.max(np.abs(target[:, 700:1300]))), 0.0)
        self.assertEqual(float(np.max(np.abs(target[:, 1300:]))), 0.0)


if __name__ == "__main__":
    unittest.main()
