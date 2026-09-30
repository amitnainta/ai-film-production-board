#!/bin/bash
# Session setup for Claude Code on the web: makes ffmpeg available for
# `node worker/src/cli.js assemble` and the real rough-cut render test.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# ffmpeg: use one on the PATH if present, otherwise a static build from PyPI.
if command -v ffmpeg >/dev/null 2>&1; then
  FFMPEG="$(command -v ffmpeg)"
else
  FFMPEG="$(python3 -c 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())' 2>/dev/null || true)"
  if [ -z "$FFMPEG" ]; then
    python3 -m pip install --quiet --disable-pip-version-check imageio-ffmpeg >&2
    FFMPEG="$(python3 -c 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())')"
  fi
fi
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export FFMPEG_PATH=\"$FFMPEG\"" >> "$CLAUDE_ENV_FILE"
fi
echo "ffmpeg: $FFMPEG" >&2

# Local pipeline config (git-ignored) so `doctor` and `plan` work straight away.
if [ ! -f config/pipeline.json ]; then
  cp config/pipeline.example.json config/pipeline.json
  echo "Created config/pipeline.json from the example; check model ids before a paid run." >&2
fi
