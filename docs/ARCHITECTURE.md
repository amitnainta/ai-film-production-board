# Architecture

## Pieces

```
┌──────────────── Production board (board/index.html, a Claude Artifact) ─────────────────┐
│  Script & cast · Shot list · Rough cut · Budget · Pipeline                               │
│  Data: artifact database (db)      Media: artifact asset store (assets)                  │
│  Claude in the page (sample): script breakdown, prompt suggestions                       │
└───────────────▲───────────────────────────────────────────────────┬──────────────────────┘
                │ results: keyframes, takes, actual cost             │ jobs: shots marked ready
┌───────────────┴───────────────────────────────────────────────────▼──────────────────────┐
│  Render worker (Stage 2, not built yet)                                                   │
│  Reads config/pipeline.json · calls provider APIs · uploads results · logs cost           │
│  Providers: keyframes (Flux / Imagen), video (Kling / Seedance / Veo), voice (ElevenLabs) │
└───────────────────────────────────────────────────────────────────────────────────────────┘
                │
                ▼
        Assembly (Stage 3): ffmpeg rough cut, timeline export for DaVinci Resolve
```

### Why the board doesn't call providers itself

The artifact runs in a sandbox that blocks network requests to other hosts, and any API key in the page would be readable by everyone who can open it. Provider calls therefore live in the worker, which holds the keys. The board only stores state and media.

### How the worker reaches the board

Two options, in order of preference:

1. **Claude Code as the worker.** A Claude Code session reads and writes the board's database with the ArtifactData tool, uploads media to its asset store, and runs provider calls from scripts in `worker/`. Keys live in the session environment's secrets.
2. **File hand-off.** Export the board as JSON from the Pipeline tab, run the worker locally against the file, then import results.

## Data model

All collections live in the artifact database. Ids are opaque strings. Media fields hold asset ids; the page displays them at `/_blob/<id>`.

### `settings/film` (one document)

| Field | Type | Notes |
|---|---|---|
| `title` | string | Film title |
| `targetSeconds` | number | Target runtime |
| `budget` | number | Total budget in dollars |
| `draftRate`, `finalRate` | number | Video credits per second for draft and final takes |
| `style` | string | Global style prompt appended to every keyframe prompt |
| `plan` | array of `{tool, planned, note}` | Budget plan per tool |
| `pipeline` | object | Tool chosen per stage: `keyframes`, `video`, `videoBackup`, `voice`, `lipsync`, `music`, `edit` |

### `script/main` (one document)

`{ text, updatedAt }`

### `characters`

`{ name, look, voice, example }`. `look` is the locked description used in every prompt.

### `shots`

| Field | Type | Notes |
|---|---|---|
| `scene`, `no` | number | Shot order is scene, then number |
| `framing` | string | `WS`, `MS`, `MCU`, `CU`, `ECU`, `OTS`, `POV`, `INSERT` |
| `duration` | number | Seconds |
| `characters` | string | Comma-separated cast names |
| `action`, `dialogue` | string | |
| `keyframePrompt`, `motionPrompt` | string | |
| `tool` | string | Video tool for this shot |
| `status` | string | `script`, `keyframe`, `animating`, `approved`, `final` |
| `takes`, `credits` | number | Running totals, including takes logged without a file |
| `keyframeAsset` | asset id or null | |
| `selectedTake` | take id or null | The take that plays in the rough cut |
| `notes` | string | |
| `example` | boolean | Sample data that can be removed in one click |

### `takes`

`{ shotId, asset, kind: "draft" | "final", credits, createdAt, fileName }`

### `spend`

`{ date, tool, item, amount, credits }`

## Pipeline configuration

`config/pipeline.example.json` describes each stage's provider, mode (`manual` or `automated`), rates, and API settings (endpoint, model, secret name). The board's Pipeline tab stores the chosen tool per stage in `settings.pipeline`; the worker merges that choice with the file's provider details. Secrets are referenced by environment-variable name only, never stored in the board or the repo.

## Stage 2 worker loop (planned)

1. Find shots whose status and pipeline mode make them ready (for example `keyframe` with no `keyframeAsset`, or `animating` with an approved keyframe and a requested take).
2. Build the prompt: shot prompt + locked looks of the characters in the shot + global style.
3. Call the stage's provider, wait for the result, upload it to the asset store.
4. Write the asset id to the shot or a new `takes` document, and log the actual cost.
5. Stop when the budget guard (remaining budget or credit balance) would be exceeded.

A human still approves keyframes, chooses takes and does the final edit.
