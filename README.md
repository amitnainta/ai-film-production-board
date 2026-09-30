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
| `config/pipeline.example.json` | Tool configuration per pipeline stage: provider, mode, rates and API settings the render worker will use. |
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

## Status

Stage 1 is live. Stage 2 (render worker) is designed in `docs/ARCHITECTURE.md` and not built yet.
