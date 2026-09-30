# AI Film Production Board

A production board and configurable AI tool pipeline for making short animated films, from script to final cut.

The board is the control room: it holds the script, the locked cast, every shot and its prompts, keyframes, video takes, the budget and the pipeline configuration. Tools (image, video, voice, music, edit) plug in per stage. At first you run each tool by hand and upload results; later a render worker automates the stages you choose.

```
script → cast bible → shot list → keyframes → video takes → voices / lip-sync → rough cut → final edit
```

## What's here

| Path | What it is |
|---|---|
| `board/index.html` | The production board. A single-page app published as a Claude Artifact; data lives in the artifact's database and asset store. |
| `worker/` | The render worker: turns queued shots into keyframes, video takes and dialogue audio through configurable providers. |
| `.claude/skills/render-sync/` | The procedure Claude follows to move data between the board and the worker. |
| `config/pipeline.example.json` | Provider details per stage: models, endpoints, prices, secret names. |
| `films/tock/` | TOCK, the first film: script, cast, 61-shot list and a board export the worker can read. |
| `docs/ARCHITECTURE.md` | How the board, its data model and the render worker fit together. |
| `docs/ROADMAP.md` | Stage 1 (board), Stage 2 (render worker), Stage 3 (assembly and export). |

## Board features (Stage 1)

- **Script & cast.** Write or paste the script; keep a locked look for each character (face, build, height, outfit).
- **Script breakdown with Claude.** One click turns the script into proposed shots with framing, duration, action, dialogue, keyframe and motion prompts. Review, then add them to the shot list.
- **Shot list.** Status pipeline (Scripted → Keyframe → Animating → Approved → Final), filters, per-shot editor, "Suggest prompts" with Claude, and "Copy with cast & style" so every prompt carries the locked looks and style.
- **Media.** Upload a keyframe image and any number of video takes per shot; choose which take goes in the cut. Each take logs its credit cost.
- **Rough cut.** Plays every shot in order: selected takes as video, keyframes as held stills (animatic), and slate cards for shots with nothing yet.
- **Budget.** Plan vs. spent per tool, purchase log, credit balance for the video tool.
- **Pipeline.** Choose the tool for each stage; export the whole board as JSON (the worker hand-off format) or the shot list as CSV.

## Publishing the board

The board is published as a Claude Artifact with the `db`, `user`, `sample`, `assets` and `downloads` capabilities. From a Claude Code session, publish `board/index.html` to the existing artifact URL to update it in place (the data survives republishing).

## Render worker (Stage 2)

1. On the board's Pipeline tab, set a stage's tool to one the worker supports (Kling, Kling 3.0, ElevenLabs, or Mock (test)) and its mode to **Automated**.
2. In the shot editor, queue work: keyframe, draft take, final take or dialogue voice.
3. Copy `config/pipeline.example.json` to `config/pipeline.json`, check the model ids and prices, and set the secrets named there (`KLING_ACCESS_KEY`, `KLING_SECRET_KEY`, `ELEVENLABS_API_KEY`).
4. Ask Claude to "render the queue". It follows `.claude/skills/render-sync`: pulls the board, shows you the plan and estimated cost, renders after you approve, and uploads the results.

Commands (from the repo root, Node 20+, no dependencies):

```
node worker/src/cli.js doctor            # check config and secrets
node worker/src/cli.js plan              # jobs, cost estimate, budget guard
node worker/src/cli.js run --confirm     # render (paid providers need --confirm)
node worker/src/cli.js assemble          # rough cut + FCPXML/EDL/SRT in renders/cut/
npm --prefix worker test                 # tests, no network needed
```

## Assembly (Stage 3)

Ask Claude for a rough cut, or run `node worker/src/cli.js assemble` after pulling the board and its selected takes. You get `renders/cut/rough-cut.mp4` (every shot in order: selected take, else keyframe still, else slate card, with dialogue and an optional `--music` bed), `timeline.fcpxml` for DaVinci Resolve (File → Import → Timeline), `timeline.edl`, and `captions.srt`. The video needs ffmpeg (`FFMPEG_PATH`, `--ffmpeg`, or on the PATH); `--edit-only` writes just the edit files.

## Status

Stages 1–3 are built. The worker is tested against simulated provider responses and a real ffmpeg render; the first live provider run needs keys and network access to the provider hosts, and the FCPXML hasn't been imported into Resolve yet.
