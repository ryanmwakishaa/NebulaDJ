"""Unit tests for the free-form transition point search."""
import unittest

import numpy as np

from transition_planner import choose_transition


class TransitionPlannerTests(unittest.TestCase):
    def test_searches_mid_track_and_phrase_aligns_both_cues(self):
        outgoing = np.full(80, 1.0, dtype=np.float32)
        incoming = np.full(80, 0.15, dtype=np.float32)

        # Make one matching eight-bar musical window well inside both tracks.
        pattern = np.array([0.35, 0.45, 0.60, 0.72, 0.68, 0.58, 0.48, 0.38],
                           dtype=np.float32)
        outgoing[20:28] = pattern
        incoming[44:52] = pattern

        choice = choose_transition(
            outgoing,
            incoming,
            minimum_out_bar=8,
            overlap_bars=8,
            preferred_out_bar=20,
        )

        self.assertIsNotNone(choice)
        self.assertEqual(choice.out_bar % 4, 0)
        self.assertEqual(choice.in_bar % 4, 0)
        self.assertGreater(choice.out_bar, 0)
        self.assertGreater(choice.in_bar, 0)
        self.assertLess(choice.out_bar, 80 - 8)
        self.assertLess(choice.in_bar, 80 - 8)
        self.assertEqual(choice.out_bar, 20)
        self.assertEqual(choice.in_bar, 44)

    def test_returns_none_when_there_is_not_enough_active_audio(self):
        silent = np.zeros(24, dtype=np.float32)
        self.assertIsNone(
            choose_transition(
                silent,
                silent,
                minimum_out_bar=0,
                overlap_bars=8,
            )
        )

    def test_does_not_force_incoming_track_to_bar_zero(self):
        outgoing = np.full(64, 0.2, dtype=np.float32)
        incoming = np.full(64, 0.2, dtype=np.float32)
        incoming[:24] = 0.0
        incoming[32:40] = 0.2

        choice = choose_transition(
            outgoing,
            incoming,
            minimum_out_bar=8,
            overlap_bars=8,
            preferred_out_bar=24,
        )
        self.assertIsNotNone(choice)
        self.assertGreaterEqual(choice.in_bar, 24)


if __name__ == "__main__":
    unittest.main()
