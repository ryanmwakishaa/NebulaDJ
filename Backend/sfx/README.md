# NebulaDJ external transition effects

Drop audio effects you have permission to use into this folder. Supported formats:
WAV, MP3, FLAC, OGG, AIFF and M4A.

The filename prefix controls the effect role:

- `riser_*.wav` or `riser_*.mp3`: build toward the handoff; placed before the transition ends.
- `sweep_*`: transition sweep, also placed before the handoff.
- `impact_*`: impact/drop accent centred on the handoff.
- `scratch_*`: short DJ scratch accent centred on the handoff.

The mixer scans these files when rendering. Effect selection is deterministic for a given track pair and uses a configurable chance, so repeated renders are reproducible.

Run a clean baseline with `--sfx-chance 0`. To test effects, use `--sfx-chance 1`. Start with a small folder of a few restrained effects; excessive overlays can mask the music. Use only audio you own or are licensed to use.
