# AI Film Production Board

- `board/index.html` is a Claude Artifact page. It is published without `<html>/<head>/<body>` tags; the platform wraps it. Keep all CSS and JS inline; external scripts only from the allowed CDNs.
- The live board: https://claude.ai/artifact/Tv99XQ9Yj8J9gC5uAtszcN. Republish `board/index.html` to that URL to update it; declare capabilities `db`, `user`, `sample`, `assets`, `downloads`.
- The data model in `docs/ARCHITECTURE.md` is the contract between the board and the render worker. Update the doc in the same change as any field change.
- Never put API keys in the board or in committed config. Reference secrets by environment variable name.
- Before publishing, syntax-check the page script (extract the `<script>` block and run `node --check`).
- Worker changes: run `npm --prefix worker test` before committing. Set `FFMPEG_PATH` (or have `ffmpeg` on the PATH) so the real rough-cut render test runs instead of being skipped; `pip install imageio-ffmpeg` provides a static ffmpeg. The worker has no npm dependencies; keep it that way unless there's a strong reason.
- Never run paid renders without the user approving the plan printed by `node worker/src/cli.js plan`. The render-sync skill describes the full procedure.
- Work on feature branches and open pull requests; don't push to `main` directly.
