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
│  Render worker (worker/)                                                                  │
│  Reads config/pipeline.json · calls provider APIs · writes renders/ + results.json         │
│  Providers: kling (keyframes, image-to-video), elevenlabs (voice), mock (rehearsal)       │
└───────────────────────────────────────────────────────────────────────────────────────────┘
                │
                ▼
        Assembly (Stage 3): ffmpeg rough cut, timeline export for DaVinci Resolve
```

### Why the board doesn't call providers itself

The artifact runs in a sandbox that blocks network requests to other hosts, and any API key in the page would be readable by everyone who can open it. Provider calls therefore live in the worker, which holds the keys. The board only stores state and media.

### How the worker reaches the board

Two options, in order of preference:

1. **Claude Code as the worker** (the `render-sync` skill in `.claude/skills/`). Claude dumps the board's database into `renders/board/` with the ArtifactData tool, downloads keyframe inputs into `renders/inputs/`, runs the worker, then uploads results to the asset store and writes takes and shot updates. Keys live in the session environment's secrets, and the environment's network policy must allow the provider hosts.
2. **File hand-off.** Export the board as JSON from the Pipeline tab and run `node worker/src/cli.js plan --board <file>` locally. Results still go back to the board through step 5 of the skill.

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
| `pipelineModes` | object | `manual` or `automated` per stage; only `keyframes`, `video` and `voice` can be automated |

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
| `renderQueue` | object or null | Work requested from the worker: `{keyframe: true, video: "draft" \| "final", voice: true}` |
| `renderError` | string or null | Last worker error for this shot |
| `dialogueFile` | string or null | Path of the rendered dialogue audio under `renders/` (audio can't go in the asset store) |
| `example` | boolean | Sample data that can be removed in one click |

### `takes`

`{ shotId, asset, kind: "draft" | "final", credits, createdAt, fileName, provider?, taskId? }`

### `spend`

`{ date, tool, item, amount, credits }`

## Pipeline configuration

`config/pipeline.example.json` describes each stage's provider, mode (`manual` or `automated`), rates, and API settings (endpoint, model, secret name). The board's Pipeline tab stores the chosen tool per stage in `settings.pipeline`; the worker merges that choice with the file's provider details. Secrets are referenced by environment-variable name only, never stored in the board or the repo.

## Worker loop

1. **Select jobs** (`worker/src/jobs.js`): every shot with a `renderQueue` entry whose stage is automated and has a provider. A video job without a keyframe asset waits for the keyframe job queued in the same run. Anything else is reported as skipped with a reason.
2. **Build prompts**: keyframe prompt + locked looks of the characters in the shot + global style; the motion prompt for video; the dialogue line and the speaker's voice id for voice.
3. **Budget guard** (`worker/src/budget.js`): estimated cost per job (video: credits × `usdPerCredit`; images: `usdPerImage` × variants; voice: `usdPerLine`). Jobs that would push spend past `budget − stopAtRemainingUsd` are held.
4. **Render** (`worker/src/run.js`): keyframes first, then video, then voice. Provider calls retry once on HTTP 429/5xx. Paid providers run only with `--confirm`.
5. **Results**: files under `renders/<shot>/` and a manifest at `renders/results.json`, which the render-sync skill turns into assets, takes and shot updates.

Kling renders 5 s or 10 s clips; shots longer than 5 s request 10 s and are trimmed in the edit.

A human still approves keyframes, chooses takes and does the final edit.
