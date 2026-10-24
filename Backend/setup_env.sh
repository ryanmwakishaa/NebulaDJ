#!/usr/bin/env bash
# Creates a virtual environment for the virtual DJ project and checks it works.
# Usage:  bash setup_env.sh
set -euo pipefail

cd "$(dirname "$0")"

python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

python test_virtual_dj.py                       # planner tests (fast)
python -c "import librosa, soundfile, scipy, pylibrb; print('audio libraries OK')"

if command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg found: mp3/m4a input and output will work."
else
  echo "NOTE: ffmpeg not found. WAV/FLAC work, but install ffmpeg for mp3/m4a:"
  echo "  macOS: brew install ffmpeg   |   Ubuntu: sudo apt install ffmpeg"
fi

echo
echo "Environment ready. Activate it with:"
echo "  source .venv/bin/activate        (macOS / Linux)"
echo "  .venv\\Scripts\\activate           (Windows)"
echo
echo "Then:"
echo "  python dj_audio.py analyze ./songs"
echo "  python dj_audio.py mix ./songs --tracks 8 --out mix.mp3"
echo "(Optional full audio self-test, ~2 min:  python test_dj_audio.py)"
